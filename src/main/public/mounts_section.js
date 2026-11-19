import data_table from './data_table.js';
import format_bytes from './format_bytes.js';
import format_ms_ago from './format_ms_ago.js';
import mounts_write from './mounts_write.js';
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
            <div class="sf-fields fwd-step">

                    <select ref="first" v-model="fresh.from_remote" aria-label="The machine the folder is on">
                        <option value="">a machine…</option>
                        <option :value="here_value">this host — serviceman's {{ state_folder }}/</option>
                        <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>
                    <input v-model.trim="fresh.from" :placeholder="from_hint" spellcheck="false" aria-label="The folder there" @keyup.enter="write">
                    <div class="fwd-end-says" :class="{bad: (from_says.bad)}">{{ from_says.text }}</div>
            </div>
        </template>
        <template #to>
            <div class="sf-fields fwd-step">

                    <select v-model="fresh.to_remote" aria-label="The machine it is mounted on">
                        <option value="">a machine…</option>
                        <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>
                    <input v-model.trim="fresh.to" placeholder="/mnt/photos" spellcheck="false" aria-label="The folder it is mounted at there" @keyup.enter="write">
                    <div class="fwd-end-says" :class="{bad: (to_says.bad)}">{{ to_says.text }}</div>
            <div class="mount-modes" role="radiogroup" aria-label="What the machine it is mounted on may do">
                <label :class="{on: (fresh.mode === 'ro')}"><input v-model="fresh.mode" type="radio" value="ro"><span><b>Read-only</b> <span class="muted">— nothing there may change it</span></span></label>
                <label :class="{on: (fresh.mode === 'rw')}"><input v-model="fresh.mode" type="radio" value="rw"><span><b>Read-write</b> <span class="muted">— files are written, renamed and removed there</span></span></label>
            </div>
            </div>
        </template>
        <template #check>
            <div class="sf-fields">
            <p class="fwd-sum" :class="{muted: (summary === null)}">{{ (summary === null ? 'Pick both machines and both folders.' : summary) }}</p>
                <div class="fwd-make-foot"><label>Label <input v-model.trim="fresh.label" class="fwd-label" :placeholder="label_auto" maxlength="100" spellcheck="false" title="Any text, one per mount; left empty, the one shown" @keyup.enter="write"></label></div>
            </div>
        </template>
        <template #summary>
            <div class="sum-head"><b>{{ fresh.label || label_auto || 'not named yet' }}</b></div>
            <p class="sum-line"><span>{{ (summary === null) ? 'Pick both machines and both folders.' : summary }}</span></p>
        </template>
        <template #note>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <div class="list-head">
        <h1>Mounts</h1>
        <span class="muted">{{ mounts.length }}</span>
        <div class="list-acts">
            <button type="button" class="primary" :disabled="making" @click="begin">+ Mount…</button>
        </div>
    </div>
    <p class="muted">A folder of one machine, mounted on another: <code>laptop · ~/Pictures → vps1 · /mnt/photos</code>. The machine on the right mounts it with sshfs, which speaks to the folder straight through the agent of the machine on the left, over the tailnet; an agent too old for that, or one that cannot be reached that way, goes over both machines' links through serviceman instead. No ssh and no key. It sees that folder and nothing outside it, read-only or read-write as you pick. The folder may be serviceman's own state dir, <code>{{ state_folder }}/</code>. The machine that mounts needs the agent's root half (<code>sudo bin/install-root</code> in the agent's folder); sshfs is installed there when it is missing.</p>
    <data-table :columns="columns" :rows="mounts" row_key="label" :row_class="v => (v.off ? 'off' : [])" actions_label="On">
        <template #cell="{row, column}">
            <template v-if="(column.key === 'label')">{{ row.label }}</template>
            <template v-else-if="(column.key === 'from')"><span class="muted">{{ from_place(row.from) }} · </span><code>{{ from_text(row.from) }}</code></template>
            <template v-else-if="(column.key === 'to')"><span class="muted">{{ title_of(row.to.remote) }} · </span><code>{{ row.to.path }}</code></template>
            <span v-else-if="(column.key === 'mode')" :class="(row.mode === 'rw' ? 'mount-rw' : 'muted')">{{ (row.mode === 'rw' ? 'read-write' : 'read-only') }}</span>
            <span v-else-if="(column.key === 'now')" class="dt-state" :class="{bad: bad_of(row)}"><span class="dot" :class="dot_of(row)"/>{{ word_of(row) }}<span v-if="((row.state === 'mounted') && (row.way === 'straight'))" class="muted" title="Straight to the agent of the folder's machine: serviceman carries none of it"> · straight</span><span v-else-if="((row.state === 'mounted') && (row.way_why !== null))" class="muted" :title="('Not straight: ' + row.way_why)"> · through serviceman</span></span>
            <span v-else-if="(column.key === 'problem')" :class="(row.problem === null ? 'muted' : 'bad')">{{ wrong_text(row) }}</span>
            <span v-else-if="(column.key === 'through')" class="muted">{{ through_text(row) }}</span>
        </template>
        <template #actions="{row, close}">
            <label title="Mounted, or set aside for now"><input type="checkbox" :checked="(row.off === false)" :disabled="busy" @change="turn(row, $event.target.checked)">mounted</label>
            <button type="button" :disabled="busy" @click="close(); edit(row)">edit</button>
            <button type="button" class="danger" :disabled="busy" @click="drop(row)">forget it</button>
        </template>
        <template #empty>No mounts yet — <button type="button" class="link" :disabled="making" @click="begin">mount the first one</button>: serviceman's {{ state_folder }}/ on a server, read-only, say.</template>
    </data-table>
    </template>
</div>
`,
    components: {'step-frame': step_frame, 'data-table': data_table},
    props: ['state'],
    emits: [],
    data: function () {
        // `editing` is the mount the window is rewriting, by the label it had; `here_value` is
        // serviceman itself in the picker
        return {fresh: fresh_empty(), step: 0, mode: 'steps', making: false, editing: null, note: '', bad: false, busy: false, here_value: HERE};
    },
    computed: {
        mounts: function () {
            return ((this.state === null) || (this.state.mounts === undefined)) ? [] : this.state.mounts;
        },
        wrongs: function () {
            return this.mounts.some(v => this.wrong_text(v) !== '');
        },
        columns: function () {
            const out = [
                {key: 'label', label: 'Label', wraps: true},
                // The folder's path takes what the row has left, cut with … (its whole under the row)
                {key: 'from', label: 'Folder', fold: 6, clip: true},
                {key: 'to', label: 'Mounted on', fold: 5},
                {key: 'mode', label: 'Mode', fold: 4},
                {key: 'now', label: 'Now'},
            ];
            if (this.wrongs) {
                out.push({key: 'problem', label: 'What is wrong', fold: 2, hide: v => (this.wrong_text(v) === '')});
            }
            out.push({key: 'through', label: 'Through it', fold: 3});
            return out;
        },
        machines: function () {
            return (this.state === null) ? [] : this.state.remotes;
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: (v.phase === 'online') ? (v.title || v.name) : `${v.title || v.name} · offline`}));
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
                {key: 'from', name: 'From', question: 'Which folder, on which machine?', answer: (this.fresh.from === '') ? '' : this.fresh.from},
                {key: 'to', name: 'To', question: 'Where does it appear?', answer: (this.fresh.to === '') ? '' : this.fresh.to},
            ];
            if ((this.editing === null) && (this.mode === 'steps')) {
                out.push({key: 'check', name: 'Check', question: 'Check, then mount it', answer: ''});
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
