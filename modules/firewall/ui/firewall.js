import firewall_ports from './firewall_ports.js';

// The firewall of one machine, ufw, with the ports it listens on: first the ports, each with
// how far its address reaches and what the firewall does to it, Allow or Close from its row;
// then the rules as ufw keeps them, a row to add one and × to delete one, with Undo. A change
// shows at once, marked while the machine makes it. The host page gives the API, the colours
// and its usual classes: card, list-head, list-acts, list-table, dot, pill, muted, bad,
// primary, link.
const ACTIONS = [
    {value: 'allow', label: 'Allow'},
    {value: 'deny', label: 'Deny'},
    {value: 'reject', label: 'Reject'},
    {value: 'limit', label: 'Limit'},
];
const DIRECTIONS = [
    {value: 'in', label: 'In'},
    {value: 'out', label: 'Out'},
];
const PROTOS = [
    {value: 'tcp', label: 'tcp'},
    {value: 'udp', label: 'udp'},
    {value: 'any', label: 'tcp and udp'},
];

// Which ports the list shows: all of them, those others can reach, or those only this machine can
const SHOWS = [
    {value: 'all', label: 'All'},
    {value: 'beyond', label: 'Reachable from outside'},
    {value: 'local', label: 'This machine only'},
];

const firewall = {
    template: `
<article class="fw">
    <div v-if="(state === null)" class="fw-first">
        <span :class="(bad ? 'bad' : 'muted')">{{ (note === '' ? 'Asking the machine for its firewall…' : note) }}</span>
        <button v-if="bad" type="button" :disabled="(busy || offline)" @click="read">Read again</button>
    </div>
    <div v-else-if="(state.installed === false)" class="card fw-card">
        <b>ufw is not on this machine.</b>
        <p class="muted">Install it in its Shell, then read again: <code>sudo apt-get install ufw</code></p>
        <div><button type="button" :disabled="offline" @click="read">Read again</button></div>
    </div>
    <template v-else>
        <div class="list-head">
            <span class="dot" :class="{running: state.active}"/>
            <b>{{ (state.active ? 'On' : 'Off') }}</b>
            <span class="muted fw-cut" :title="defaults_text">{{ defaults_text }}</span>
            <span v-if="(note !== '')" class="fw-cut" :class="(bad ? 'bad' : 'muted')" :title="note">{{ note }}</span>
            <div class="list-acts">
                <button type="button" :class="{primary: (state.active === false)}" :disabled="(busy || offline)" @click="switch_to(state.active ? 'disable' : 'enable')">{{ (state.active ? 'Turn off' : 'Turn on') }}</button>
                <button type="button" :disabled="(busy || offline)" @click="read">Read again</button>
            </div>
        </div>
        <!-- Turning it on with nothing to let ssh in closes ssh; the host says what still reaches it -->
        <div v-if="(state.ssh_open === false && state.active === false)" class="card fw-warn">
            <span><b>No rule lets ssh (22) in.</b> Turned on like this, the firewall closes ssh to this machine.<template v-if="(stays !== '')">{{ (' ' + stays) }}</template></span>
            <button type="button" :disabled="(busy || offline)" @click="ssh_allow">Allow 22/tcp</button>
        </div>
        <div v-if="(undo !== null)" class="card fw-undo">
            <span class="fw-cut">Deleted <code :title="undo.command">{{ undo.command }}</code></span>
            <button type="button" :disabled="(busy || offline)" @click="undo_run">Undo</button>
            <button type="button" class="link" aria-label="Close" @click="undo = null">×</button>
        </div>
        <h3 class="fw-title">Listening ports <span :class="(ports_bad ? 'bad' : 'muted')">{{ ports_note }}</span></h3>
        <template v-if="(ports !== null)">
            <div class="fw-tiles">
                <div class="card fw-tile" :class="{hot: (counts.open > 0)}">
                    <span class="muted">Open to the internet</span>
                    <b>{{ counts.open }}</b>
                    <small class="muted">a public address, and nothing keeps it out</small>
                </div>
                <div class="card fw-tile" :class="{warm: (counts.network > 0)}">
                    <span class="muted">Open on a network</span>
                    <b>{{ counts.network }}</b>
                    <small class="muted">a private network or the tailnet</small>
                </div>
                <div class="card fw-tile">
                    <span class="muted">Kept out by the firewall</span>
                    <b>{{ counts.closed }}</b>
                    <small class="muted">it listens, and nobody outside gets to it</small>
                </div>
                <div class="card fw-tile">
                    <span class="muted">This machine only</span>
                    <b>{{ counts.local }}</b>
                    <small class="muted">loopback: nothing outside can knock</small>
                </div>
            </div>
            <p v-if="(addresses !== null && addresses.length > 0)" class="muted fw-at">This machine is at <code v-for="address of addresses" :key="address">{{ address }}</code></p>
            <div class="fw-filter">
                <input v-model="query" type="search" placeholder="Filter by port or program" spellcheck="false" aria-label="Filter ports">
                <button v-for="option of SHOWS" :key="option.value" type="button" class="chip" :class="{on: (show === option.value)}" @click="show = option.value">{{ option.label }}</button>
            </div>
            <div class="card fw-rules">
                <table class="list-table fw-table fw-ports">
                    <thead>
                        <tr><th>Port</th><th>Reachable from · address</th><th>Firewall</th><th>Held by</th><th/></tr>
                    </thead>
                    <tbody>
                        <tr v-for="row of shown" :key="row.key" :class="('fw-' + row.reach.exposure + (row.verdict.kind === 'closed' && row.verdict.now ? ' fw-shut' : ''))">
                            <td class="fw-nowrap fw-port-cell">{{ (row.port === 0 ? '*' : row.port) }}<span class="muted">/{{ row.proto }}</span></td>
                            <td class="fw-cut-cell"><span class="fw-cut"><span class="pill" :class="row.reach.tone">{{ row.reach.text }}</span> <code class="muted" :title="row.addresses.join(' · ')">{{ row.addresses.join(' ') }}</code></span></td>
                            <td class="fw-cut-cell"><span class="fw-cut" :class="verdict_class(row)" :title="(row.verdict.rule === null ? row.verdict.text : ('ufw ' + row.verdict.rule.command))">{{ row.verdict.text }}</span></td>
                            <td class="fw-cut-cell muted"><span class="fw-cut" :title="row.held">{{ row.held }}</span></td>
                            <td class="fw-acts">
                                <span v-if="(pending[row.key] !== undefined)" class="muted">{{ pending[row.key] }}</span>
                                <button v-else-if="(row.verdict.kind === 'closed')" type="button" :disabled="(busy || offline)" :title="('ufw allow ' + row.port + '/' + row.proto)" @click="port_allow(row)">Allow</button>
                                <button v-else-if="(row.verdict.kind === 'open' && closable(row))" type="button" :disabled="(busy || offline)" :title="('Delete ufw ' + row.verdict.rule.command)" @click="port_close(row)">Close</button>
                                <span v-else-if="(row.verdict.kind === 'open')" class="muted" title="Let in by the default policy or by a wider rule: change the rules below">by a rule below</span>
                            </td>
                        </tr>
                        <tr v-if="(shown.length === 0)">
                            <td colspan="5" class="muted">{{ (port_rows.length === 0 ? 'This machine listens on no port.' : 'No port matches.') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <details v-if="(ports.commands !== undefined && ports.commands.length > 0)" class="fw-how">
                <summary class="muted">How the ports were read</summary>
                <code v-for="command of ports.commands" :key="command">{{ command }}</code>
            </details>
        </template>
        <h3 class="fw-title">Rules <span class="muted">{{ rules.length }}</span></h3>
        <div class="card fw-rules">
            <table class="list-table fw-table">
                <thead>
                    <tr><th>Action</th><th>Port</th><th>From</th><th>To</th><th>Comment</th><th/></tr>
                </thead>
                <tbody>
                    <tr v-for="rule of rules" :key="rule.command" :class="{'fw-pending': rule.pending}" :title="('ufw ' + rule.command)">
                        <td class="fw-nowrap"><span class="fw-action" :class="('fw-' + rule.action)">{{ rule.action }}</span> <span v-if="(rule.direction === 'out')" class="muted">out</span></td>
                        <td class="fw-nowrap">{{ port_text(rule) }}</td>
                        <td class="fw-cut-cell"><span class="fw-cut" :title="rule.from">{{ (rule.from === 'any' ? 'anywhere' : rule.from) }}</span></td>
                        <td class="fw-cut-cell muted"><span class="fw-cut">{{ to_text(rule) }}</span></td>
                        <td class="fw-cut-cell muted"><span class="fw-cut" :title="rule.comment">{{ rule.comment }}</span></td>
                        <td class="fw-acts">
                            <span v-if="rule.pending" class="muted">{{ rule.pending }}</span>
                            <button v-else type="button" class="link" :aria-label="('Delete ' + rule.command)" title="Delete this rule" :disabled="(busy || offline)" @click="remove(rule)">×</button>
                        </td>
                    </tr>
                    <tr v-if="(rules.length === 0)">
                        <td colspan="6" class="muted">No rules. {{ (state.active ? 'Only what the defaults allow gets through.' : 'Add one below, then turn the firewall on.') }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <form class="card fw-add" @submit.prevent="add">
            <select v-model="form.action" aria-label="Action"><option v-for="item of ACTIONS" :key="item.value" :value="item.value">{{ item.label }}</option></select>
            <select v-model="form.direction" aria-label="Direction"><option v-for="item of DIRECTIONS" :key="item.value" :value="item.value">{{ item.label }}</option></select>
            <input v-model="form.port" class="fw-port" placeholder="Port: 22, 8000:8100" aria-label="Port" required>
            <select v-model="form.proto" aria-label="Protocol"><option v-for="item of PROTOS" :key="item.value" :value="item.value">{{ item.label }}</option></select>
            <input v-model="form.from" class="fw-from" placeholder="From: anywhere, or 10.0.0.0/8" aria-label="From">
            <input v-model="form.comment" class="fw-comment" placeholder="Comment" aria-label="Comment" maxlength="200">
            <button type="submit" class="primary" :disabled="(busy || offline || form.port.trim() === '')">Add</button>
        </form>
    </template>
</article>
`,
    props: {
        base: {type: String, required: true},
        offline: {type: Boolean, default: false},
        // The machine's own addresses, for how far a port on every address reaches; null
        // when they are not known
        addresses: {type: Array, default: null},
        // What still reaches the machine once the firewall closes ssh, said after the warning
        stays: {type: String, default: ''},
    },
    data: function () {
        return {
            ACTIONS,
            DIRECTIONS,
            PROTOS,
            SHOWS,
            state: null,
            ports: null,
            ports_note: '',
            ports_bad: false,
            query: '',
            show: 'all',
            // A port's row while its rule is being written: key → what is being done
            pending: {},
            // Rules shown before the machine has them, and rules gone before it has let them go
            adding: [],
            deleting: [],
            undo: null,
            busy: false,
            note: '',
            bad: false,
            form: {action: 'allow', direction: 'in', port: '', proto: 'tcp', from: '', comment: ''},
        };
    },
    computed: {
        port_rows: function () {
            return ((this.ports === null) ? [] : firewall_ports(this.ports.items, this.addresses, this.state));
        },
        // What actually gets through: a port the firewall keeps out counts as kept out, however
        // open its address
        counts: function () {
            const out = {open: 0, network: 0, closed: 0, local: 0};
            for (const row of this.port_rows) {
                if (row.reach.exposure === 'local') {
                    out.local++;
                }
                else if ((row.verdict.kind === 'closed') && row.verdict.now) {
                    out.closed++;
                }
                else {
                    out[row.reach.exposure]++;
                }
            }
            return out;
        },
        shown: function () {
            const query = this.query.trim().toLowerCase();
            return this.port_rows.filter(function (row) {
                if ((this.show === 'beyond') && (row.reach.exposure === 'local')) {
                    return false;
                }
                if ((this.show === 'local') && (row.reach.exposure !== 'local')) {
                    return false;
                }
                return ((query === '') || (String(row.port) === query) || row.held.toLowerCase().includes(query));
            }, this);
        },
        rules: function () {
            const listed = ((this.state === null) ? [] : this.state.rules.filter(v => this.deleting.includes(v.command) === false));
            return listed.concat(this.adding);
        },
        defaults_text: function () {
            if ((this.state === null) || (this.state.defaults === null)) {
                return (((this.state !== null) && (this.state.active === false)) ? 'Rules are kept, and apply once it is on' : '');
            }
            const d = this.state.defaults;
            return `In: ${d.incoming || '?'} by default · out: ${d.outgoing || '?'}`;
        },
    },
    watch: {
        offline: function (value) {
            if (value === false) {
                this.read();
            }
        },
    },
    methods: {
        read: async function () {
            await Promise.all([this.ask('GET', '', null, ''), this.ports_read()]);
        },
        ports_read: async function () {
            this.ports_note = 'reading…';
            this.ports_bad = false;
            try {
                const answer = await fetch(`${this.base}/ports`, {cache: 'no-store'});
                const ports = await answer.json();
                if (answer.ok === false) {
                    this.ports_note = ports.error;
                    this.ports_bad = true;
                    return;
                }
                this.ports = ports;
                this.ports_note = `${ports.items.length} ${((ports.items.length === 1) ? 'socket' : 'sockets')} · read ${new Date().toLocaleTimeString()}`;
            }
            catch (error) {
                this.ports_note = error.message;
                this.ports_bad = true;
            }
        },
        // A rule for this port alone, from anywhere
        port_allow: async function (row) {
            this.pending[row.key] = 'allowing…';
            await this.ask('POST', '/rules', {action: 'allow', direction: 'in', port: String(row.port), proto: row.proto}, `Allowed ${row.port}/${row.proto}`);
            delete this.pending[row.key];
        },
        // The rule that lets it in goes, with Undo
        port_close: async function (row) {
            this.pending[row.key] = 'closing…';
            await this.remove(row.verdict.rule);
            delete this.pending[row.key];
        },
        // Close only takes away a rule that is about this one port: a range or a list of ports,
        // a service by name or the default stays to be changed in the rules below
        closable: function (row) {
            const rule = row.verdict.rule;
            return ((rule !== null) && (rule.from === 'any') && (rule.app === null) && (rule.port === String(row.port)));
        },
        verdict_class: function (row) {
            if ((row.verdict.kind === 'open') && (row.reach.exposure === 'open')) {
                return 'bad';
            }
            return (((row.verdict.kind === 'closed') && row.verdict.now) ? 'fw-ok' : 'muted');
        },
        add: async function () {
            const form = Object.assign({}, this.form);
            // A key of its own: the list holds a reactive copy, never this object itself
            const shown = {command: `adding ${form.port} #${Date.now()}`, action: form.action, direction: form.direction, port: form.port, proto: ((form.proto === 'any') ? null : form.proto), from: ((form.from.trim() === '') ? 'any' : form.from.trim()), to: 'any', on: null, app: null, comment: form.comment, pending: 'adding…'};
            this.adding.push(shown);
            const done = await this.ask('POST', '/rules', form, 'Added');
            this.adding = this.adding.filter(v => v.command !== shown.command);
            if (done) {
                this.form.port = '';
                this.form.from = '';
                this.form.comment = '';
            }
        },
        ssh_allow: async function () {
            await this.ask('POST', '/rules', {action: 'allow', direction: 'in', port: '22', proto: 'tcp'}, 'Added 22/tcp');
        },
        // The row goes at once; Undo puts the same rule back
        remove: async function (rule) {
            this.deleting.push(rule.command);
            const answer = await this.ask('POST', '/rules/delete', {command: rule.command}, '');
            this.deleting = this.deleting.filter(v => v !== rule.command);
            if ((answer !== null) && (answer.undo !== undefined)) {
                this.undo = answer.undo;
            }
        },
        // Back at its old place in the list: the first rule that matches is the one ufw goes by
        undo_run: async function () {
            const undo = this.undo;
            this.undo = null;
            await this.ask('POST', '/rules', undo, 'Put back');
        },
        switch_to: async function (action) {
            await this.ask('POST', `/${action}`, null, ((action === 'enable') ? 'Turned on' : 'Turned off'));
        },
        // One call to the module: its answer is the firewall as it is now
        ask: async function (method, tail, body, said) {
            this.busy = true;
            this.note = ((method === 'GET') ? '' : 'Writing on the machine…');
            this.bad = false;
            try {
                const answer = await fetch(`${this.base}${tail}`, {method, cache: 'no-store', body: ((body === null) ? undefined : JSON.stringify(body))});
                const out = await answer.json();
                if (answer.ok === false) {
                    this.note = out.error;
                    this.bad = true;
                    return null;
                }
                this.state = out;
                this.note = said;
                return out;
            }
            catch (error) {
                this.note = error.message;
                this.bad = true;
                return null;
            }
            finally {
                this.busy = false;
            }
        },
        port_text: function (rule) {
            if (rule.app !== null) {
                return rule.app;
            }
            if (rule.port === null) {
                return 'every port';
            }
            return ((rule.proto === null) ? rule.port : `${rule.port}/${rule.proto}`);
        },
        to_text: function (rule) {
            const to = ((rule.to === 'any') ? 'this machine' : rule.to);
            return ((rule.on === null) ? to : `${to} on ${rule.on}`);
        },
    },
    mounted: function () {
        if (this.offline === false) {
            this.read();
        }
    },
};

export default firewall;
