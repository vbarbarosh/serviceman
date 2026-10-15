import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';

// The one wall the fleet signs in through
const WALL_NAME = 'authwall';

// Authwall: how visitors sign in. Not a service like the rest — the thing a door asks before
// anything behind a name is touched — so it has a page of its own: the wall, and the names it
// stands in front of. There may be more than one wall; the page shows one at a time, the one
// called authwall first, and names the others.
const authwall_pane = {
    template: `
<article id="detail">
    <h1>Authwall</h1>
    <p class="muted">How visitors sign in. A door asks the wall <code>/auth/sidecar</code> before anything behind a name is touched: a yes carries the request on with <code>X-Auth-User</code>, a no sends the visitor to <code>/auth/sign-in</code>, and a wall that cannot be asked lets nothing through. Who may pass is the wall's own business; serviceman writes nothing into it.</p>
    <div v-if="(wall === null)" class="card svc-status">
        <div class="row-of svc-state">
            <span class="pill">None yet</span>
            <span class="muted">A wall is a service — authwall — asked before a name is answered. Add a service called <code>authwall</code>, and the names to guard are then picked here.</span>
        </div>
        <div class="actions">
            <button type="button" class="primary" @click="$emit('create')">Add service</button>
        </div>
    </div>
    <template v-else>
        <div class="card svc-status">
            <div class="row-of svc-state">
                <span class="pill" :class="head.pill">{{ head.text }}</span>
                <span class="muted">{{ head.detail }}</span>
            </div>
            <p v-if="(others.length > 0)" class="muted">
                {{ others.length === 1 ? 'Another wall is' : 'Other walls are' }} in use too:
                <template v-for="(item, i) of others" :key="item.name"><template v-if="(i > 0)">, </template><button type="button" class="link" @click="picked = item.name">{{ item.name }}</button> ({{ item.count === 1 ? 'one name' : item.count + ' names' }})</template>.
                <button v-if="(wall !== wall_default)" type="button" class="link" @click="picked = null">Back to {{ wall_default }}</button>
            </p>
            <div class="actions">
                <button v-if="(service !== null)" type="button" @click="$emit('select', service.name)">Its service page</button>
            </div>
        </div>
        <h2>What it guards</h2>
        <div class="wide-scroll">
            <table class="grid-table rules">
                <colgroup>
                    <col>
                    <col width="200">
                    <col width="200">
                    <col width="220">
                </colgroup>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Door of</th>
                        <th>Answered by</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="rule of guarded" :key="(rule.machine + ' ' + rule.host)" :class="{off: rule.off}">
                        <td><code>{{ rule.host }}</code><span v-if="rule.off" class="muted"> · set aside</span></td>
                        <td>{{ rule.title }}</td>
                        <td><button type="button" class="link" @click="$emit('select', rule.service)">{{ rule.service }}</button></td>
                        <td><button type="button" :disabled="busy" @click="guard(rule, null)">Stop guarding</button></td>
                    </tr>
                    <tr v-if="(guarded.length === 0)">
                        <td class="muted" colspan="4">Nothing yet — pick a name below.</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <h2>Not behind it</h2>
        <div class="wide-scroll">
            <table class="grid-table rules">
                <colgroup>
                    <col>
                    <col width="200">
                    <col width="200">
                    <col width="240">
                    <col width="220">
                </colgroup>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Door of</th>
                        <th>Answered by</th>
                        <th>Behind</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="rule of open" :key="(rule.machine + ' ' + rule.host)" :class="{off: rule.off}">
                        <td><code>{{ rule.host }}</code><span v-if="rule.off" class="muted"> · set aside</span></td>
                        <td>{{ rule.title }}</td>
                        <td><button type="button" class="link" @click="$emit('select', rule.service)">{{ rule.service }}</button></td>
                        <td :class="{muted: (rule.auth === null)}">{{ (rule.auth === null ? 'nothing — anyone may reach it' : rule.auth) }}</td>
                        <td><button type="button" :disabled="busy" @click="guard(rule, wall)">Guard with {{ wall }}</button></td>
                    </tr>
                    <tr v-if="(open.length === 0)">
                        <td class="muted" colspan="5">Every name a door answers is behind {{ wall }}.</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </template>
    <p :class="(bad ? 'bad' : 'muted')">{{ note }} <template v-if="(note === '')">A name is given to a door on the <button type="button" class="link" @click="$emit('doors')">Doors</button> page.</template></p>
</article>
`,
    props: ['state'],
    emits: ['create', 'doors', 'select'],
    data: function () {
        // `picked` is another wall looked at for now; null is the usual one
        return {picked: null, busy: false, note: '', bad: false};
    },
    computed: {
        // Every name a machine's door answers, with the wall in front of it
        rules: function () {
            const out = [];
            for (const item of this.state.remotes) {
                const inbound = ((item.inbound === undefined) ? {} : item.inbound);
                for (const host of Object.keys(inbound)) {
                    const rule = ((typeof inbound[host] === 'string') ? {service: inbound[host]} : inbound[host]);
                    out.push({machine: item.name, title: (item.title || item.name), host, service: rule.service, off: (rule.off === true), auth: ((rule.auth === undefined) ? null : rule.auth)});
                }
            }
            return out;
        },
        // The walls in use, the busiest first
        walls: function () {
            const counts = {};
            for (const rule of this.rules.filter(v => v.auth !== null)) {
                counts[rule.auth] = (counts[rule.auth] || 0) + 1;
            }
            return Object.keys(counts).map(v => ({name: v, count: counts[v]})).sort((a, b) => b.count - a.count);
        },
        // The one called authwall, or else the one most names are behind
        wall_default: function () {
            if (this.state.services.some(v => v.name === WALL_NAME)) {
                return WALL_NAME;
            }
            return ((this.walls.length === 0) ? null : this.walls[0].name);
        },
        wall: function () {
            return ((this.picked === null) ? this.wall_default : this.picked);
        },
        others: function () {
            return this.walls.filter(v => v.name !== this.wall);
        },
        service: function () {
            return this.state.services.find(v => v.name === this.wall) || null;
        },
        head: function () {
            const count = this.guarded.length;
            const guards = ((count === 0) ? 'guards nothing yet' : `guards ${(count === 1) ? 'one name' : `${count} names`}`);
            if (this.service === null) {
                return {pill: 'failed', text: 'no such service', detail: `Names are behind ${this.wall}, and no service is called that: a door lets nothing through them.`};
            }
            const name = ((Array.isArray(this.service.remotes) && (this.service.remotes.length > 0)) ? this.service.remotes[0] : null);
            const found = this.state.remotes.find(v => v.name === name);
            const where = ((found === undefined) ? '' : ` on ${found.title || found.name}`);
            return {pill: this.service.phase, text: this.service.phase, detail: `${this.service.name}${where} · ${guards}`};
        },
        guarded: function () {
            return this.rules.filter(v => v.auth === this.wall);
        },
        open: function () {
            return this.rules.filter(v => v.auth !== this.wall);
        },
    },
    methods: {
        // The wall put in front of a name, or taken away; the name keeps everything else it has
        guard: async function (rule, auth) {
            this.busy = true;
            this.report('', false);
            const error = await door_rules_write(rule.machine, function (inbound) {
                inbound[rule.host] = door_rule_value(rule.service, rule.off, auth);
            });
            this.busy = false;
            if (error !== null) {
                this.report(error, true);
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
};

export default authwall_pane;
