import CATEGORIES from './categories.js';
import clock_of from './clock_of.js';
import data_table from './data_table.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import remote_dot from './remote_dot.js';
import state_pill from './state_pill.js';

const RE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const PORT_DEFAULT = 3000;
// How many app names a board's row gives before "and N more"
const NAMED_MAX = 3;

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
            <p>A page of apps you put together, published on a machine: there its agent answers it on 127.0.0.1 and nowhere else, at the board's name under .localhost, and each app on it at its own, straight to where the app runs. Drag an app from the palette onto a board's row; a click on the row opens the board's window, where its apps are moved and taken off, its machines picked and its name changed.</p>
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
            <p v-else class="muted boards-palette-says">Drag an app onto a board's row; its window arranges them.</p>
        </aside>
        <data-table class="boards-table" :columns="columns" :rows="rows" row_key="name" :row_class="row_class_of" :marks="true" framed :total="boards.length" :foot="foot" :empty_icon="BOARDS_ICON" empty_title="No boards yet" empty="A board is a page of apps you put together: make one, drag apps onto its row from Every app, and pick the machine it is published on.">
            <template #tools>
                <input v-model.trim="filter" type="search" placeholder="Find a board" aria-label="Find a board by its name or an app on it" spellcheck="false">
                <span class="dt-chips">
                    <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                        <span v-if="(chip.dot !== '')" class="dot" :class="chip.dot"/>
                        {{ chip.label }}
                        <span class="muted">{{ chip.count }}</span>
                    </button>
                </span>
            </template>
            <template #empty_act><button type="button" class="primary" :disabled="busy" @click="board_add"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New board</button></template>
            <template #cell="{row, column, more}">
                <span v-if="(column.key === 'name')" class="board-row-mark" :data-board="row.name" :data-index="row.board.apps.length"><name-cell :icon="BOARDS_ICON" :name="row.name" :line="row.line" :tone="row.tone"/></span>
                <template v-else-if="(column.key === 'apps')">{{ row.apps_said }}</template>
                <span v-else-if="(column.key === 'machines')" :class="{muted: (row.board.machines.length === 0)}">{{ (row.board.machines.length === 0) ? '—' : row.board.machines.join(', ') }}</span>
                <span v-else-if="(column.key === 'address')" :class="(row.board.machines.length === 0) ? 'muted' : 'dt-address'" :title="row.address_title">{{ (row.board.machines.length === 0) ? '—' : (row.name + '.localhost') }}</span>
                <state-pill v-else-if="(column.key === 'state')" :tone="row.pill.tone" :text="row.pill.text"/>
            </template>
            <!-- A board's own window: its apps arranged, its machines, its name -->
            <template #details="{row}">
                <dt>Its apps</dt>
                <dd>
                    <ul class="board-cells board-drop" :class="{over: (over !== null) && (over.board === row.name) && (over.index === row.board.apps.length), empty: (row.board.apps.length === 0)}" :aria-label="('The apps on ' + row.name)" :data-board="row.name" :data-index="row.board.apps.length">
                        <li v-for="(name, index) of row.board.apps" :key="name" class="board-cell" :class="{over: (over !== null) && (over.board === row.name) && (over.index === index), lifted: (dragged !== null) && (dragged.board === row.name) && (dragged.name === name)}" :title="(title_of(name) + ' · ' + label_of(name) + '.localhost')" :data-board="row.name" :data-index="index" @pointerdown="press($event, row.board, name)">
                            <span class="board-tile" :style="{'--hue': hue_of(name)}">{{ letter_of(app_of(name)) }}</span>
                            <span class="board-cell-name">{{ title_of(name) }}</span>
                            <button type="button" class="board-cell-off" :title="('Take ' + title_of(name) + ' off ' + row.name)" :aria-label="('Take ' + title_of(name) + ' off ' + row.name)" @click="app_off(row.board, name)">×</button>
                        </li>
                        <li v-if="(row.board.apps.length === 0)" class="board-drop-hint">Drag an app onto its row in the table</li>
                    </ul>
                    <p class="muted board-window-says">Drag one to move it; × takes it off.</p>
                </dd>
                <dt>Published on</dt>
                <dd>
                    <span class="board-machines">
                        <button v-for="machine of machines" :key="machine.name" type="button" class="board-machine" :class="{on: row.board.machines.includes(machine.name)}" :aria-pressed="row.board.machines.includes(machine.name)" :title="machine_title(row.board, machine)" @click="machine_toggle(row.board, machine.name)"><span class="dot" :class="machine.phase"></span>{{ machine.name }}</button>
                        <span v-if="(machines.length === 0)" class="muted">no machine yet: one joins on Remotes</span>
                    </span>
                    <p class="muted board-window-says">{{ (row.board.machines.length === 0) ? 'On no machine yet: click one.' : ('On ' + row.board.machines.join(', ') + ', open http://' + row.name + '.localhost:' + row.board.port + '/ there; nowhere else answers it.') }}</p>
                </dd>
                <dt>Name</dt>
                <dd>
                    <input v-if="(naming === row.name)" ref="name_box" v-model.trim="name_typed" class="board-name-box" spellcheck="false" aria-label="The board's name under .localhost" @keyup.enter="rename_end(row.board)" @keyup.esc="naming = null" @blur="rename_end(row.board)">
                    <button v-else type="button" class="board-name" :title="('Rename ' + row.name + ': its name under .localhost')" @click="rename_start(row.board)">{{ row.name }}<span class="muted">.localhost:{{ row.board.port }}</span></button>
                    <span v-if="(naming === row.name) && (name_problem !== null)" class="bad board-name-why">{{ name_problem }}</span>
                </dd>
            </template>
            <template #actions="{row, ask}">
                <button type="button" class="danger" :disabled="busy" @click="ask(('Take ' + row.name + ' away, from every machine it is on?'), 'Remove it', () => board_remove(row.board))">Remove…</button>
            </template>
        </data-table>
    </div>
    <div v-if="(dragged !== null)" class="board-ghost" :style="{left: (ghost.x + 'px'), top: (ghost.y + 'px'), '--hue': hue_of(dragged.name)}" aria-hidden="true"><span class="board-tile">{{ letter_of(app_of(dragged.name)) }}</span><span>{{ title_of(dragged.name) }}</span></div>
