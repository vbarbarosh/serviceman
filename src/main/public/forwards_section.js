import data_table from './data_table.js';
import format_bps from './format_bps.js';
import format_bytes from './format_bytes.js';
import format_ms_ago from './format_ms_ago.js';
import forward_end_parse from './forward_end_parse.js';
import forward_here_parse from './forward_here_parse.js';
import forward_now_said from './forward_now_said.js';
import forward_state from './forward_state.js';
import forwards_write from './forwards_write.js';
import step_frame from './step_frame.js';

// A port or a socket of one machine, brought to another: `from` is where the service is, `to`
// is where it shows up. The machine at `to` listens; each connection is carried over its link
// to serviceman, and over the other machine's link to `from`.
// No ssh, no key: the links are already up, and the socket stays while one of them redials.
// The machine at `to` may be serviceman itself, which then listens in place of an agent.
const forwards_section = {
    template: `
<div class="forwards">
    <step-frame v-if="making" :title="((editing === null) ? 'New forward' : ('Change ' + editing.label))" :steps="steps" :step="step" :mode="((editing === null) ? mode : 'page')" :switchable="(editing === null)" :can_next="step_ok.ok" :next_title="step_ok.why" :busy="busy" :create_label="((editing === null) ? 'Add the forward' : 'Save')" @step="step_go" @mode="mode = $event" @cancel="clear" @create="write">
        <template #from>
            <div class="sf-fields fwd-step">

                    <select ref="first" v-model="fresh.from_remote" aria-label="The machine the service is on">
                        <option value="">a machine…</option>
                        <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>
                    <input v-model.trim="fresh.from" placeholder="3100" spellcheck="false" aria-label="Its port, address or socket there" title="A port on its loopback (3100), an address it reaches (10.0.0.5:3100), or a socket file (/run/app.sock)" @keyup.enter="write">
                    <div class="fwd-end-says" :class="{bad: (from_says.bad)}">{{ from_says.text }}</div>
            </div>
        </template>
        <template #to>
            <div class="sf-fields fwd-step">

                    <select v-model="fresh.to_remote" aria-label="The machine it shows up on">
                        <option value="">a machine…</option>
                        <option :value="here_value">this host — where serviceman runs</option>
                        <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>
                    <input v-model.trim="fresh.to" :placeholder="to_hint.placeholder" spellcheck="false" :aria-label="to_hint.label" :title="to_hint.title" @keyup.enter="write">
                    <div class="fwd-end-says" :class="{bad: (to_says.bad)}">{{ to_says.text }}</div>

            </div>
        </template>
        <template #check>
            <div class="sf-fields">
            <p class="fwd-sum" :class="{muted: (summary === null)}">{{ (summary === null ? 'Pick both machines and what to bring.' : summary) }}</p>
                <div class="fwd-make-foot"><label>Label <input v-model.trim="fresh.label" class="fwd-label" :placeholder="label_auto" maxlength="100" spellcheck="false" title="Any text, one per forward; left empty, the one shown" @keyup.enter="write"></label></div>
            </div>
        </template>
        <template #summary>
            <div class="sum-head"><b>{{ fresh.label || label_auto || 'not named yet' }}</b></div>
            <p class="sum-line"><span>{{ (summary === null) ? 'Pick both machines and what to bring.' : summary }}</span></p>
        </template>
        <template #note>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <div class="list-head">
        <h1>Forwards</h1>
        <span class="muted">{{ forwards.length }}</span>
        <div class="list-acts">
            <button type="button" class="primary" :disabled="making" @click="begin">+ Add forward</button>
        </div>
    </div>
    <p class="muted">A port or a socket file of one machine, brought to another, as <code>ssh -L</code> brings one: <code>vps1 → laptop</code> is a service on vps1 that shows up on the laptop. The machine on the right listens — a socket only the agent's user may open, or a port on its loopback — and each connection goes straight to the agent of the machine on the left, over the tailnet, and on to the service there; serviceman carries none of it. An agent too old for that, or a machine whose agent cannot be reached that way, rides both machines' links through serviceman instead. No ssh and no key: the agents are already there. When both are one machine, an app of this host opened on the laptop by <code>localhost</code> say, its agent joins the two itself. While a link is down the socket stays, and a connection to it is closed at once. It may show up on this host, where serviceman runs, with no agent: serviceman listens itself, and a socket lands in its state dir, <code>{{ state_folder }}/</code>.</p>
    <data-table :columns="columns" :rows="forwards" row_key="label" :row_class="v => (v.off ? 'off' : [])" actions_label="On">
        <template #cell="{row, column}">
            <template v-if="(column.key === 'label')">{{ row.label }}<span v-if="(row.by !== null)" class="muted" :title="by_title(row.by)"> · by {{ row.by.label }}<template v-if="row.by.revoked"> (revoked)</template></span><span v-if="(row.service !== null)" class="muted" title="It brings the port of this program over, and goes with it: renamed and removed with it, changed on its page"> · part of {{ row.service }}</span></template>
            <template v-else-if="(column.key === 'from')"><span class="muted">{{ title_of(row.from.remote) }} · </span><code>{{ end_text(row.from) }}</code></template>
            <template v-else-if="(column.key === 'to')"><span class="muted">{{ place_of(row.to) }} · </span><code :title="(row.at === null ? '' : row.at)">{{ landed_text(row.to) }}</code></template>
            <span v-else-if="(column.key === 'now')"><forward-state :forward="row" :remotes="machines"/><span v-if="((row.state === 'ready') && (row.way === 'straight'))" class="muted" title="Joined by the agents alone: serviceman carries none of it"> · straight</span><span v-else-if="((row.state === 'ready') && (row.way_why !== null))" class="muted" :title="('Not straight: ' + row.way_why)"> · through serviceman</span></span>
            <span v-else-if="(column.key === 'problem')" :class="(problem_of(row) === null ? 'muted' : 'bad')">{{ wrong_text(row) }}</span>
            <template v-else-if="(column.key === 'speed')"><span class="fwd-speed" :class="{muted: idle(row)}">{{ speed_text(row) }}</span> <svg class="fwd-spark" viewBox="0 0 80 18" width="56" height="18" preserveAspectRatio="none" :aria-label="('the last ' + history_minutes(row) + ' minutes')"><polyline class="back" :points="spark(row, row.history_back)"/><polyline class="sent" :points="spark(row, row.history_sent)"/></svg></template>
            <span v-else-if="(column.key === 'through')" class="muted">{{ through_text(row) }}</span>
        </template>
        <template #actions="{row, close}">
            <label title="Listening, or set aside for now"><input type="checkbox" :checked="(row.off === false)" :disabled="busy" @change="turn(row, $event.target.checked)">listening</label>
            <button type="button" :disabled="busy" @click="close(); edit(row)">edit</button>
            <button type="button" class="danger" :disabled="busy" @click="drop(row)">forget it</button>
        </template>
        <template #empty>No forwards yet — <button type="button" class="link" :disabled="making" @click="begin">add the first one</button>: a socket on the laptop, say, answered by a port on a server.</template>
    </data-table>
    </template>
</div>
`,
    components: {'step-frame': step_frame, 'data-table': data_table, 'forward-state': forward_state},
    props: ['state'],
    emits: [],
    data: function () {
        // `editing` is the forward the line below is rewriting, by the label it had; `here_value`
        // is serviceman itself in the picker
        return {fresh: fresh_empty(), step: 0, mode: 'steps', making: false, editing: null, note: '', bad: false, busy: false, here_value: HERE};
    },
    computed: {
        forwards: function () {
            return ((this.state === null) || (this.state.forwards === undefined)) ? [] : this.state.forwards;
        },
        // Whether any forward has something wrong to tell, now or last time: else no column for it
        wrongs: function () {
            return this.forwards.some(v => this.wrong_text(v) !== '');
        },
        // The table's columns, each that may fold with when: what is wrong first, where it is from last
        columns: function () {
            const out = [
                {key: 'label', label: 'Label', wraps: true},
                {key: 'from', label: 'From', fold: 6},
                {key: 'to', label: 'Shows up on', fold: 5},
                {key: 'now', label: 'Now'},
            ];
            if (this.wrongs) {
                out.push({key: 'problem', label: 'What is wrong', fold: 2, hide: v => (this.wrong_text(v) === '')});
            }
            out.push({key: 'speed', label: 'Speed', fold: 4}, {key: 'through', label: 'Through it', fold: 3});
            return out;
        },
        machines: function () {
            return (this.state === null) ? [] : this.state.remotes;
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: (v.phase === 'online') ? (v.title || v.name) : `${v.title || v.name} · offline`}));
        },
        // Each end as typed, said back in words under its box
        from_says: function () {
            return end_says(this.fresh.from_remote, this.fresh.from, this.title_of(this.fresh.from_remote), false);
        },
        // The folder a socket of serviceman's own lands in, as its owner sees it beside the
        // config: data/ under bin/run
        state_folder: function () {
            if ((this.state === null) || (typeof this.state.state_dir !== 'string')) {
                return 'data';
            }
            return this.state.state_dir.replace(/\/+$/, '').split('/').pop();
        },
        // What the box under the picker asks for: on serviceman itself a path inside its state dir
        to_hint: function () {
            if (this.fresh.to_remote === HERE) {
                return {placeholder: 'sockets/loki.sock or 3100', label: 'A socket file in serviceman\'s state dir, or a port on its loopback', title: 'A socket file inside serviceman\'s state dir, written from it (sockets/loki.sock), or a port on its loopback'};
            }
            return {placeholder: '~/loki.sock or 3100', label: 'A socket file or a port there', title: 'A socket file there (~/ is the agent\'s user\'s home), or a port on its loopback'};
        },
        to_says: function () {
            if (this.fresh.to_remote === HERE) {
                return here_says(this.fresh.to, this.state_folder);
            }
            const says = end_says(this.fresh.to_remote, this.fresh.to, this.title_of(this.fresh.to_remote), true);
            if ((says.bad === false) && this.one_machine && end_loops(forward_end_parse(this.fresh.from_remote, this.fresh.from), forward_end_parse(this.fresh.to_remote, this.fresh.to))) {
                return {text: 'where the service is: each connection would reach itself; pick another', bad: true};
            }
            return says;
        },
        // From, To, then Check; a change is one page of them
        steps: function () {
            const out = [
                {key: 'from', name: 'From', question: 'What to bring over?', answer: (this.fresh.from === '') ? '' : this.fresh.from},
                {key: 'to', name: 'To', question: 'Where does it come out?', answer: (this.fresh.to === '') ? '' : this.fresh.to},
            ];
            if ((this.editing === null) && (this.mode === 'steps')) {
                out.push({key: 'check', name: 'Check', question: 'Check, then add it', answer: ''});
            }
            return out;
        },
        // What the open step wants before Next: both halves of its end, and nothing said wrong
        step_ok: function () {
            const key = (this.mode === 'page') ? 'check' : this.steps[Math.min(this.step, this.steps.length - 1)].key;
            if ((key === 'from') && ((this.fresh.from_remote === '') || (this.fresh.from === '') || this.from_says.bad)) {
                return {ok: false, why: this.from_says.bad ? this.from_says.text : 'Its machine and its port or socket first'};
            }
            if ((key === 'to') && ((this.fresh.to_remote === '') || (this.fresh.to === '') || this.to_says.bad)) {
                return {ok: false, why: this.to_says.bad ? this.to_says.text : 'Where it comes out first'};
            }
            return {ok: true, why: ''};
        },
        ready: function () {
            const fresh = this.fresh;
            return (fresh.from_remote !== '') && (fresh.to_remote !== '') && (fresh.from !== '') && (fresh.to !== '') && (this.from_says.bad === false) && (this.to_says.bad === false);
        },
        // The whole forward in one sentence, once both ends are there
        summary: function () {
            if (this.ready === false) {
                return null;
            }
            const fresh = this.fresh;
            const to = (fresh.to_remote === HERE) ? this.landed_text(forward_here_parse(fresh.to)) : fresh.to;
            const said = `A connection to ${end_words(to)} on ${this.place_title(fresh.to_remote)} reaches ${end_words(fresh.from)} on ${this.title_of(fresh.from_remote)}`;
            return this.one_machine ? `${said}: its agent joins the two itself, and serviceman carries none of it.` : `${said}.`;
        },
        // Both ends on one machine: its agent joins them, and nothing goes through serviceman
        one_machine: function () {
            return (this.fresh.from_remote !== '') && (this.fresh.from_remote === this.fresh.to_remote);
        },
        way_words: function () {
            return this.one_machine ? 'straight, on that machine' : 'agent to agent, over the tailnet';
        },
        // The label a forward gets when none is typed: the socket's name, or the machine and port
        label_auto: function () {
            const from = this.fresh.from;
            const socket = /([A-Za-z0-9_-]+)(\.sock)?$/.exec(from.startsWith('/') || from.startsWith('~/') ? from : '');
            if (socket !== null) {
                return socket[1].toLowerCase();
            }
            const port = /(\d+)$/.exec(from);
            if ((this.fresh.from_remote === '') || (port === null)) {
                return 'loki';
            }
            return `${this.fresh.from_remote}-${port[1]}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        },
    },
    // Esc puts the form's window away, wherever the focus went (a busy button lets it go)
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
        // What stands in its way now, in full, where its word on the line (forward-state) does
        // not say it all; null when nothing does
        problem_of: function (item) {
            return forward_now_said(item, this.machines).problem;
        },
        // What stands in its way now, else the last failure, else nothing
        wrong_text: function (item) {
            const problem = this.problem_of(item);
            if (problem !== null) {
                return problem;
            }
            return (item.error === null) ? '' : `last failure ${this.ago(item.error_at)}: ${item.error}`;
        },
        idle: function (item) {
            return (item.speed_sent === 0) && (item.speed_back === 0);
        },
        // Each way, now: what went to the service and what came back, a second at a time
        speed_text: function (item) {
            return this.idle(item) ? 'idle' : `↑ ${format_bps(item.speed_sent)} ↓ ${format_bps(item.speed_back)}`;
        },
        history_minutes: function (item) {
            return Math.max(1, Math.round(item.history_back.length/12));
        },
        // One way's last ten minutes as a line; both ways share one scale, so they compare
        spark: function (item, values) {
            const top = Math.max(1, ...item.history_sent, ...item.history_back);
            const step = (80/Math.max(1, (HISTORY_LENGTH - 1)));
            const left = (80 - (values.length - 1)*step);
            return values.map((v, index) => `${(left + index*step).toFixed(1)},${(17 - (v/top)*16).toFixed(1)}`).join(' ');
        },
        through_text: function (item) {
            if (item.total === 0) {
                return 'nothing yet';
            }
            return `${item.open} open · ${item.total} in all · ↑ ${this.bytes(item.bytes_sent)} ↓ ${this.bytes(item.bytes_back)}`;
        },
        title_of: function (name) {
            const found = this.machines.find(v => v.name === name);
            return (found === undefined) ? name : (found.title || found.name);
        },
        // Who asked for a forward, said in full where the line has room for a word
        by_title: function (by) {
            return by.revoked ? `Asked for by the token ${by.label}, since revoked` : `Asked for by the token ${by.label}, through the control door`;
        },
        // The machine one end is on, serviceman itself included, as a picker's value names it
        place_title: function (value) {
            return (value === HERE) ? 'this host' : this.title_of(value);
        },
        place_of: function (forward_end) {
            return forward_end.here ? 'this host' : this.title_of(forward_end.remote);
        },
        // An end as the table shows it: a socket of serviceman's own where it lands, in its
        // state dir; the rest as written
        landed_text: function (forward_end) {
            if (forward_end.here && (typeof forward_end.socket === 'string')) {
                return `${this.state_folder}/${forward_end.socket}`;
            }
            return this.end_text(Object.assign({socket: null, host: null}, forward_end));
        },
        end_text: function (forward_end) {
            if (forward_end.socket !== null) {
                return forward_end.socket;
            }
            return (forward_end.host === null) ? String(forward_end.port) : `${forward_end.host}:${forward_end.port}`;
        },
        bytes: function (value) {
            return format_bytes(value);
        },
        ago: function (at) {
            return format_ms_ago(this.state.now - at);
        },
        // One forward written, new or the one being edited, which may have been renamed
        write: async function () {
            if (this.ready === false) {
                return;
            }
            const fresh = Object.assign({}, this.fresh, {label: (this.fresh.label === '') ? this.label_auto : this.fresh.label});
            const from = forward_end_parse(fresh.from_remote, fresh.from);
            const to = (fresh.to_remote === HERE) ? forward_here_parse(fresh.to) : forward_end_parse(fresh.to_remote, fresh.to);
            if (typeof from === 'string') {
                this.report(`from: ${from}`, true);
                return;
            }
            if (typeof to === 'string') {
                this.report(`shows up on: ${to}`, true);
                return;
            }
            if (to.host !== undefined) {
                this.report('shows up on: a port or a socket on that machine — it listens on its loopback, not on an address', true);
                return;
            }
            const editing = this.editing;
            const written = await this.forwards_write(function (forwards) {
                const at = forwards.findIndex(v => label_of(v) === ((editing === null) ? fresh.label : editing.label));
                const kept = ((at === -1) || (editing === null)) ? false : (forwards[at].off === true);
                // One that is part of a program stays its part, changed here or on its page
                const service = ((at === -1) || (editing === null)) ? undefined : forwards[at].service;
                const forward = Object.assign({label: fresh.label}, (service === undefined) ? {} : {service}, {from, to}, kept ? {off: true} : {});
                if ((editing === null) || (at === -1)) {
                    forwards.push(forward);
                    return;
                }
                forwards[at] = forward;
            });
            if (written) {
                this.clear();
            }
        },
        // The form shows up only to add or to change one, at the top, where the eye goes next
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
            this.fresh = {label: item.label, from_remote: item.from.remote, from: this.end_text(item.from), to_remote: item.to.here ? HERE : item.to.remote, to: this.end_text(item.to)};
            this.report('', false);
            this.form_show();
        },
        // The form opens in its window over the list, ready to type in
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
        // Set aside for now, and put back later, without retyping either end
        turn: async function (item, on) {
            await this.forwards_write(function (forwards) {
                const found = forwards.find(v => label_of(v) === item.label);
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
        // The form open on the forward that is forgotten goes with it. One the door did not
        // forget keeps its form: what was typed there stays, and what the door said is in it.
        drop: async function (item) {
            const written = await this.forwards_write(function (forwards) {
                const at = forwards.findIndex(v => label_of(v) === item.label);
                if (at !== -1) {
                    forwards.splice(at, 1);
                }
            });
            if (written && (this.editing !== null) && (this.editing.label === item.label)) {
                this.clear();
            }
        },
        forwards_write: async function (change) {
            this.busy = true;
            this.report('', false);
            const problem = await forwards_write(change);
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

// One end as typed, in words: what it is and where, or what is wrong with it
function end_says(remote, text, title, listens)
{
    if (text === '') {
        return {text: listens ? 'a socket file or a port there' : 'a port, an address or a socket there', bad: false};
    }
    const forward_end = forward_end_parse(remote, text);
    if (typeof forward_end === 'string') {
        return {text: forward_end, bad: true};
    }
    const machine = (remote === '') ? 'that machine' : title;
    if (forward_end.socket !== undefined) {
        return {text: listens ? `a socket file on ${machine}, only its agent's user may open it` : `the socket file ${forward_end.socket} on ${machine}`, bad: false};
    }
    if (forward_end.host !== undefined) {
        return listens ? {text: 'a port or a socket here: it listens on its loopback, not on an address', bad: true} : {text: `${forward_end.host}:${forward_end.port}, as ${machine} reaches it`, bad: false};
    }
    return {text: `port ${forward_end.port} on the loopback of ${machine}`, bad: false};
}

