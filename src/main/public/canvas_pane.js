import machine_drawing from './machine_drawing.js';
import storage_get from './storage_get.js';
import storage_set from './storage_set.js';

// One machine's place on the canvas, in canvas units: its drawing, then its name under it
const CELL = {width: 200, height: 230};
// How far the canvas zooms out and in
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
// A press that moves less than this is a click, not a drag
const DRAG_PX = 4;

// What each light says, for the legend and a machine's tooltip
const LIGHTS = [
    {light: 'green', said: 'all is well'},
    {light: 'amber', said: 'something to look at'},
    {light: 'red', said: 'something failed'},
    {light: 'dark', said: 'away'},
];

// Every machine on one canvas, drawn as what it is: a server, a laptop or a home computer, as
// its Settings say; its name under it, and one light: green when all is well, amber when its
// Health or Security has something to look at, red when something on it failed, dark while it
// is away. A blue dashed ring turns around the light while work runs on it. The canvas moves
// with a drag and zooms with the wheel, a pinch, + and −, and Fit; a machine dragged stays where
// it is put, for every page; a click opens it.
const canvas_pane = {
    template: `
<article id="detail" class="list canvas-pane">
    <div class="list-head">
        <h1>Canvas</h1>
        <span class="muted">{{ counts }}</span>
        <span v-if="(note !== '')" class="bad">{{ note }}</span>
    </div>
    <p class="muted canvas-legend">
        <span v-for="item of LIGHTS" :key="item.light"><svg viewBox="-8 -8 16 16" width="14" height="14" aria-hidden="true"><circle r="4.6" :class="['canvas-light', item.light]"/></svg>{{ item.said }}</span>
        <span><svg viewBox="-9 -9 18 18" width="16" height="16" aria-hidden="true"><circle r="3.6" class="canvas-light green"/><circle r="7" class="canvas-ring still"/></svg>work going on</span>
    </p>
    <p v-if="(machines.length === 0)" class="muted">No machines yet: Remotes adds one, and it shows here.</p>
    <div v-else ref="board" class="canvas-board" :class="{panning: (panning !== null)}" @pointerdown="press_board" @pointermove="pointer_move" @pointerup="pointer_up" @pointercancel="pointer_up" @wheel.prevent="wheel">
        <svg class="canvas-svg" :width="size.width" :height="size.height" :viewBox="('0 0 ' + size.width + ' ' + size.height)">
            <defs>
                <pattern id="canvas-dots" :width="(24 * zoom)" :height="(24 * zoom)" patternUnits="userSpaceOnUse" :x="pan.x" :y="pan.y"><circle cx="1.5" cy="1.5" r="1.2" class="canvas-dot"/></pattern>
            </defs>
            <rect :width="size.width" :height="size.height" fill="url(#canvas-dots)"/>
            <g :transform="('translate(' + pan.x + ' ' + pan.y + ') scale(' + zoom + ')')">
                <g v-for="item of placed" :key="item.name" class="canvas-machine" :class="{dragged: ((drag !== null) && (drag.name === item.name))}" :transform="('translate(' + item.x + ' ' + item.y + ')')" tabindex="0" role="button" :aria-label="(item.title + ': ' + said_of(item))" @pointerdown.stop="press_machine(item, $event)" @keydown.enter="$emit('remote', item.name)">
                    <title>{{ item.title }}: {{ said_of(item) }}</title>
                    <rect class="canvas-hit" x="0" y="-10" :width="CELL.width - 20" :height="CELL.height - 10" rx="14"/>
                    <g transform="translate(20 0) scale(1.4)"><machine-drawing :kind="item.kind" :light="item.light" :work="item.work"/></g>
                    <text :x="((CELL.width - 20) / 2)" y="166" class="canvas-name" text-anchor="middle">{{ name_short(item.title) }}</text>
                    <text v-if="(item.light === 'dark')" :x="((CELL.width - 20) / 2)" y="190" class="canvas-away" text-anchor="middle">away</text>
                </g>
            </g>
        </svg>
        <div class="canvas-zoom" @pointerdown.stop>
            <button type="button" title="Zoom out" aria-label="Zoom out" @click="zoom_by(1/1.25)">−</button>
            <span>{{ Math.round(zoom * 100) }}%</span>
            <button type="button" title="Zoom in" aria-label="Zoom in" @click="zoom_by(1.25)">+</button>
            <button type="button" title="Every machine in view" @click="fit">Fit</button>
        </div>
    </div>
</article>
`,
    components: {'machine-drawing': machine_drawing},
    props: ['state'],
    emits: ['remote'],
    data: function () {
        return {
            CELL,
            LIGHTS,
            zoom: 1,
            pan: {x: 0, y: 0},
            size: {width: 0, height: 0},
            // A machine moved here and not yet in the status, by name: {x, y}
            moved: {},
            // The machine being dragged: {name, start, origin, moved}; the canvas being moved:
            // {start, origin}; the pointers down now, for a pinch
            drag: null,
            panning: null,
            pointers: new Map(),
            pinch: null,
            note: '',
            observer: null,
            fitted: false,
        };
    },
    computed: {
        machines: function () {
            return ((this.state.canvas === undefined) || (this.state.canvas === null)) ? [] : this.state.canvas.machines;
        },
        // Every machine where it stands: where it was put, or, never put anywhere, in its own place
        // of a grid of all of them in their order, so a machine dragged away leaves every other one
        // where it was
        placed: function () {
            const columns = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(this.machines.length))));
            const moved = this.moved;
            return this.machines.map(function (item, i) {
                const out = Object.assign({}, item, (moved[item.name] === undefined) ? {} : moved[item.name]);
                if ((out.x === null) || (out.y === null)) {
                    out.x = (i % columns)*CELL.width;
                    out.y = Math.floor(i/columns)*CELL.height;
                }
                return out;
            });
        },
        counts: function () {
            const total = this.machines.length;
            const away = this.machines.filter(v => (v.light === 'dark')).length;
            const said = [`${total} ${(total === 1) ? 'machine' : 'machines'}`];
            if (away > 0) {
                said.push(`${away} away`);
            }
            for (const [light, words] of [['red', 'something failed'], ['amber', 'something to look at']]) {
                const count = this.machines.filter(v => (v.light === light)).length;
                if (count > 0) {
                    said.push(`${count} with ${words}`);
                }
            }
            return said.join(' · ');
        },
    },
    watch: {
        // The first time there are machines, every one of them in view
        machines: function () {
            if ((this.fitted === false) && (this.machines.length > 0)) {
                this.$nextTick(this.board_watch);
            }
        },
    },
    methods: {
        said_of: function (item) {
            const light = LIGHTS.find(v => (v.light === item.light));
            // Away says so already; its reasons are the reasons of a machine that is there
            const reasons = (item.light === 'dark') ? [] : item.said;
            const said = [(light === undefined) ? item.light : light.said].concat(reasons, item.work ? ['work going on'] : []);
            return said.join('; ');
        },
        // A long name keeps the width of its drawing, whole in its tooltip
        name_short: function (name) {
            return (name.length > 20) ? `${name.slice(0, 19)}…` : name;
        },
        // The board's size, followed as the window changes; the first time, every machine in view
        board_watch: function () {
            const board = this.$refs.board;
            if ((board === undefined) || (board === null) || (this.observer !== null)) {
                return;
            }
            const self = this;
            this.observer = new ResizeObserver(function () {
                self.size = {width: board.clientWidth, height: board.clientHeight};
                if (self.fitted === false) {
                    self.fitted = true;
                    self.view_restore() || self.fit();
                }
            });
            this.observer.observe(board);
        },
        // Every machine in view, as big as fits, never bigger than its own size
        fit: function () {
            if ((this.placed.length === 0) || (this.size.width === 0)) {
                return;
            }
            const left = Math.min(...this.placed.map(v => v.x));
            const top = Math.min(...this.placed.map(v => v.y)) - 20;
            const right = Math.max(...this.placed.map(v => v.x)) + CELL.width - 20;
            const bottom = Math.max(...this.placed.map(v => v.y)) + CELL.height - 20;
            const zoom = Math.max(ZOOM_MIN, Math.min(1.5, (this.size.width - 48)/(right - left), (this.size.height - 96)/(bottom - top)));
            this.zoom = zoom;
            this.pan = {x: (this.size.width - (right - left)*zoom)/2 - left*zoom, y: (this.size.height - 40 - (bottom - top)*zoom)/2 - top*zoom};
            this.view_keep();
        },
        // Zoomed by a factor around a point of the board, its middle when none is given
        zoom_by: function (factor, at) {
            const point = (at === undefined) ? {x: this.size.width/2, y: this.size.height/2} : at;
            const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom*factor));
            const ratio = zoom/this.zoom;
            this.pan = {x: point.x - (point.x - this.pan.x)*ratio, y: point.y - (point.y - this.pan.y)*ratio};
            this.zoom = zoom;
            this.view_keep();
        },
        wheel: function (event) {
            this.zoom_by(Math.exp(-event.deltaY*0.0015), this.board_point(event));
        },
        board_point: function (event) {
            const box = this.$refs.board.getBoundingClientRect();
            return {x: event.clientX - box.left, y: event.clientY - box.top};
        },
        // A press on the canvas itself moves it; two fingers on it zoom
        press_board: function (event) {
            this.$refs.board.setPointerCapture(event.pointerId);
            this.pointers.set(event.pointerId, this.board_point(event));
            if (this.pointers.size === 2) {
                const [a, b] = Array.from(this.pointers.values());
                this.panning = null;
                this.drag = null;
                this.pinch = {distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, pan: Object.assign({}, this.pan), middle: {x: (a.x + b.x)/2, y: (a.y + b.y)/2}};
                return;
            }
            this.panning = {start: this.board_point(event), origin: Object.assign({}, this.pan)};
        },
        // A press on a machine drags it, or, if it does not move, opens it
        press_machine: function (item, event) {
            this.$refs.board.setPointerCapture(event.pointerId);
            this.pointers.set(event.pointerId, this.board_point(event));
            this.drag = {name: item.name, start: this.board_point(event), origin: {x: item.x, y: item.y}, moved: false};
        },
        pointer_move: function (event) {
            if (this.pointers.has(event.pointerId) === false) {
                return;
            }
            const point = this.board_point(event);
            this.pointers.set(event.pointerId, point);
            if ((this.pinch !== null) && (this.pointers.size === 2)) {
                const [a, b] = Array.from(this.pointers.values());
                const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.pinch.zoom*Math.hypot(a.x - b.x, a.y - b.y)/this.pinch.distance));
                const ratio = zoom/this.pinch.zoom;
                const middle = this.pinch.middle;
                this.zoom = zoom;
                this.pan = {x: middle.x - (middle.x - this.pinch.pan.x)*ratio, y: middle.y - (middle.y - this.pinch.pan.y)*ratio};
                return;
            }
            if (this.drag !== null) {
                const dx = point.x - this.drag.start.x;
                const dy = point.y - this.drag.start.y;
                if (Math.hypot(dx, dy) > DRAG_PX) {
                    this.drag.moved = true;
                }
                if (this.drag.moved) {
                    this.moved[this.drag.name] = {x: Math.round(this.drag.origin.x + dx/this.zoom), y: Math.round(this.drag.origin.y + dy/this.zoom)};
                }
                return;
            }
            if (this.panning !== null) {
                this.pan = {x: this.panning.origin.x + point.x - this.panning.start.x, y: this.panning.origin.y + point.y - this.panning.start.y};
            }
        },
        pointer_up: function (event) {
            this.pointers.delete(event.pointerId);
            if (this.pinch !== null) {
                if (this.pointers.size < 2) {
                    this.pinch = null;
                    this.view_keep();
                }
                return;
            }
            if (this.drag !== null) {
                const drag = this.drag;
                this.drag = null;
                if (drag.moved) {
                    this.place_save(drag.name, this.moved[drag.name]);
                }
                else {
                    this.$emit('remote', drag.name);
                }
                return;
            }
            if (this.panning !== null) {
                this.panning = null;
                this.view_keep();
            }
        },
        // Where a machine was put, kept for every page; one that is refused goes back
        place_save: async function (name, place) {
            this.note = '';
            try {
                const answer = await fetch(`/api/v1/canvas/machines/${encodeURIComponent(name)}`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(place)});
                if (answer.ok === false) {
                    this.note = `${name} could not be put there: ${(await answer.json()).error}`;
                    delete this.moved[name];
                }
            }
            catch {
                this.note = `${name} could not be put there: the answer never came back`;
                delete this.moved[name];
            }
        },
        // The zoom and where the canvas was, kept for this browser: a page opened again shows
        // the canvas as it was left
        view_keep: function () {
            storage_set('serviceman.canvas_view', JSON.stringify({zoom: this.zoom, pan: this.pan}));
        },
        view_restore: function () {
            try {
                const kept = JSON.parse(storage_get('serviceman.canvas_view'));
                if ((kept === null) || !Number.isFinite(kept.zoom) || !Number.isFinite(kept.pan.x) || !Number.isFinite(kept.pan.y)) {
                    return false;
                }
                this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, kept.zoom));
                this.pan = kept.pan;
                return true;
            }
            catch {
                return false;
            }
        },
    },
    mounted: function () {
        if (this.machines.length > 0) {
            this.board_watch();
        }
    },
    unmounted: function () {
        if (this.observer !== null) {
            this.observer.disconnect();
        }
    },
};

export default canvas_pane;