</section>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, 'state-pill': state_pill},
    emits: ['saved'],
    props: {
        state: {type: Object, required: true},
    },
    data: function () {
        // filter, show: the find box over the table and the chip picked
        return {BOARDS_ICON: CATEGORIES.find(v => v.key === 'boards').icon, boards: copy_of(this.state.boards), busy: false, note: '', bad: false, query: '', pressed: null, dragged: null, ghost: {x: 0, y: 0}, over: null, naming: null, name_typed: '', filter: '', show: 'all'};
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
        // The table's columns, as drawn: the board, how many apps, where, its address, its state
        columns: function () {
            return [
                {key: 'name', label: 'Board', wraps: true},
                {key: 'apps', label: 'Apps', fold: 2},
                {key: 'machines', label: 'Published on', fold: 3},
                {key: 'address', label: 'Address', fold: 1, phone: 'row'},
                {key: 'state', label: 'Status', phone: 'state'},
            ];
        },
        // Every board as its row says it
        rows_all: function () {
            return this.boards.map(v => this.row_of(v));
        },
        // The rows the chip and the find box leave
        rows: function () {
            const words = this.filter.toLowerCase();
            return this.rows_all.filter(v => ((this.show === 'all') || (v.kind === this.show)) && ((words === '') || [v.name].concat(v.board.apps).join(' ').toLowerCase().includes(words)));
        },
        chips: function () {
            const rows = this.rows_all;
            return [
                {value: 'all', label: 'All', dot: '', count: rows.length},
                {value: 'published', label: 'Published', dot: 'running', count: rows.filter(v => v.kind === 'published').length},
                {value: 'draft', label: 'Drafts', dot: 'stopped', count: rows.filter(v => v.kind === 'draft').length},
                {value: 'needs', label: 'Needs you', dot: 'failed', count: rows.filter(v => v.kind === 'needs').length},
            ];
        },
        // The footer: how many boards, apps on them, and on a machine that is away
        foot: function () {
            const rows = this.rows_all;
            const apps = rows.reduce((sum, v) => sum + v.board.apps.length, 0);
            const out = [{text: `${rows.length} ${(rows.length === 1) ? 'board' : 'boards'}`, tone: ''}, {text: `${apps} ${(apps === 1) ? 'app' : 'apps'} on them`, tone: ''}];
            const away = rows.filter(v => v.kind === 'needs').length;
            if (away > 0) {
                out.push({text: `${away} on a machine offline`, tone: 'bad'});
            }
            return out;
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
        // A board as its row says it: its apps by name, or why it is not answered, its state
        row_of: function (board) {
            const away = board.machines.map(v => this.state.remotes.find(vv => vv.name === v)).filter(v => (v !== undefined) && (v.phase !== 'online'));
            const names = board.apps.map(v => this.title_of(v));
            let line = (names.length === 0) ? 'no app yet' : `${names.slice(0, NAMED_MAX).join(', ')}${(names.length > NAMED_MAX) ? ` and ${names.length - NAMED_MAX} more` : ''}`;
            let tone = '';
            let kind = 'published';
            let pill = {tone: 'run', text: 'published'};
            if (board.machines.length === 0) {
                line = 'not published yet';
                kind = 'draft';
                pill = {tone: 'idle', text: 'draft'};
            }
            else if (away.length > 0) {
                const left = away.map(v => v.left_at).filter(v => typeof v === 'number').sort((a, b) => b - a);
                line = (left.length === 0) ? `${away[0].name} not linked` : `not linked since ${clock_of(left[0])}`;
                tone = 'bad';
                kind = 'needs';
                pill = {tone: 'bad', text: 'machine offline'};
            }
            const apps_said = `${board.apps.length} ${(board.apps.length === 1) ? 'app' : 'apps'}`;
            const address_title = `On ${board.machines.join(', ')}, http://${board.name}.localhost:${board.port}/ answers it there, and nowhere else`;
            return {name: board.name, board, line, tone, kind, pill, apps_said, address_title};
        },
        // A row an app is dragged over is lit, as the cell a dragged app would go before is
        row_class_of: function (row) {
            const out = (row.tone === 'bad') ? ['dt-bad'] : [];
            if ((this.over !== null) && (this.over.board === row.name) && (this.dragged !== null) && (this.dragged.board === null)) {
                out.push('board-row-over');
            }
            return out;
        },
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
    // Anywhere on a board's row in the table: its mark is in its first cell, last on the board
    const row = under.closest('tr');
    const mark = (row === null) ? null : row.querySelector('.board-row-mark[data-index]');
    if (mark !== null) {
        return {board: mark.dataset.board, index: Number(mark.dataset.index)};
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