// Where it shows up on serviceman itself, as typed, in words: where the socket lands on the
// host, or the port, or what is wrong with it
function here_says(text, folder)
{
    if (text === '') {
        return {text: `a socket file in serviceman's state dir, ${folder}/, or a port on its loopback`, bad: false};
    }
    const forward_end = forward_here_parse(text);
    if (typeof forward_end === 'string') {
        return {text: forward_end, bad: true};
    }
    if (forward_end.socket !== undefined) {
        return {text: `the socket file ${folder}/${forward_end.socket}, 0600, for the owner of ${folder}/`, bad: false};
    }
    return {text: `port ${forward_end.port} on serviceman's own loopback — under docker, inside its container`, bad: false};
}

// Whether a forward on one machine would dial where it listens itself, each connection opening
// one more: the same socket file, or the same port on its loopback
function end_loops(from, to)
{
    if ((typeof from === 'string') || (typeof to === 'string')) {
        return false;
    }
    if (from.socket !== undefined) {
        return (from.socket === to.socket);
    }
    const loopback = (from.host === undefined) || (from.host === '127.0.0.1') || (from.host === 'localhost');
    return loopback && (to.port !== undefined) && (from.port === to.port);
}

// An end as typed, in words: a bare number is a port, the rest reads as it is
function end_words(text)
{
    if (/^\d+$/.test(text)) {
        return `port ${text}`;
    }
    return text;
}

// The picker's value for serviceman itself, a name no machine is given in practice: machines
// are named in words, and the empty value is "a machine…"
const HERE = ':here';

// The 5-second buckets the server keeps for a forward: ten minutes
const HISTORY_LENGTH = 120;

function fresh_empty()
{
    return {label: '', from_remote: '', from: '', to_remote: '', to: ''};
}

// A forward as the config file has it: one written before labels carries `name`
function label_of(forward)
{
    return (forward.label === undefined) ? forward.name : forward.label;
}

export default forwards_section;
