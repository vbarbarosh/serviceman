import data_table from './data_table.js';
import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import page_head from './page_head.js';
import state_pill from './state_pill.js';

// A door, for a name's tile and the card that has none yet
const DOOR_ICON = '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/>';

// Every machine's door, and what comes in through it.
//
// A machine's agent carries requests in as well as out: whatever connects to `http.sock` beside
// the agent is answered by serviceman, wherever serviceman runs. That door stands on a public
// address — a web server on that machine in front of it — so what may be reached through it is
// said here, on the host, and never over there.
//
// A rule is a name and the service that answers it. The name is not the service's own address:
// a service keeps whatever it publishes, and a door adds a name rather than renaming anything.
const networking_pane = {
    template: `
<article id="detail" class="list doors">
    <page-head category="doors" :count="rules.length" how_label="How doors work">
        <template #acts>
            <button type="button" class="primary" @click="add_focus"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add a door name</button>
        </template>
        <template #how>
            <p>Whatever connects to <code>http.sock</code> beside a machine's agent is answered by that agent: it asks the wall in front of the name, and only on a yes carries the request to the service — on its own machine, or through the agent of the machine the service runs on, over the tailnet. serviceman writes each machine the table it routes by and is in none of it: with serviceman down, the doors go on answering. Only what a table cannot route — a service serviceman answers itself — still goes through serviceman.</p>
        </template>
    </page-head>
    <!-- The names the doors answer, as drawn: a table card, what needs you first, the row that
         adds one at its foot -->
    <div class="doors-names">
    <data-table :columns="rule_columns" :rows="rules_shown" :row_key="rule_key" :row_class="rule_class" framed :total="rules.length" :foot="foot" actions_label="On" :empty_icon="DOOR_ICON" empty_title="No door names yet" empty="A door name is a public name a machine answers, and the service that takes it. Add the first at the foot.">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a name" aria-label="Find a door name by its name, machine or service" spellcheck="false">
            <span class="dt-chips">
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #cell="{row, column, more}">
            <template v-if="(column.key === 'host')"><span class="dt-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DOOR_ICON"/></span><code class="name">{{ row.host }}</code></template>
            <template v-else-if="(column.key === 'machine')">{{ row.title }}</template>
            <template v-else-if="(column.key === 'service')"><span v-if="(row.service === '*')">the app whose address it is</span><template v-else>{{ row.service }}</template></template>
            <template v-else-if="(column.key === 'behind')"><state-pill v-if="(row.auth !== null)" tone="acc" :text="row.auth"/><span v-else class="muted">{{ more ? 'nothing — anyone may reach it' : 'nothing' }}</span></template>
            <state-pill v-else-if="(column.key === 'state')" :tone="row.state.tone" :text="row.state.text" :title="row.state.hint"/>
        </template>
        <template #actions="{row}">
            <label title="Answering, or set aside for now"><input type="checkbox" :checked="(row.off === false)" :disabled="busy" @change="turn(row, $event.target.checked)">answering</label>
            <button type="button" :disabled="busy" @click="edit(row)">edit</button>
            <button type="button" class="danger" :disabled="busy" @click="drop(row)">forget it</button>
        </template>
    </data-table>
    <div class="card rule-add">
        <select ref="fresh_machine" v-model="fresh.machine" aria-label="The machine whose door answers the name">
            <option value="">which machine</option>
            <option v-for="item of machine_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model.trim="fresh.host" placeholder="echo.example.com" aria-label="The name" spellcheck="false" @keyup.enter="write">
        <select v-model="fresh.service" aria-label="The service that answers it">
            <option value="">answered by…</option>
            <option v-for="item of service_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="fresh.auth" aria-label="A service asked before this name is answered" title="A service asked before this name is answered — an authwall">
            <option value="">nothing in front</option>
            <option v-for="item of auth_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button type="button" class="primary" :disabled="(busy || fresh.machine === '' || fresh.host === '' || fresh.service === '')" @click="write"><svg v-if="(editing === null)" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>{{ (editing === null ? 'Add' : 'Save') }}</button>
        <button v-if="(editing !== null)" type="button" :disabled="busy" @click="clear">Cancel</button>
        <span v-if="(note !== '')" class="rule-add-note" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
    </div>
    <!-- How doors work, folded: what a name and a wall are, the socket and its mode, and each
         machine's door -->
    <details class="card doors-how">
        <summary><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg><b>How doors work</b><span class="muted">a machine's web server, the socket, its mode</span></summary>
        <div class="doors-how-body">
            <p class="muted">A name, and the service that takes it. The service keeps its own address as well — this is a name it also answers to, on that machine's front. <code>*.example.com</code> stands for every name under it, and answered by <code>*</code> each of those names is answered by the app whose own address it is: one rule for every app under a domain. A machine with no rule serves nothing, and the control page is not reachable through a door at all.</p>
            <p class="muted"><b>In front</b> is a service asked before anything else is touched — an authwall. The door asks it <code>/auth/sidecar</code>, carries its <code>X-Auth-User</code> to the service on a yes, and on a no sends the visitor to <code>/auth/sign-in</code> on the name they asked for; a wall that cannot be asked lets nothing through. One wall stands in front of as many names as point at it, and serviceman writes nothing into it: whose email may pass is the wall's own business.</p>
            <p class="muted">A machine has no door until one is asked for. The mode is the asking, and it is also the whole of who may knock: <code>0660</code> and a group lets that machine's web server in, <code>0600</code> nobody but the user the agent runs as. Add the line to the agent's <code>env</code> and start it again:</p>
            <pre class="tail">SERVICEMAN_HTTP_SOCKET_MODE=0660

bin/restart</pre>
            <data-table :columns="door_columns" :rows="machines" row_key="name" empty="No machines yet. A door is a machine's own — add a remote first.">
                <template #cell="{row, column, more}">
                    <span v-if="(column.key === 'name')" class="dt-state"><span class="dot" :class="((row.phase === 'online') ? 'running' : '')"/><span class="name">{{ row.title || row.name }}</span></span>
                    <span v-else-if="(column.key === 'door')" :class="{muted: (door_open(row) === false)}">{{ door_text(row) }}</span>
                    <span v-else-if="(column.key === 'routes')" :class="routes_of(row).tone" :title="routes_of(row).hint">{{ routes_of(row).text }}</span>
                    <span v-else-if="(column.key === 'streams')" class="muted">{{ ((more && (row.streams === 0)) ? 'nothing' : streams_text(row)) }}</span>
                    <code v-else-if="(column.key === 'path')" class="muted">{{ door_path(row) }}</code>
                </template>
            </data-table>
            <p class="muted">Then point that machine's web server at the file, keeping the <code>Host</code> header as it came — the door answers by that name and nothing else.</p>
        </div>
    </details>
</article>
`,
    components: {'data-table': data_table, 'page-head': page_head, 'state-pill': state_pill},
    props: ['state'],
    emits: [],
    data: function () {
        // `editing` is the rule the line below is rewriting — the same three boxes, so a rule is
        // changed where it was written rather than in a form of its own
        // filter, show: the find box and the chip picked, all, ok or need
        return {DOOR_ICON, fresh: {machine: '', host: '', service: '', auth: ''}, editing: null, note: '', bad: false, busy: false, filter: '', show: 'all'};
    },
    computed: {
        // The tables' columns, each that may fold with when
        rule_columns: function () {
            return [
                {key: 'host', label: 'Name', wraps: true},
                {key: 'machine', label: 'Remote', fold: 3},
                {key: 'service', label: 'Answered by', fold: 4},
                {key: 'behind', label: 'In front', fold: 2},
                {key: 'state', label: 'Status', phone: 'state'},
            ];
        },
        door_columns: function () {
            return [
                {key: 'name', label: 'Remote', wraps: true},
                {key: 'door', label: 'Door', fold: 3},
                {key: 'routes', label: 'Routes'},
                {key: 'streams', label: 'Riding now', fold: 2},
                {key: 'path', label: 'Where it is', fold: 1, hide: v => (this.door_path(v) === '')},
            ];
        },
        machines: function () {
            return (this.state === null) ? [] : this.state.remotes;
        },
        services: function () {
            return (this.state === null) ? [] : this.state.services;
        },
        machine_options: function () {
            return this.machines.map(v => ({value: v.name, label: v.title || v.name}));
        },
        // "*" is one rule for every app under a domain: the service whose own address the
        // name is answers it
        service_options: function () {
            return [{value: '*', label: 'the app whose address it is: *'}].concat(this.services.map(v => ({value: v.name, label: v.title || v.name})));
        },
        auth_options: function () {
            return this.services.map(v => ({value: v.name, label: `behind ${v.title || v.name}`}));
        },
        // Every rule in the fleet as one list, because that is the question this page answers:
        // which name, on which machine's front, is taken by what
        rules: function () {
            const written = [];
            for (const item of this.machines) {
                const inbound = (item.inbound === undefined) ? {} : item.inbound;
                for (const host of Object.keys(inbound)) {
                    // The wall its service stands behind at every address is the one asked
                    const own = this.state.services.find(v => v.name === inbound[host].service);
                    const auth = ((own !== undefined) && (own.auth !== null)) ? own.auth : ((inbound[host].auth === undefined) ? null : inbound[host].auth);
                    const rule = {machine: item.name, title: item.title || item.name, host, service: inbound[host].service, off: (inbound[host].off === true), auth, said: (inbound[host].auth === undefined) ? null : inbound[host].auth};
                    written.push(Object.assign(rule, {state: this.state_of(rule, item)}));
                }
            }
            // What needs you first, then the rest as they were written
            const rank = {bad: 0, busy: 1, idle: 2, run: 3};
            return written.map((v, i) => ({v, i})).sort((a, b) => ((rank[a.v.state.tone] - rank[b.v.state.tone]) || (a.i - b.i))).map(v => v.v);
        },
        // The rows the find box and the chip leave
        rules_shown: function () {
            const word = this.filter.toLowerCase();
            return this.rules.filter(v => ((this.show === 'all') || (this.need(v) === (this.show === 'need'))) && ((word === '') || `${v.host} ${v.title} ${v.service}`.toLowerCase().includes(word)));
        },
        chips: function () {
            const need = this.rules.filter(v => this.need(v)).length;
            return [{value: 'all', label: 'All', phase: null, count: this.rules.length}, {value: 'ok', label: 'Answer', phase: 'running', count: this.rules.length - need}, {value: 'need', label: 'Need you', phase: 'failed', count: need}];
        },
        foot: function () {
            const need = this.rules.filter(v => this.need(v)).length;
            const out = [{text: `${this.rules.length} ${(this.rules.length === 1) ? 'name' : 'names'}`, tone: ''}];
            if (need > 0) {
                out.push({text: `${need} need you`, tone: 'bad'});
            }
            return out;
        },
    },
    methods: {
        // Add a door name, in the head: the row that adds one, at the foot of the table
        add_focus: function () {
            this.$refs.fresh_machine.scrollIntoView({block: 'center'});
            this.$refs.fresh_machine.focus();
        },
        known: function (name) {
            return (name === '*') || this.services.some(v => v.name === name);
        },
        rule_key: function (rule) {
            return `${rule.machine} ${rule.host}`;
        },
        // A name that does not answer, or not yet, needs you
        need: function (rule) {
            return (rule.state.tone === 'bad') || (rule.state.tone === 'busy');
        },
        rule_class: function (rule) {
            if (rule.off) {
                return 'off';
            }
            return {bad: 'dt-bad', busy: 'dt-warn'}[rule.state.tone] || '';
        },
        // How a name stands, from what serviceman knows: set aside, answered by no service, its
        // machine away, no door asked for there, its table not sent, or answering
        state_of: function (rule, machine) {
            if (rule.off) {
                return {tone: 'idle', text: 'set aside', hint: 'Not answered for now: its row\'s answering box takes it back'};
            }
            if (this.known(rule.service) === false) {
                return {tone: 'bad', text: 'no such service', hint: `No service is named ${rule.service}`};
            }
            if (machine.phase !== 'online') {
                return {tone: 'bad', text: 'machine offline', hint: 'Its door goes on with the table it holds; serviceman cannot tell how it answers'};
            }
            if (door_of(machine) === null) {
                return {tone: 'busy', text: 'no door yet', hint: 'Its agent has no door: How doors work says how to ask for one'};
            }
            const routes = this.routes_of(machine);
            if (routes.tone === 'bad') {
                return {tone: 'bad', text: 'its table not sent', hint: routes.hint};
            }
            return {tone: 'run', text: 'answers', hint: routes.text};
        },
        streams_text: function (item) {
            if (item.streams === 0) {
                return '';
            }
            return (item.streams === 1) ? '1 stream' : `${item.streams} streams`;
        },
        door_open: function (item) {
            const door = door_of(item);
            return (door !== null) && (door.mode !== '0600');
        },
        door_text: function (item) {
            const door = door_of(item);
            if (item.phase !== 'online') {
                return 'the link is down';
            }
            if (door === null) {
                return 'none — nothing was asked for';
            }
            return (door.mode === '0600') ? `${door.mode} · its own user only` : `${door.mode} · open`;
        },
        // Whether its door routes by a table of its own, and whether it holds the latest one
        routes_of: function (item) {
            const doors = (item.doors === undefined) ? null : item.doors;
            if (doors === null) {
                return {text: 'through serviceman', tone: 'muted', hint: 'An agent from before doors routed by themselves: every request goes through serviceman, and stops when it does'};
            }
            if (doors.error !== null) {
                return {text: 'its table could not be sent', tone: 'bad', hint: doors.error};
            }
            if ((doors.wanted !== null) && (doors.told === doors.wanted)) {
                const peer = (doors.peer === null) ? 'no peer port' : `peers reach it at ${doors.peer.addresses.join(', ')}:${doors.peer.port}`;
                return {text: 'by itself · latest table', tone: '', hint: `table ${doors.told} · ${peer}`};
            }
            if (item.phase !== 'online') {
                return {text: `by itself · ${(doors.told === null) ? 'no table yet' : 'last table it had'}`, tone: 'muted', hint: 'Not connected: it goes on routing by the table it holds, and is sent the latest when it dials in'};
            }
            return {text: 'by itself · waiting for its table', tone: 'muted', hint: 'The latest table is on its way'};
        },
        door_path: function (item) {
            const door = door_of(item);
            return (door === null) ? '' : door.path;
        },
        // One rule written, whether it is new or the one being edited. A rule that moved to
        // another machine is taken off the old one in the same breath.
        write: async function () {
            const fresh = this.fresh;
            const editing = this.editing;
            const host = fresh.host.toLowerCase();
            const kept = (editing === null) ? false : editing.off;
            const written = await this.rules_write(fresh.machine, function (inbound) {
                if ((editing !== null) && (editing.machine === fresh.machine)) {
                    delete inbound[editing.host];
                }
                inbound[host] = door_rule_value(fresh.service, kept, fresh.auth);
            });
            if (written === false) {
                return;
            }
            if ((editing !== null) && (editing.machine !== fresh.machine)) {
                await this.rules_write(editing.machine, function (inbound) {
                    delete inbound[editing.host];
                });
            }
            this.clear();
        },
        edit: function (rule) {
            this.editing = rule;
            this.fresh = {machine: rule.machine, host: rule.host, service: rule.service, auth: (rule.said === null) ? '' : rule.said};
            this.report('', false);
        },
        clear: function () {
            this.editing = null;
            this.fresh = {machine: '', host: '', service: '', auth: ''};
        },
        // Set aside for now, and put back later. The name stays where it is — retyping one is
        // how a name comes back subtly different.
        turn: async function (rule, on) {
            await this.rules_write(rule.machine, function (inbound) {
                inbound[rule.host] = door_rule_value(rule.service, on === false, rule.said);
            });
        },
        drop: async function (rule) {
            if ((this.editing !== null) && (this.editing.machine === rule.machine) && (this.editing.host === rule.host)) {
                this.clear();
            }
            await this.rules_write(rule.machine, function (inbound) {
                delete inbound[rule.host];
            });
        },
        rules_write: async function (name, change) {
            this.busy = true;
            this.report('', false);
            const problem = await door_rules_write(name, change);
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

function door_of(item)
{
    return ((item.machine === null) || (item.machine.door === undefined)) ? null : item.machine.door;
}

export default networking_pane;
