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
    <table v-if="(rules.length > 0)" class="grid-table doors-of">
        <thead>
            <tr>
                <th>Address</th>
                <th>Through</th>
                <th>Protected by</th>
                <th>Answering</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            <tr v-for="rule of rules" :key="(rule.machine + ' ' + rule.host)" :class="{off: rule.off}">
                <td>
                    <a v-if="(rule.host.startsWith('*') === false)" :href="('https://' + rule.host)" target="_blank" rel="noopener"><code>{{ rule.host }}</code></a>
                    <code v-else>{{ rule.host }}</code>
                </td>
                <td>
                    {{ rule.title }}
                    <span v-if="(rule.door_problem !== null)" class="bad door-problem" :title="rule.door_problem">· its door is not open</span>
                </td>
                <td :class="{muted: (rule.auth === null)}">{{ (rule.auth === null ? 'nothing — anyone may reach it' : rule.auth) }}<span v-if="(rule.auth !== null && known(rule.auth) === false)" class="bad"> — no such service</span></td>
                <td>
                    <span class="seg">
                        <button type="button" :class="{on: (rule.off === false)}" :disabled="busy" @click="turn(rule, true)">On</button>
                        <button type="button" :class="{on: rule.off}" :disabled="busy" @click="turn(rule, false)">Off</button>
                    </span>
                </td>
                <td><button type="button" class="link" :disabled="busy" @click="drop(rule)">remove</button></td>
            </tr>
        </tbody>
    </table>
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
        return {adding: false, fresh: {host: '', machine: '', auth: ''}, busy: false, note: '', bad: false};
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
