import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import format_bytes from './format_bytes.js';
import format_ms_ago from './format_ms_ago.js';
import machine_icons from './machine_icons.js';
import mounts_write from './mounts_write.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import state_pill from './state_pill.js';
import step_frame from './step_frame.js';

// A folder of one machine, mounted on another: `from` is where the folder is, `to` where it
// shows up, read-only or read-write. sshfs on `to` speaks SFTP over both machines' links,
// through serviceman, to the folder, which shows it and nothing outside it. No ssh, no key.
// The folder may be one of serviceman's own state dir, its data/.
const mounts_section = {
    template: `
<div class="forwards mounts">
    <step-frame v-if="making" :title="((editing === null) ? 'New mount' : ('Change ' + editing.label))" :steps="steps" :step="step" :mode="((editing === null) ? mode : 'page')" :switchable="(editing === null)" :can_next="step_ok.ok" :next_title="step_ok.why" :busy="busy" :create_label="((editing === null) ? 'Mount' : 'Save')" @step="step_go" @mode="mode = $event" @cancel="clear" @create="write">
        <template #from>
            <div class="sf-end" :class="{on: (mode === 'steps')}">
                <span class="sf-end-head"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="machine_icon(fresh.from_remote)"/><select ref="first" v-model="fresh.from_remote" aria-label="The machine the folder is on">
                    <option value="">a machine…</option>
                    <option :value="here_value">this host, serviceman's {{ state_folder }}/</option>
                    <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select></span>
                <span class="muted">the folder there</span>
                <div class="sf-field">
                    <label for="mnt-from">Folder</label>
                    <input id="mnt-from" v-model.trim="fresh.from" class="sf-mono" :placeholder="from_hint" spellcheck="false" @keyup.enter="write">
                    <p class="sf-hint" :class="{bad: from_says.bad}">{{ from_says.text }}</p>
                </div>
            </div>
        </template>
        <template #to>
            <div :class="{'sf-flow': (mode === 'steps')}">
                <template v-if="(mode === 'steps')">
                <div class="sf-end">
                    <span class="sf-end-head"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="machine_icon(fresh.from_remote)"/>{{ (fresh.from_remote === here_value) ? 'this host' : (fresh.from_remote || 'no machine yet') }}</span>
                    <span class="muted">the folder there</span>
                    <div class="sf-field"><span class="sf-label">Folder</span><span class="sf-end-value">{{ fresh.from || '—' }}</span></div>
                </div>
                <span class="sf-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></span>
                </template>
                <div class="sf-end" :class="{on: (mode === 'steps')}">
                    <span class="sf-end-head"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="machine_icon(fresh.to_remote)"/><select v-model="fresh.to_remote" aria-label="The machine it is mounted on">
                        <option value="">a machine…</option>
                        <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select></span>
                    <span class="muted">where it appears</span>
                    <div class="sf-field">
                        <label for="mnt-to">Folder</label>
                        <input id="mnt-to" v-model.trim="fresh.to" class="sf-mono" placeholder="/mnt/photos" spellcheck="false" @keyup.enter="write">
                        <p class="sf-hint" :class="{bad: to_says.bad}">{{ to_says.text }}</p>
                    </div>
                </div>
            </div>
            <div class="sf-inline">
                <b>On {{ fresh.to_remote || 'that machine' }} it is</b>
                <span class="seg" role="radiogroup" aria-label="What the machine it is mounted on may do">
                    <button type="button" role="radio" :class="{on: (fresh.mode === 'rw')}" :aria-checked="(fresh.mode === 'rw')" title="files are written, renamed and removed there" @click="fresh.mode = 'rw'">read and write</button>
                    <button type="button" role="radio" :class="{on: (fresh.mode === 'ro')}" :aria-checked="(fresh.mode === 'ro')" title="nothing there may change it" @click="fresh.mode = 'ro'">read only</button>
                </span>
            </div>
        </template>
        <template #check>
            <div class="check-rows">
                <div class="check-row">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>
                    <span class="cr-text"><span>{{ (summary === null) ? 'Pick both machines and both folders.' : summary }}</span></span>
                    <button type="button" class="link" @click="step = 0">Change</button>
                </div>
            </div>
            <div class="sf-field">
                <label for="mnt-label">Label</label>
                <input id="mnt-label" v-model.trim="fresh.label" class="sf-mono" :placeholder="label_auto" maxlength="100" spellcheck="false" @keyup.enter="write">
                <p class="sf-hint">any text, one a mount; left empty, the one shown</p>
            </div>
        </template>
        <template #summary>
            <p class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg><span class="mono">{{ fresh.label || label_auto || 'not named yet' }}</span></p>
            <p class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg><span>{{ (summary === null) ? 'Pick both machines and both folders.' : summary }}</span></p>
        </template>
        <template #note>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <page-head category="mounts" :count="mounts.length">
        <template #acts>
            <button type="button" class="primary" :disabled="making" @click="begin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New mount</button>
        </template>
        <template #how>
            <p>A folder of one machine, mounted on another: <code>laptop · ~/Pictures → vps1 · /mnt/photos</code>. The machine on the right mounts it with sshfs, which speaks to the folder straight through the agent of the machine on the left, over the tailnet; an agent too old for that, or one that cannot be reached that way, goes over both machines' links through serviceman instead. No ssh and no key. It sees that folder and nothing outside it, read-only or read-write as you pick. The folder may be serviceman's own state dir, <code>{{ state_folder }}/</code>. The machine that mounts needs the agent's root half (<code>sudo bin/install-root</code> in the agent's folder); sshfs is installed there when it is missing.</p>
        </template>
    </page-head>
    <data-table :columns="columns" :rows="mounts_shown" :total="mounts.length" row_key="label" :row_class="row_class" framed :foot="foot" :empty_icon="MOUNTS_ICON" empty_title="No mounts yet" empty="Mount a folder of one machine on another: serviceman's state on a server, read only, say.">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a mount, a machine or a folder" aria-label="Find a mount by its name, its machines or its folders" spellcheck="false">
            <span class="dt-chips">
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    <span v-if="(chip.dot !== null)" class="dot" :class="chip.dot"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #empty_act><button type="button" class="primary" :disabled="making" @click="begin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New mount</button></template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'label')" :icon="MOUNTS_ICON" :name="row.label" :line="wrong_text(row)" :tone="(bad_of(row) ? 'bad' : '')"/>
            <template v-else-if="(column.key === 'from')"><b>{{ from_place(row.from) }}</b> <code>{{ from_text(row.from) }}</code></template>
            <template v-else-if="(column.key === 'to')"><b>{{ title_of(row.to.remote) }}</b> <code>{{ row.to.path }}</code></template>
            <span v-else-if="(column.key === 'mode')" :class="(row.mode === 'rw' ? 'mount-rw' : 'muted')">{{ (row.mode === 'rw' ? 'read and write' : 'read only') }}</span>
            <span v-else-if="(column.key === 'through')" class="muted">{{ through_text(row) }}</span>
            <state-pill v-else-if="(column.key === 'now')" :tone="pill_of(row)" :text="word_of(row)"/>
        </template>
        <template #actions="{row, close}">
            <label title="Mounted, or set aside for now"><input type="checkbox" :checked="(row.off === false)" :disabled="busy" @change="turn(row, $event.target.checked)">mounted</label>
            <button type="button" :disabled="busy" @click="close(); edit(row)">edit</button>
            <button type="button" class="danger" :disabled="busy" @click="drop(row)">forget it</button>
        </template>
    </data-table>
    </template>
</div>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, 'state-pill': state_pill, 'step-frame': step_frame},
    props: ['state'],
    emits: ['form'],
    data: function () {
        // `editing` is the mount the window is rewriting, by the label it had; `here_value` is
        // serviceman itself in the picker
        return {fresh: fresh_empty(), step: 0, mode: 'steps', making: false, editing: null, note: '', bad: false, busy: false, here_value: HERE, filter: '', show: 'all', MOUNTS_ICON: CATEGORIES.find(v => v.key === 'mounts').icon};
    },
    computed: {
        // The form open, as the crumbs name it after the category; '' when none is
        form_crumb: function () {
            return (this.making === false) ? '' : ((this.editing === null) ? 'New mount' : `Change ${this.editing.label}`);
        },
        mounts: function () {
            return ((this.state === null) || (this.state.mounts === undefined)) ? [] : this.state.mounts;
        },
        // Its name over what is wrong, the folder, where it is mounted, its mode, through what,
        // its state; on a phone the folder and where it is mounted share a line
        columns: function () {
            return [
                {key: 'label', label: 'Name'},
                {key: 'from', label: 'From', fold: 6, clip: true},
                {key: 'to', label: 'To', fold: 5},
                {key: 'mode', label: 'Mode', fold: 4, phone: 'hide'},
                {key: 'through', label: 'Through', fold: 3, phone: 'hide'},
                {key: 'now', label: 'Status', phone: 'state'},
            ];
        },
        chips: function () {
            return [
                {value: 'all', label: 'All', dot: null, count: this.mounts.length},
                {value: 'on', label: 'Mounted', dot: 'running', count: this.mounts.filter(v => (this.dot_of(v) === 'running')).length},
                {value: 'bad', label: 'Needs you', dot: 'failed', count: this.mounts.filter(v => this.bad_of(v)).length},
            ];
        },
        // The mounts the chips and the find box leave
        mounts_shown: function () {
            const wanted = this.filter.toLowerCase();
            return this.mounts.filter(function (v) {
                if (((this.show === 'on') && ((this.dot_of(v) === 'running') === false)) || ((this.show === 'bad') && (this.bad_of(v) === false))) {
                    return false;
                }
                return (wanted === '') || `${v.label} ${this.from_place(v.from)} ${this.from_text(v.from)} ${this.title_of(v.to.remote)} ${v.to.path}`.toLowerCase().includes(wanted);
            }, this);
        },
        // The footer: how many, how many are mounted, how many are wrong
        foot: function () {
            const mounted = this.mounts.filter(v => this.dot_of(v) === 'running').length;
            const wrong = this.mounts.filter(v => this.bad_of(v)).length;
            const out = [{text: `${this.mounts.length} ${(this.mounts.length === 1) ? 'mount' : 'mounts'}`, tone: ''}, {text: `${mounted} mounted`, tone: ''}];
            if (wrong > 0) {
                out.push({text: `${wrong} ${(wrong === 1) ? 'needs' : 'need'} you`, tone: 'bad'});
            }
            return out;
        },
        machines: function () {
            return (this.state === null) ? [] : this.state.remotes;
        },
        // How the Canvas draws each machine, by its name
        kinds: function () {
            const machines = ((this.state === null) || (this.state.canvas === undefined) || (this.state.canvas === null)) ? [] : this.state.canvas.machines;
            return Object.fromEntries(machines.map(v => [v.name, v.kind]));
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: (v.phase === 'online') ? v.name : `${v.name} · offline`}));
        },
        // The state dir as its owner sees it beside the config: data/ under bin/run
        state_folder: function () {
            if ((this.state === null) || (typeof this.state.state_dir !== 'string')) {
                return 'data';
            }
            return this.state.state_dir.replace(/\/+$/, '').split('/').pop();
        },
        from_hint: function () {
            return (this.fresh.from_remote === HERE) ? '. for the whole, or logs' : '~/Pictures or /srv/media';
        },
        from_says: function () {
            const text = this.fresh.from;
            if (this.fresh.from_remote === HERE) {
                if (text === '') {
                    return {text: `a folder of ${this.state_folder}/, or . for the whole of it`, bad: false};
                }
                if ((text !== '.') && ((text.startsWith('/') || text.startsWith('~')) || text.split('/').some(v => (v === '') || (v === '.') || (v === '..')))) {
                    return {text: `a folder inside ${this.state_folder}/, written from it, never through ..`, bad: true};
                }
                return {text: (text === '.') ? `the whole of ${this.state_folder}/` : `${this.state_folder}/${text}`, bad: false};
            }
            if (text === '') {
                return {text: 'a folder there, from / or ~/', bad: false};
            }
            if (((text.startsWith('/') || text.startsWith('~/') || (text === '~')) === false) || (text === '/')) {
                return {text: "a folder from / or ~/ (~ is the agent's user's home), never the whole disk", bad: true};
            }
            return {text: `${text} on ${(this.fresh.from_remote === '') ? 'that machine' : this.title_of(this.fresh.from_remote)}, and nothing outside it`, bad: false};
        },
        to_says: function () {
            const text = this.fresh.to;
            if ((this.fresh.to_remote !== '') && (this.fresh.to_remote === this.fresh.from_remote)) {
                return {text: 'the same machine as the folder: pick another', bad: true};
            }
            if (text === '') {
                return {text: 'an empty folder there, or one to be made, like /mnt/photos', bad: false};
            }
            if ((text.startsWith('/') === false) || text.endsWith('/') || (text.split('/').length < 3)) {
                return {text: 'a full path one level below the top at least, like /mnt/photos', bad: true};
            }
            return {text: `mounted at ${text}; a folder with files of its own is left as it is`, bad: false};
        },
        // From, To, then Check; a change is one page of them
        steps: function () {
            const out = [
                {key: 'from', name: 'From', question: 'Which folder, on which machine?', says: 'The folder of one machine, mounted on another.', answer: (this.fresh.from === '') ? '' : `${(this.fresh.from_remote === this.here_value) ? 'this host' : this.fresh.from_remote} ${this.fresh.from}`},
                {key: 'to', name: 'To', question: 'Where does it appear?', says: 'The folder of one machine, mounted on another.', answer: (this.fresh.to === '') ? '' : this.fresh.to},
            ];
            if ((this.editing === null) && (this.mode === 'steps')) {
                out.push({key: 'check', name: 'Check', question: 'Check, then mount it', says: 'What it does, and the label it is shown by.', answer: ''});
            }
            return out;
        },
        // What the open step wants before Next: both halves of its end, and nothing said wrong
        step_ok: function () {
            const key = (this.mode === 'page') ? 'check' : this.steps[Math.min(this.step, this.steps.length - 1)].key;
            if ((key === 'from') && ((this.fresh.from_remote === '') || (this.fresh.from === '') || this.from_says.bad)) {
                return {ok: false, why: this.from_says.bad ? this.from_says.text : 'Its machine and its folder first'};
            }
            if ((key === 'to') && ((this.fresh.to_remote === '') || (this.fresh.to === '') || this.to_says.bad)) {
                return {ok: false, why: this.to_says.bad ? this.to_says.text : 'Where it appears first'};
            }
            return {ok: true, why: ''};
        },
        ready: function () {
            const fresh = this.fresh;
            return (fresh.from_remote !== '') && (fresh.to_remote !== '') && (fresh.from !== '') && (fresh.to !== '') && (this.from_says.bad === false) && (this.to_says.bad === false);
        },
        summary: function () {
            if (this.ready === false) {
                return null;
            }
            const fresh = this.fresh;
            const what = (fresh.from_remote === HERE) ? this.from_says.text : `${fresh.from} on ${this.title_of(fresh.from_remote)}`;
            return `${what} shows up at ${fresh.to} on ${this.title_of(fresh.to_remote)}, ${(fresh.mode === 'rw') ? 'read-write' : 'read-only'}.`;
        },
        // The label a mount gets when none is typed: the folder's last name, or data for the
        // state dir whole
        label_auto: function () {
            const from = this.fresh.from;
            if (this.fresh.from_remote === HERE) {
                return (from === '.' || from === '') ? `serviceman ${this.state_folder}` : `serviceman ${from}`;
            }
            const last = from.replace(/\/+$/, '').split('/').pop();
            return ((last === '') || (last === '~')) ? 'home' : last;
        },
    },
    watch: {
        // The crumbs name the form while it is open
        form_crumb: function (title) {
            this.$emit('form', title);
        },
    },
    beforeUnmount: function () {
        this.$emit('form', '');
    },
    mounted: function () {
        const self = this;
        this.escape_listener = function (event) {
            if ((event.key === 'Escape') && self.making && (self.busy === false)) {
                self.clear();
            }
        };
        document.addEventListener('keydown', this.escape_listener);
    },
    unmounted: function () {
        document.removeEventListener('keydown', this.escape_listener);
    },
    methods: {
        // A machine's icon as the Canvas draws it; serviceman's own host as a home computer
        machine_icon: function (name) {
            if (name === this.here_value) {
                return machine_icons.home;
            }
            return machine_icons[this.kinds[name]] || machine_icons.server;
        },
        word_of: function (item) {
            const words = {
                mounted: 'mounted',
                aside: 'set aside',
                away: `${this.title_of(item.to.remote)} offline`,
                old: 'agent too old',
                waiting: 'starting',
                unmounted: 'not mounted',
                busy: 'in use',
                not_empty: 'not empty',
                taken: 'path taken',
                cannot: 'cannot mount',
                error: 'failed',
            };
            return (words[item.state] === undefined) ? item.state : words[item.state];
        },
        dot_of: function (item) {
            if ((item.state === 'mounted') && (item.problem === null)) {
                return 'running';
            }
            if (['waiting', 'busy'].includes(item.state)) {
                return 'starting';
            }
            return (item.state === 'aside') ? '' : 'failed';
        },
        // A mount that is wrong is edged red; one set aside is struck through
        row_class: function (item) {
            return (this.bad_of(item) ? ['dt-bad'] : []).concat(item.off ? ['off'] : []);
        },
        pill_of: function (item) {
            if (this.bad_of(item)) {
                return 'bad';
            }
            return {running: 'run', starting: 'busy'}[this.dot_of(item)] || 'idle';
        },
        bad_of: function (item) {
            if (['aside', 'waiting'].includes(item.state)) {
                return false;
            }
            return (item.state !== 'mounted') || (item.problem !== null);
        },
        // What stands in its way now, else the last failure of its stream, else nothing
        wrong_text: function (item) {
            if ((item.problem !== null) && (item.off === false)) {
                return item.problem;
            }
            return (item.error === null) ? '' : `last failure ${this.ago(item.error_at)}: ${item.error}`;
        },
        through_text: function (item) {
            if (item.total === 0) {
                return 'nothing yet';
            }
            return `${item.open} open · ↑ ${format_bytes(item.bytes_sent)} ↓ ${format_bytes(item.bytes_back)}`;
        },
        title_of: function (name) {
            const found = this.machines.find(v => v.name === name);
            return (found === undefined) ? name : (found.title || found.name);
        },
        from_place: function (from) {
            return from.here ? 'this host' : this.title_of(from.remote);
        },
        from_text: function (from) {
            if (from.here) {
                return (from.path === '.') ? `${this.state_folder}/` : `${this.state_folder}/${from.path}`;
            }
            return from.path;
        },
        ago: function (at) {
            return format_ms_ago(this.state.now - at);
        },
        write: async function () {
            if (this.ready === false) {
                return;
            }
            const fresh = Object.assign({}, this.fresh, {label: (this.fresh.label === '') ? this.label_auto : this.fresh.label});
            const from = (fresh.from_remote === HERE) ? {here: true, path: fresh.from} : {remote: fresh.from_remote, path: fresh.from};
            const editing = this.editing;
            const written = await this.mounts_write(function (mounts) {
                const at = mounts.findIndex(v => v.label === ((editing === null) ? fresh.label : editing.label));
                const kept = ((at === -1) || (editing === null)) ? false : (mounts[at].off === true);
                const mount = Object.assign({label: fresh.label, from, to: {remote: fresh.to_remote, path: fresh.to}, mode: fresh.mode}, kept ? {off: true} : {});
                if ((editing === null) || (at === -1)) {
                    mounts.push(mount);
                    return;
                }
                mounts[at] = mount;
            });
            if (written) {
                this.clear();
            }
        },
        begin: function () {
            this.editing = null;
            this.fresh = fresh_empty();
            this.report('', false);
            this.step = 0;
            this.mode = 'steps';
            this.making = true;
            this.form_show();
        },
        edit: function (item) {
            this.step = 0;
            this.mode = 'page';
            this.making = true;
            this.editing = item;
            this.fresh = {label: item.label, from_remote: item.from.here ? HERE : item.from.remote, from: item.from.path, to_remote: item.to.remote, to: item.to.path, mode: item.mode};
            this.report('', false);
            this.form_show();
        },
        form_show: function () {
            this.$nextTick(function () {
                this.$refs.first.focus({preventScroll: true});
            });
        },
        step_go: function (index) {
            if ((index > this.step) && (this.step_ok.ok === false)) {
                return;
            }
            this.step = index;
        },
        clear: function () {
            this.making = false;
            this.editing = null;
            this.fresh = fresh_empty();
        },
        // Set aside: unmounted on its machine, and put back later without retyping it
        turn: async function (item, on) {
            await this.mounts_write(function (mounts) {
                const found = mounts.find(v => v.label === item.label);
                if (found === undefined) {
                    return;
                }
                if (on) {
                    delete found.off;
                }
                else {
                    found.off = true;
                }
            });
        },
        drop: async function (item) {
            const written = await this.mounts_write(function (mounts) {
                const at = mounts.findIndex(v => v.label === item.label);
                if (at !== -1) {
                    mounts.splice(at, 1);
                }
            });
            if (written && (this.editing !== null) && (this.editing.label === item.label)) {
                this.clear();
            }
        },
        mounts_write: async function (change) {
            this.busy = true;
            this.report('', false);
            const problem = await mounts_write(change);
            this.busy = false;
            if (problem !== null) {
                this.report(problem, true);
                return false;
            }
            return true;
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
};

// The picker's value for serviceman itself: machines are named in words, and the empty value
// is "a machine…"
const HERE = ':here';

function fresh_empty()
{
    return {label: '', from_remote: '', from: '', to_remote: '', to: '', mode: 'ro'};
}

export default mounts_section;
