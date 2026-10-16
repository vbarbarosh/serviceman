import data_table from './data_table.js';
import format_bps from './format_bps.js';
import format_bytes from './format_bytes.js';
import format_ms_ago from './format_ms_ago.js';
import forward_end_parse from './forward_end_parse.js';
import forward_here_parse from './forward_here_parse.js';
import forwards_write from './forwards_write.js';

// A port or a socket of one machine, brought to another: `from` is where the service is, `to`
// is where it shows up. The machine at `to` listens; each connection is carried over its link
// to serviceman, and over the other machine's link to `from`.
// No ssh, no key: the links are already up, and the socket stays while one of them redials.
// The machine at `to` may be serviceman itself, which then listens in place of an agent.
const forwards_section = {
    template: `
<div class="forwards">
    <div class="list-head">
        <h1>Forwards</h1>
        <span class="muted">{{ forwards.length }}</span>
        <div class="list-acts">
            <button type="button" class="primary" :disabled="making" @click="begin">+ Add forward</button>
        </div>
    </div>
    <p class="muted">A port or a socket file of one machine, brought to another, as <code>ssh -L</code> brings one: <code>vps1 → laptop</code> is a service on vps1 that shows up on the laptop. The machine on the right listens — a socket only the agent's user may open, or a port on its loopback — and each connection rides both machines' links through serviceman to the service on the left. No ssh and no key: the links are already up. While a link is down the socket stays, and a connection to it is closed at once. It may show up on this host, where serviceman runs, with no agent: serviceman listens itself, and a socket lands in its state dir, <code>{{ state_folder }}/</code>.</p>
    <div v-if="making" ref="make" class="fwd-make" :class="{editing: (editing !== null)}" @keyup.esc="clear">
        <h2>{{ (editing === null ? 'Bring a port or a socket over' : 'Change ' + editing.label) }}</h2>
        <div class="fwd-ends">
            <div class="fwd-end">
                <div class="fwd-end-title">The service is on</div>
                <select ref="first" v-model="fresh.from_remote" aria-label="The machine the service is on">
                    <option value="">a machine…</option>
                    <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
                <input v-model.trim="fresh.from" placeholder="3100" spellcheck="false" aria-label="Its port, address or socket there" title="A port on its loopback (3100), an address it reaches (10.0.0.5:3100), or a socket file (/run/app.sock)" @keyup.enter="write">
                <div class="fwd-end-says" :class="{bad: (from_says.bad)}">{{ from_says.text }}</div>
            </div>
            <div class="fwd-arrow" aria-hidden="true">
                <svg class="across" viewBox="0 0 120 24" preserveAspectRatio="none"><path d="M2 12 H110" stroke="currentColor" stroke-width="2" stroke-dasharray="6 5"/><path d="M106 5 L117 12 L106 19" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                <svg class="down" viewBox="0 0 24 48" width="24" height="48"><path d="M12 2 V38" stroke="currentColor" stroke-width="2" stroke-dasharray="6 5"/><path d="M5 34 L12 45 L19 34" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                <span>over the agents' links</span>
            </div>
            <div class="fwd-end">
                <div class="fwd-end-title">It shows up on</div>
                <select v-model="fresh.to_remote" aria-label="The machine it shows up on">
                    <option value="">a machine…</option>
                    <option :value="here_value">this host — where serviceman runs</option>
                    <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
                <input v-model.trim="fresh.to" :placeholder="to_hint.placeholder" spellcheck="false" :aria-label="to_hint.label" :title="to_hint.title" @keyup.enter="write">
                <div class="fwd-end-says" :class="{bad: (to_says.bad)}">{{ to_says.text }}</div>
            </div>
        </div>
        <p class="fwd-sum" :class="{muted: (summary === null)}">{{ (summary === null ? 'Pick both machines and what to bring.' : summary) }}</p>
        <div class="fwd-make-foot">
            <label>Label <input v-model.trim="fresh.label" class="fwd-label" :placeholder="label_auto" maxlength="100" spellcheck="false" title="Any text, one per forward; left empty, the one shown" @keyup.enter="write"></label>
            <button type="button" class="primary" :disabled="(busy || ready === false)" @click="write">{{ (editing === null ? 'Add' : 'Save') }}</button>
            <button type="button" :disabled="busy" @click="clear">Cancel</button>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </div>
    </div>
    <data-table :columns="columns" :rows="forwards" row_key="label" :row_class="v => (v.off ? 'off' : [])" actions_label="On">
        <template #cell="{row, column}">
            <template v-if="(column.key === 'label')">{{ row.label }}</template>
            <template v-else-if="(column.key === 'from')"><span class="muted">{{ title_of(row.from.remote) }} · </span><code>{{ end_text(row.from) }}</code></template>
            <template v-else-if="(column.key === 'to')"><span class="muted">{{ place_of(row.to) }} · </span><code :title="(row.at === null ? '' : row.at)">{{ landed_text(row.to) }}</code></template>
            <span v-else-if="(column.key === 'now')" class="dt-state" :class="{bad: bad_of(row)}"><span class="dot" :class="dot_of(row)"/>{{ word_of(row) }}</span>
            <span v-else-if="(column.key === 'problem')" :class="(problem_of(row) === null ? 'muted' : 'bad')">{{ wrong_text(row) }}</span>
            <template v-else-if="(column.key === 'speed')"><span class="fwd-speed" :class="{muted: idle(row)}">{{ speed_text(row) }}</span> <svg class="fwd-spark" viewBox="0 0 80 18" width="56" height="18" preserveAspectRatio="none" :aria-label="('the last ' + history_minutes(row) + ' minutes')"><polyline class="back" :points="spark(row, row.history_back)"/><polyline class="sent" :points="spark(row, row.history_sent)"/></svg></template>
            <span v-else-if="(column.key === 'through')" class="muted">{{ through_text(row) }}</span>
        </template>
        <template #actions="{row}">
            <label title="Listening, or set aside for now"><input type="checkbox" :checked="(row.off === false)" :disabled="busy" @change="turn(row, $event.target.checked)">listening</label>
            <button type="button" :disabled="busy" @click="edit(row)">edit</button>
            <button type="button" class="danger" :disabled="busy" @click="drop(row)">forget it</button>
        </template>
        <template #empty>No forwards yet — <button type="button" class="link" :disabled="making" @click="begin">add the first one</button>: a socket on the laptop, say, answered by a port on a server.</template>
    </data-table>
</div>
`,
    components: {'data-table': data_table},
    props: ['state'],
    emits: [],
    data: function () {
        // `editing` is the forward the line below is rewriting, by the label it had; `here_value`
        // is serviceman itself in the picker
        return {fresh: fresh_empty(), making: false, editing: null, note: '', bad: false, busy: false, here_value: HERE};
    },
    computed: {
        forwards: function () {
            return (((this.state === null) || (this.state.forwards === undefined)) ? [] : this.state.forwards);
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
            return ((this.state === null) ? [] : this.state.remotes);
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: ((v.phase === 'online') ? (v.title || v.name) : `${v.title || v.name} · offline`)}));
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
            if ((says.bad === false) && (this.fresh.to_remote !== '') && (this.fresh.to_remote === this.fresh.from_remote)) {
                return {text: 'the same machine as the service: pick another', bad: true};
            }
            return says;
        },
        ready: function () {
            const fresh = this.fresh;
            return ((fresh.from_remote !== '') && (fresh.to_remote !== '') && (fresh.from !== '') && (fresh.to !== '') && (this.from_says.bad === false) && (this.to_says.bad === false));
        },
        // The whole forward in one sentence, once both ends are there
        summary: function () {
            if (this.ready === false) {
                return null;
            }
            const fresh = this.fresh;
            const to = ((fresh.to_remote === HERE) ? this.landed_text(forward_here_parse(fresh.to)) : fresh.to);
            return `A connection to ${end_words(to)} on ${this.place_title(fresh.to_remote)} reaches ${end_words(fresh.from)} on ${this.title_of(fresh.from_remote)}.`;
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
    methods: {
        // Where it stands, in a word or two; the whole of it is under What is wrong
        word_of: function (item) {
            const words = {
                ready: 'ready',
                aside: 'set aside',
                old_agent: 'agent too old',
                telling: 'starting',
                from_offline: `${this.title_of(item.from.remote)} offline`,
                cannot_listen: 'cannot listen',
                link_down: `${this.title_of(item.to.remote)} link down`,
                to_offline: `${this.title_of(item.to.remote)} offline`,
            };
            return ((words[item.state] === undefined) ? item.state : words[item.state]);
        },
        dot_of: function (item) {
            if (item.state === 'ready') {
                return 'running';
            }
            if (item.state === 'telling') {
                return 'starting';
            }
            return ((item.state === 'aside') ? '' : 'failed');
        },
        bad_of: function (item) {
            return ['ready', 'aside', 'telling'].includes(item.state) === false;
        },
        // What stands in its way now, in full, where its word on the line does not say it all;
        // null when nothing does
        problem_of: function (item) {
            if ((item.problem === null) || item.off || ['from_offline', 'to_offline'].includes(item.state)) {
                return null;
            }
            return item.problem;
        },
        // What stands in its way now, else the last failure, else nothing
        wrong_text: function (item) {
            const problem = this.problem_of(item);
            if (problem !== null) {
                return problem;
            }
            return ((item.error === null) ? '' : `last failure ${this.ago(item.error_at)}: ${item.error}`);
        },
        idle: function (item) {
            return ((item.speed_sent === 0) && (item.speed_back === 0));
        },
        // Each way, now: what went to the service and what came back, a second at a time
        speed_text: function (item) {
            return (this.idle(item) ? 'idle' : `↑ ${format_bps(item.speed_sent)} ↓ ${format_bps(item.speed_back)}`);
        },
        history_minutes: function (item) {
            return Math.max(1, Math.round(item.history_back.length/12));
        },
        // One way's last ten minutes as a line; both ways share one scale, so they compare
        spark: function (item, values) {
            const top = Math.max(1, ...item.history_sent, ...item.history_back);
            const step = (80/Math.max(1, (HISTORY_LENGTH - 1)));
            const left = (80 - (values.length - 1)*step);
            return values.map((v, i) => `${(left + i*step).toFixed(1)},${(17 - (v/top)*16).toFixed(1)}`).join(' ');
        },
        through_text: function (item) {
            if (item.total === 0) {
                return 'nothing yet';
            }
            return `${item.open} open · ${item.total} in all · ↑ ${this.bytes(item.bytes_sent)} ↓ ${this.bytes(item.bytes_back)}`;
        },
        title_of: function (name) {
            const found = this.machines.find(v => v.name === name);
            return ((found === undefined) ? name : (found.title || found.name));
        },
        // The machine one end is on, serviceman itself included, as a picker's value names it
        place_title: function (value) {
            return ((value === HERE) ? 'this host' : this.title_of(value));
        },
        place_of: function (end) {
            return (end.here ? 'this host' : this.title_of(end.remote));
        },
        // An end as the table shows it: a socket of serviceman's own where it lands, in its
        // state dir; the rest as written
        landed_text: function (end) {
            if (end.here && (typeof end.socket === 'string')) {
                return `${this.state_folder}/${end.socket}`;
            }
            return this.end_text(Object.assign({socket: null, host: null}, end));
        },
        end_text: function (end) {
            if (end.socket !== null) {
                return end.socket;
            }
            return ((end.host === null) ? String(end.port) : `${end.host}:${end.port}`);
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
            const fresh = Object.assign({}, this.fresh, {label: ((this.fresh.label === '') ? this.label_auto : this.fresh.label)});
            const from = forward_end_parse(fresh.from_remote, fresh.from);
            const to = ((fresh.to_remote === HERE) ? forward_here_parse(fresh.to) : forward_end_parse(fresh.to_remote, fresh.to));
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
                const kept = (((at === -1) || (editing === null)) ? false : (forwards[at].off === true));
                const forward = Object.assign({label: fresh.label, from, to}, (kept ? {off: true} : {}));
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
            this.making = true;
            this.form_show();
        },
        edit: function (item) {
            this.making = true;
            this.editing = item;
            this.fresh = {label: item.label, from_remote: item.from.remote, from: this.end_text(item.from), to_remote: (item.to.here ? HERE : item.to.remote), to: this.end_text(item.to)};
            this.report('', false);
            this.form_show();
        },
        // An edit clicked far down the list brings the form into view, ready to type in
        form_show: function () {
            this.$nextTick(function () {
                this.$refs.make.scrollIntoView({block: 'nearest'});
                this.$refs.first.focus({preventScroll: true});
            });
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
        drop: async function (item) {
            if ((this.editing !== null) && (this.editing.label === item.label)) {
                this.clear();
            }
            await this.forwards_write(function (forwards) {
                const at = forwards.findIndex(v => label_of(v) === item.label);
                if (at !== -1) {
                    forwards.splice(at, 1);
                }
            });
        },
        forwards_write: async function (change) {
            this.busy = true;
            this.report('', false);
            const error = await forwards_write(change);
            this.busy = false;
            if (error !== null) {
                this.report(error, true);
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
        return {text: (listens ? 'a socket file or a port there' : 'a port, an address or a socket there'), bad: false};
    }
    const end = forward_end_parse(remote, text);
    if (typeof end === 'string') {
        return {text: end, bad: true};
    }
    const machine = ((remote === '') ? 'that machine' : title);
    if (end.socket !== undefined) {
        return {text: (listens ? `a socket file on ${machine}, only its agent's user may open it` : `the socket file ${end.socket} on ${machine}`), bad: false};
    }
    if (end.host !== undefined) {
        return (listens ? {text: 'a port or a socket here: it listens on its loopback, not on an address', bad: true} : {text: `${end.host}:${end.port}, as ${machine} reaches it`, bad: false});
    }
    return {text: `port ${end.port} on the loopback of ${machine}`, bad: false};
}

// Where it shows up on serviceman itself, as typed, in words: where the socket lands on the
// host, or the port, or what is wrong with it
function here_says(text, folder)
{
    if (text === '') {
        return {text: `a socket file in serviceman's state dir, ${folder}/, or a port on its loopback`, bad: false};
    }
    const end = forward_here_parse(text);
    if (typeof end === 'string') {
        return {text: end, bad: true};
    }
    if (end.socket !== undefined) {
        return {text: `the socket file ${folder}/${end.socket}, 0600, for the owner of ${folder}/`, bad: false};
    }
    return {text: `port ${end.port} on serviceman's own loopback — under docker, inside its container`, bad: false};
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
    return ((forward.label === undefined) ? forward.name : forward.label);
}

export default forwards_section;
