import page_head from './page_head.js';
import remote_dot from './remote_dot.js';

const RE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const PORT_DEFAULT = 3000;

// The app boards: a page of apps put together by dragging, published on machines. Every app is
// a cell in the palette; dragged onto a board it is on it, dragged within it moves, dragged back
// to the palette (or its ×) it comes off. The dragging is the pointer's, a mouse or a finger,
// never the browser's own drag: the page stops that one everywhere (serviceman.js), since
// Chrome on Wayland can hold it, and every click with it. A machine picked under a board publishes it there:
// that machine's agent answers it on 127.0.0.1 alone, the board at its name under .localhost
// and each app on it at its own. Each change is saved at once, the whole list written back
// (PUT /api/v1/boards); the page shows it before the answer, and takes it back with the reason
// when serviceman refuses it.
export default {
    template: `
<section class="boards-pane">
    <page-head category="boards" :count="boards.length">
        <template #acts>
            <button type="button" class="primary" :disabled="busy" @click="board_add"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New board</button>
        </template>
        <template #how>
            <p>A page of apps you put together, published on a machine: there its agent answers it on 127.0.0.1 and nowhere else, at the board's name under .localhost, and each app on it at its own, straight to where the app runs. Drag an app from the palette onto a board; drag it within the board to move it, back to the palette to take it off.</p>
        </template>
    </page-head>
    <p v-if="(note !== '')" class="boards-note" :class="{bad: bad}" role="status">{{ note }}</p>
    <div class="boards-layout">
        <aside class="boards-palette" :class="{over: (over !== null) && (over.board === null)}" aria-label="Every app" data-palette="1">
            <h2>Every app <span class="muted">{{ apps.length }}</span></h2>
            <input v-model="query" type="search" placeholder="find an app" spellcheck="false" aria-label="Find an app in the palette">
            <ul class="board-cells palette-cells">
                <li v-for="item of palette" :key="item.name" class="board-cell" :class="{lifted: (dragged !== null) && (dragged.board === null) && (dragged.name === item.name)}" :title="(item.title + ' · ' + item.name)" @pointerdown="press($event, null, item.name)">
                    <span class="board-tile" :style="{'--hue': hue_of(item.name)}">{{ letter_of(item) }}</span>
                    <span class="board-cell-name">{{ item.title }}</span>
                </li>
            </ul>
            <p v-if="(palette.length === 0)" class="muted">{{ (apps.length === 0 ? 'No app yet: one dropped on Apps lands here.' : 'No app has that in its name.') }}</p>
        </aside>
        <div class="boards-list">
            <p v-if="(boards.length === 0)" class="muted boards-empty">No board yet. + New board makes one; then drag apps onto it and pick the machine it is on.</p>
            <article v-for="board of boards" :key="board.name" class="board-card">
                <div class="board-head">
                    <input v-if="(naming === board.name)" ref="name_box" v-model.trim="name_typed" class="board-name-box" spellcheck="false" aria-label="The board's name under .localhost" @keyup.enter="rename_end(board)" @keyup.esc="naming = null" @blur="rename_end(board)">
                    <button v-else type="button" class="board-name" :title="('Rename ' + board.name + ': its name under .localhost')" @click="rename_start(board)">{{ board.name }}<span class="muted">.localhost:{{ board.port }}</span></button>
                    <span v-if="(naming === board.name) && (name_problem !== null)" class="bad board-name-why">{{ name_problem }}</span>
                    <button type="button" class="board-remove" :disabled="busy" :title="('Take the board ' + board.name + ' away, from every machine it is on')" @click="board_remove(board)">Remove</button>
                </div>
                <ul class="board-cells board-drop" :class="{over: (over !== null) && (over.board === board.name) && (over.index === board.apps.length), empty: (board.apps.length === 0)}" :aria-label="('The apps on ' + board.name)" :data-board="board.name" :data-index="board.apps.length">
                    <li v-for="(name, index) of board.apps" :key="name" class="board-cell" :class="{over: (over !== null) && (over.board === board.name) && (over.index === index), lifted: (dragged !== null) && (dragged.board === board.name) && (dragged.name === name)}" :title="(title_of(name) + ' · ' + label_of(name) + '.localhost')" :data-board="board.name" :data-index="index" @pointerdown="press($event, board, name)">
                        <span class="board-tile" :style="{'--hue': hue_of(name)}">{{ letter_of(app_of(name)) }}</span>
                        <span class="board-cell-name">{{ title_of(name) }}</span>
                        <button type="button" class="board-cell-off" :title="('Take ' + title_of(name) + ' off ' + board.name)" :aria-label="('Take ' + title_of(name) + ' off ' + board.name)" @click="app_off(board, name)">×</button>
                    </li>
                    <li v-if="(board.apps.length === 0)" class="board-drop-hint">Drag an app here</li>
                </ul>
                <div class="board-foot">
                    <span class="muted">Published on</span>
                    <button v-for="machine of machines" :key="machine.name" type="button" class="board-machine" :class="{on: board.machines.includes(machine.name)}" :aria-pressed="board.machines.includes(machine.name)" :title="machine_title(board, machine)" @click="machine_toggle(board, machine.name)"><span class="dot" :class="machine.phase"></span>{{ machine.title || machine.name }}</button>
                    <span v-if="(machines.length === 0)" class="muted">no machine yet: one joins on Remotes</span>
                </div>
                <p v-if="(board.machines.length > 0)" class="board-where muted">On {{ board.machines.join(', ') }}, open <code>http://{{ board.name }}.localhost:{{ board.port }}/</code> there; nowhere else answers it.</p>
                <p v-else class="board-where muted">On no machine yet: click one above.</p>
            </article>
        </div>
    </div>
    <div v-if="(dragged !== null)" class="board-ghost" :style="{left: (ghost.x + 'px'), top: (ghost.y + 'px'), '--hue': hue_of(dragged.name)}" aria-hidden="true"><span class="board-tile">{{ letter_of(app_of(dragged.name)) }}</span><span>{{ title_of(dragged.name) }}</span></div>
</section>
`,
    components: {'page-head': page_head},
    emits: ['saved'],
    props: {
        state: {type: Object, required: true},
    },
    data: function () {
        return {boards: copy_of(this.state.boards), busy: false, note: '', bad: false, query: '', pressed: null, dragged: null, ghost: {x: 0, y: 0}, over: null, naming: null, name_typed: ''};
    },
    computed: {
        apps: function () {
            return this.state.services.map(v => ({name: v.name, title: v.title || v.name})).sort((a, b) => a.title.localeCompare(b.title));
        },
        palette: function () {
            const words = this.query.trim().toLowerCase();
            return (words === '') ? this.apps : this.apps.filter(v => v.title.toLowerCase().includes(words) || v.name.toLowerCase().includes(words));
        },
        machines: function () {
            return this.state.remotes.map(v => ({name: v.name, title: v.title, phase: remote_dot(v)}));
        },
        // What is wrong with the name being typed, or null
        name_problem: function () {
            const name = this.name_typed;
            if (RE_NAME.test(name) === false) {
                return 'lowercase letters, digits and hyphens';
            }
            if (this.boards.some(v => (v.name === name) && (v.name !== this.naming))) {
                return 'another board has it';
            }
            return null;
        },
    },
    beforeUnmount: function () {
        this.drag_cancel();
    },
    watch: {
        // What serviceman has, once it has it: a change made elsewhere shows here too, unless a
        // drag or a save of this page is under way
        'state.boards': function (value) {
            if ((this.busy === false) && (this.dragged === null) && (this.naming === null)) {
                this.boards = copy_of(value);
            }
        },
    },
    methods: {
        app_of: function (name) {
            return this.apps.find(v => v.name === name) || {name, title: name};
        },
        title_of: function (name) {
            return this.app_of(name).title;
        },
        label_of: function (name) {
            return name.replace(/_/g, '-');
        },
        letter_of: function (item) {
            return Array.from(item.title || item.name)[0].toUpperCase();
        },
        hue_of: function (name) {
            let out = 0;
            for (const char of name) {
                out = ((out*31) + char.codePointAt(0)) % 360;
            }
            return out;
        },
        machine_title: function (board, machine) {
            const on = board.machines.includes(machine.name);
            return on ? `Published on ${machine.name}: click to take it off` : `Publish ${board.name} on ${machine.name}: its agent answers it on 127.0.0.1:${board.port}`;
        },
        // A change shown at once and saved: taken back with the reason if serviceman refuses it
        save: async function (next, done_words) {
            const before = this.boards;
            this.boards = next;
            this.busy = true;
            this.note = 'Saving…';
            this.bad = false;
            try {
                const answer = await fetch('/api/v1/boards', {method: 'PUT', body: JSON.stringify({boards: next.map(written_of)})});
                if (answer.ok === false) {
                    const said = await answer.json().catch(() => ({error: `serviceman answered ${answer.status}`}));
                    this.boards = before;
                    this.note = `Not saved: ${said.error}`;
                    this.bad = true;
                    return;
                }
                this.note = done_words;
                this.$emit('saved');
            }
            catch {
                this.boards = before;
                this.note = 'Not saved: the answer never came back';
                this.bad = true;
            }
            finally {
                this.busy = false;
            }
        },
        board_add: function () {
            const taken = new Set(this.boards.map(v => v.name).concat(this.apps.map(v => this.label_of(v.name))));
            let name = 'apps';
            for (let n = 2; taken.has(name); n++) {
                name = `apps-${n}`;
            }
            this.save(this.boards.concat([{name, machines: [], apps: [], port: PORT_DEFAULT}]), `${name} made: drag apps onto it, and pick its machine`);
        },
        board_remove: function (board) {
            this.save(this.boards.filter(v => v !== board), `${board.name} taken away`);
        },
        rename_start: function (board) {
            this.naming = board.name;
            this.name_typed = board.name;
            const self = this;
            this.$nextTick(function () {
                const box = Array.isArray(self.$refs.name_box) ? self.$refs.name_box[0] : self.$refs.name_box;
                if (box !== undefined) {
                    box.select();
                }
            });
        },
        rename_end: function (board) {
            if (this.naming !== board.name) {
                return;
            }
            const name = this.name_typed;
            if ((name === board.name) || (this.name_problem !== null)) {
                this.naming = null;
                return;
            }
            this.naming = null;
            this.save(this.boards.map(v => (v === board) ? Object.assign({}, v, {name}) : v), `${board.name} is ${name} now`);
        },
        machine_toggle: function (board, name) {
            const on = board.machines.includes(name);
            const machines = on ? board.machines.filter(v => v !== name) : board.machines.concat([name]);
            this.save(this.boards.map(v => (v === board) ? Object.assign({}, v, {machines}) : v), on ? `${board.name} taken off ${name}` : `${board.name} published on ${name}: open http://${board.name}.localhost:${board.port}/ there`);
        },
        app_off: function (board, name) {
            this.save(this.boards.map(v => (v === board) ? Object.assign({}, v, {apps: v.apps.filter(vv => vv !== name)}) : v), `${this.title_of(name)} taken off ${board.name}`);
        },
        // A press on a cell, the × and other buttons in it aside: a drag once it has moved a few
        // pixels, a press and nothing more until then
        press: function (event, board, name) {
            if ((event.button !== 0) || (event.target.closest('button') !== null)) {
                return;
            }
            event.preventDefault();
            this.pressed = {board: (board === null) ? null : board.name, name, x: event.clientX, y: event.clientY};
            window.addEventListener('pointermove', this.pointer_moved);
            window.addEventListener('pointerup', this.pointer_up);
            window.addEventListener('pointercancel', this.drag_cancel);
            window.addEventListener('keydown', this.key_down);
        },
        pointer_moved: function (event) {
            const pressed = this.pressed;
            if (pressed === null) {
                return;
            }
            if ((this.dragged === null) && (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 5)) {
                return;
            }
            this.dragged = {board: pressed.board, name: pressed.name};
            this.ghost = {x: event.clientX, y: event.clientY};
            this.over = target_at(event.clientX, event.clientY);
        },
        pointer_up: function (event) {
            const dragged = this.dragged;
            const over = (dragged === null) ? null : target_at(event.clientX, event.clientY);
            this.drag_cancel();
            if ((dragged === null) || (over === null)) {
                return;
            }
            if (over.board === null) {
                this.palette_drop(dragged);
                return;
            }
            const board = this.boards.find(v => v.name === over.board);
            if (board !== undefined) {
                this.board_drop(dragged, board, over.index);
            }
        },
        key_down: function (event) {
            if (event.key === 'Escape') {
                this.drag_cancel();
            }
        },
        drag_cancel: function () {
            this.pressed = null;
            this.dragged = null;
            this.over = null;
            window.removeEventListener('pointermove', this.pointer_moved);
            window.removeEventListener('pointerup', this.pointer_up);
            window.removeEventListener('pointercancel', this.drag_cancel);
            window.removeEventListener('keydown', this.key_down);
        },
        // Put where it was dropped: in front of the cell under it, or last; from another board it
        // moves, from the palette it is added, and an app already on this board moves in it
        board_drop: function (dragged, board, index) {
            const name = dragged.name;
            const at = board.apps.indexOf(name);
            const apps = board.apps.filter(v => v !== name);
            const place = ((at !== -1) && (at < index)) ? index - 1 : index;
            apps.splice(place, 0, name);
            if (at === place) {
                return;
            }
            const next = this.boards.map(function (v) {
                if (v === board) {
                    return Object.assign({}, v, {apps});
                }
                if ((dragged.board !== null) && (v.name === dragged.board)) {
                    return Object.assign({}, v, {apps: v.apps.filter(vv => vv !== name)});
                }
                return v;
            });
            const words = (at !== -1) ? `${this.title_of(name)} moved on ${board.name}` : `${this.title_of(name)} is on ${board.name}`;
            this.save(next, words);
        },
        // A cell of a board dropped back on the palette comes off that board
        palette_drop: function (dragged) {
            if (dragged.board === null) {
                return;
            }
            const board = this.boards.find(v => v.name === dragged.board);
            if (board !== undefined) {
                this.app_off(board, dragged.name);
            }
        },
    },
};

// Where a dragged cell would land at this point of the screen: {board, index} on a board, in
// front of the cell there or last, {board: null} on the palette, or null anywhere else
function target_at(x, y)
{
    const under = document.elementFromPoint(x, y);
    if (under === null) {
        return null;
    }
    const place = under.closest('[data-index]');
    if (place !== null) {
        return {board: place.dataset.board, index: Number(place.dataset.index)};
    }
    if (under.closest('[data-palette]') !== null) {
        return {board: null, index: 0};
    }
    return null;
}

function copy_of(boards)
{
    return (Array.isArray(boards) ? boards : []).map(v => ({name: v.name, machines: v.machines.slice(), apps: v.apps.slice(), port: v.port}));
}

// A board as the config file keeps it: the port only where it is not the one every board has
function written_of(board)
{
    const out = {name: board.name, machines: board.machines, apps: board.apps};
    if (board.port !== PORT_DEFAULT) {
        out.port = board.port;
    }
    return out;
}
