import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';

// The service a new address is protected with unless another is picked: one called this
const WALL_NAME = 'authwall';

// A service's public addresses: the names machines' doors answer for it, each through one
// machine, each maybe behind a wall, each on or set aside — where the service is, rather than
// on a page of every machine's doors
const service_doors = {
    template: `
<div class="card svc-status svc-doors">
    <div class="row-of svc-state">
        <b>Public addresses</b>
        <span class="muted">names a machine's door answers for this service, on that machine's public side</span>
    </div>
    <ul v-if="(rules.length > 0)" class="fold-list">
        <li v-for="rule of rules" :key="rule_key(rule)" :class="{off: rule.off, open: rule_open(rule)}">
            <button type="button" class="fold-line" :aria-expanded="rule_open(rule)" @click="rule_toggle(rule)">
                <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                <span class="dot" :class="rule_dot(rule)"/>
                <b class="name" :title="rule.host">{{ rule.host }}</b>
                <span class="route muted" :title="('through the door of ' + rule.title)">{{ rule.title }}</span>
                <span class="word" :class="{bad: rule_bad(rule), muted: (rule.auth === null && rule.off === false && rule_bad(rule) === false)}" :title="(rule.door_problem === null ? '' : rule.door_problem)">{{ rule_word(rule) }}</span>
            </button>
            <div v-if="rule_open(rule)" class="fold-details">
                <dl>
                    <dt>Address</dt>
                    <dd>
                        <a v-if="(rule.host.startsWith('*') === false)" :href="('https://' + rule.host)" target="_blank" rel="noopener"><code>{{ rule.host }}</code></a>
                        <code v-else>{{ rule.host }}</code>
                    </dd>
                    <dt>Through</dt>
                    <dd>the door of {{ rule.title }}<div v-if="(rule.door_problem !== null)" class="bad">{{ rule.door_problem }}</div></dd>
                    <dt>Protected by</dt>
                    <dd :class="{muted: (rule.auth === null)}">{{ (rule.auth === null ? 'nothing — anyone may reach it' : rule.auth) }}<span v-if="(rule.auth !== null && known(rule.auth) === false)" class="bad"> — no such service</span></dd>
                </dl>
                <div class="fold-actions">
                    <label><input type="checkbox" :checked="(rule.off === false)" :disabled="busy" @change="turn(rule, $event.target.checked)"> Answering</label>
                    <button type="button" class="link" :disabled="busy" @click="drop(rule)">remove</button>
                </div>
            </div>
        </li>
    </ul>
    <p v-else class="muted">None. This service answers its own address on serviceman; a public address is a name a machine's door answers for it too — <code>echo.example.com</code>, served from that machine's public side, and protected by a wall if you like.</p>
    <div v-if="adding" class="door-add">
        <input v-model.trim="fresh.host" placeholder="echo.example.com" spellcheck="false" aria-label="Address" @keyup.enter="add">
        <select v-model="fresh.machine" aria-label="Through the door of">
            <option value="">through the door of…</option>
            <option v-for="item of remote_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="fresh.auth" aria-label="Protected by">
            <option value="">protected by nothing</option>
            <option v-for="item of wall_options" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button type="button" class="primary" :disabled="(busy || fresh.host === '' || fresh.machine === '')" @click="add">Add</button>
        <button type="button" :disabled="busy" @click="adding = false">Cancel</button>
    </div>
    <div v-else>
        <button type="button" @click="add_open">+ Add a public address</button>
    </div>
    <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
</div>
`,
    props: ['view', 'remotes', 'names'],
    data: function () {
        // `opened` is the addresses whose details are shown, by machine and name
        return {adding: false, fresh: {host: '', machine: '', auth: ''}, busy: false, note: '', bad: false, opened: {}};
    },
    computed: {
        // Every door name, on every machine, that this service answers
        rules: function () {
            const out = [];
            for (const item of this.remotes) {
                const inbound = ((item.inbound === undefined) ? {} : item.inbound);
                for (const host of Object.keys(inbound)) {
                    const rule = ((typeof inbound[host] === 'string') ? {service: inbound[host]} : inbound[host]);
                    if (rule.service !== this.view.name) {
                        continue;
                    }
                    out.push({machine: item.name, title: (item.title || item.name), host, off: (rule.off === true), auth: ((rule.auth === undefined) ? null : rule.auth), door_problem: door_problem(item)});
                }
            }
            return out;
        },
        // Any other service may stand in front; the one called authwall is offered first
        walls: function () {
            const others = this.names.filter(v => v !== this.view.name);
            return others.filter(v => v === WALL_NAME).concat(others.filter(v => v !== WALL_NAME));
        },
        remote_options: function () {
            return this.remotes.map(v => ({value: v.name, label: (v.title || v.name)}));
        },
        wall_options: function () {
            return this.walls.map(v => ({value: v, label: `protected by ${v}`}));
        },
    },
    methods: {
        known: function (name) {
            return this.names.includes(name);
        },
        rule_key: function (rule) {
            return `${rule.machine} ${rule.host}`;
        },
        rule_open: function (rule) {
            return (this.opened[this.rule_key(rule)] === true);
        },
        rule_toggle: function (rule) {
            this.opened = Object.assign({}, this.opened, {[this.rule_key(rule)]: (this.rule_open(rule) === false)});
        },
        // A wall that is not there lets nothing through; a shut door lets no web server in, which
        // matters only while the name is answered
        rule_bad: function (rule) {
            return ((rule.auth !== null) && (this.known(rule.auth) === false)) || ((rule.door_problem !== null) && (rule.off === false));
        },
        // Where an address stands, in a word or two for its one line
        rule_word: function (rule) {
            if ((rule.auth !== null) && (this.known(rule.auth) === false)) {
                return 'no such wall';
            }
            if (rule.off) {
                return 'set aside';
            }
            if (rule.door_problem !== null) {
                return 'door not open';
            }
            return ((rule.auth === null) ? 'no wall' : `behind ${rule.auth}`);
        },
        rule_dot: function (rule) {
            if (this.rule_bad(rule)) {
                return 'failed';
            }
            return (rule.off ? '' : 'running');
        },
        add_open: function () {
            const machine = ((this.remotes.length === 1) ? this.remotes[0].name : '');
            this.fresh = {host: '', machine, auth: ((this.names.includes(WALL_NAME) && (this.view.name !== WALL_NAME)) ? WALL_NAME : '')};
            this.adding = true;
            this.report('', false);
        },
        add: async function () {
            const fresh = this.fresh;
            const host = fresh.host.toLowerCase();
            const service = this.view.name;
            const done = await this.write(fresh.machine, function (inbound) {
                inbound[host] = door_rule_value(service, false, fresh.auth);
            });
            if (done) {
                this.adding = false;
                this.report(`${host} answers now through the door of ${fresh.machine}`, false);
            }
        },
        // Set aside and put back. The name stays written — retyping one is how a name comes back
        // subtly different.
        turn: async function (rule, on) {
            if (rule.off === (on === false)) {
                return;
            }
            const service = this.view.name;
            await this.write(rule.machine, function (inbound) {
                inbound[rule.host] = door_rule_value(service, on === false, rule.auth);
            });
        },
        drop: async function (rule) {
            await this.write(rule.machine, function (inbound) {
                delete inbound[rule.host];
            });
        },
        write: async function (machine, change) {
            this.busy = true;
            this.report('', false);
            const error = await door_rules_write(machine, change);
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

// Why a machine's door would not let its web server in, or null where it would. Unknown — a
// machine that is not connected — is not a problem to report.
function door_problem(remote)
{
    if ((remote.phase !== 'online') || (remote.machine === null) || (remote.machine === undefined)) {
        return null;
    }
    const door = remote.machine.door;
    if ((door === null) || (door === undefined)) {
        return 'this machine has no door: SERVICEMAN_HTTP_SOCKET_MODE=0660 in its agent env, then bin/restart — the Networking page has the steps';
    }
    if (door.mode === '0600') {
        return 'the door is for the agent user alone (0600): its web server cannot reach it — the Networking page has the steps';
    }
    return null;
}

export default service_doors;
