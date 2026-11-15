import data_table from './data_table.js';
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
    <p class="muted">How visitors sign in. An app behind it (its Settings, on Apps) asks it at every address it has; a door asks the wall <code>/auth/sidecar</code> before anything behind a name is touched: a yes carries the request on with <code>X-Auth-User</code>, a no sends the visitor to <code>/auth/sign-in</code>, and a wall that cannot be asked lets nothing through. Who may pass is the wall's own business; serviceman writes nothing into it.</p>
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
                <template v-for="(item, i) of others" :key="item.name"><template v-if="(i > 0)">, </template><button type="button" class="link" @click="picked = item.name">{{ item.name }}</button> ({{ item.count }} guarded)</template>.
                <button v-if="(wall !== wall_default)" type="button" class="link" @click="picked = null">Back to {{ wall_default }}</button>
            </p>
            <div class="actions">
                <button v-if="(service !== null)" type="button" @click="$emit('select', service.name)">Its service page</button>
            </div>
        </div>
        <h2>What it guards</h2>
        <p v-if="guards_apps" class="muted">The page of every app too, and every app sent from now on: the box on top of Apps.</p>
        <data-table v-if="(behind.length > 0)" :columns="behind_columns" :rows="behind" row_key="name" actions_label="Change">
            <template #cell="{row, column}">
                <button v-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.name)">{{ row.title || row.name }}</button>
                <template v-else-if="(column.key === 'where')"><span class="muted">every address it has:</span> <code v-for="(host, i) of hosts_of(row)" :key="host" class="name">{{ host }}{{ (i < hosts_of(row).length - 1 ? ' ' : '') }}</code></template>
            </template>
            <template #actions="{row}">
                <span v-if="(row.auth_from === 'apps')" class="muted">with every app: the box on top of Apps</span>
                <button v-else type="button" :disabled="busy" @click="unwall(row)">Stop guarding</button>
            </template>
        </data-table>
        <data-table v-if="((guarded.length > 0) || (behind.length === 0))" :columns="guarded_columns" :rows="guarded" :row_key="rule_key" :row_class="v => (v.off ? 'off' : [])" actions_label="Change" empty="Nothing yet — pick a name below, or an app's Settings on Apps.">
            <template #cell="{row, column}">
                <template v-if="(column.key === 'host')"><code class="name">{{ row.host }}</code><span v-if="row.off" class="muted"> · set aside</span></template>
                <template v-else-if="(column.key === 'machine')">{{ row.title }}</template>
                <button v-else-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.service)">{{ row.service }}</button>
            </template>
            <template #actions="{row}">
                <button type="button" :disabled="busy" @click="guard(row, null)">Stop guarding</button>
            </template>
        </data-table>
        <h2>Not behind it</h2>
        <data-table :columns="open_columns" :rows="open" :row_key="rule_key" :row_class="v => (v.off ? 'off' : [])" actions_label="Change" :empty="((rules.length === 0) ? 'No door answers a name yet.' : ('Every name a door answers is behind ' + wall + '.'))">
            <template #cell="{row, column}">
                <template v-if="(column.key === 'host')"><code class="name">{{ row.host }}</code><span v-if="row.off" class="muted"> · set aside</span></template>
                <template v-else-if="(column.key === 'machine')">{{ row.title }}</template>
                <button v-else-if="(column.key === 'service')" type="button" class="link" @click="$emit('select', row.service)">{{ row.service }}</button>
                <span v-else-if="(column.key === 'behind')" :class="{muted: (row.auth === null)}">{{ behind_text(row) }}</span>
            </template>
            <template #actions="{row}">
                <button type="button" :disabled="busy" @click="guard(row, wall)">Guard with {{ wall }}</button>
            </template>
        </data-table>
    </template>
    <p :class="(bad ? 'bad' : 'muted')">{{ note }} <template v-if="(note === '')">A name is given to a door on the <button type="button" class="link" @click="$emit('doors')">Doors</button> page.</template></p>
</article>
`,
    components: {'data-table': data_table},
    props: ['state'],
    emits: ['create', 'doors', 'select'],
    data: function () {
        // `picked` is another wall looked at for now; null is the usual one
        return {picked: null, busy: false, note: '', bad: false};
    },
    computed: {
        // The tables' columns, each that may fold with when
        guarded_columns: function () {
            return [
                {key: 'host', label: 'Name', wraps: true},
                {key: 'machine', label: 'Door of', fold: 2},
                {key: 'service', label: 'Answered by', fold: 1},
            ];
        },
        behind_columns: function () {
            return [
                {key: 'service', label: 'App or service'},
                {key: 'where', label: 'Where', wraps: true, fold: 1},
            ];
        },
        // Whether Apps puts the page of apps and every app behind this wall
        guards_apps: function () {
            return (this.state.apps !== undefined) && (this.state.apps !== null) && (this.state.apps.auth === this.wall) && (this.wall !== null);
        },
        // The services behind this wall wherever they are asked, by a box of their own (an app's
        // Settings) or as every app (the box on top of Apps): every address they have, not a name
        // of a door
        behind: function () {
            return this.state.services.filter(v => (v.auth === this.wall));
        },
        open_columns: function () {
            return [
                {key: 'host', label: 'Name', wraps: true},
                {key: 'machine', label: 'Door of', fold: 3},
                {key: 'service', label: 'Answered by', fold: 2},
                {key: 'behind', label: 'Behind', fold: 1},
            ];
        },
        // Every name a machine's door answers, with the wall in front of it; a name of a service
        // that stands behind a wall at every address is that service's, in its row above
        rules: function () {
            return this.rules_all.filter(v => this.walled_names.includes(v.service) === false);
        },
        rules_all: function () {
            const out = [];
            for (const item of this.state.remotes) {
                const inbound = (item.inbound === undefined) ? {} : item.inbound;
                for (const host of Object.keys(inbound)) {
                    const rule = (typeof inbound[host] === 'string') ? {service: inbound[host]} : inbound[host];
                    out.push({machine: item.name, title: item.title || item.name, host, service: rule.service, off: (rule.off === true), auth: (rule.auth === undefined) ? null : rule.auth});
                }
            }
            return out;
        },
        walled_names: function () {
            return this.state.services.filter(v => (v.auth !== null) && (v.auth !== undefined)).map(v => v.name);
        },
        // The walls in use, the busiest first: names of doors and services behind each
        walls: function () {
            const counts = {};
            for (const rule of this.rules.filter(v => v.auth !== null)) {
                counts[rule.auth] = (counts[rule.auth] || 0) + 1;
            }
            for (const item of this.state.services.filter(v => (v.auth !== null) && (v.auth !== undefined))) {
                counts[item.auth] = (counts[item.auth] || 0) + 1;
            }
            return Object.keys(counts).map(v => ({name: v, count: counts[v]})).sort((a, b) => b.count - a.count);
        },
        // The one called authwall, or else the one most names are behind
        wall_default: function () {
            if (this.state.services.some(v => v.name === WALL_NAME)) {
                return WALL_NAME;
            }
            return (this.walls.length === 0) ? null : this.walls[0].name;
        },
        wall: function () {
            return (this.picked === null) ? this.wall_default : this.picked;
        },
        others: function () {
            return this.walls.filter(v => v.name !== this.wall);
        },
        service: function () {
            return this.state.services.find(v => v.name === this.wall) || null;
        },
        head: function () {
            const count = this.guarded.length;
            const apps = this.behind.length;
            const parts = [];
            if (apps > 0) {
                parts.push((apps === 1) ? 'one app at every address' : `${apps} apps at every address`);
            }
            if (count > 0) {
                parts.push((count === 1) ? 'one name' : `${count} names`);
            }
            const guards = (parts.length === 0) ? 'guards nothing yet' : `guards ${parts.join(' and ')}`;
            if (this.service === null) {
                return {pill: 'failed', text: 'no such service', detail: `Names are behind ${this.wall}, and no service is called that: a door lets nothing through them.`};
            }
            const name = (Array.isArray(this.service.remotes) && (this.service.remotes.length > 0)) ? this.service.remotes[0] : null;
            const found = this.state.remotes.find(v => v.name === name);
            const where = (found === undefined) ? '' : ` on ${found.title || found.name}`;
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
        // A service's own addresses, then the names doors give it
        hosts_of: function (service) {
            const doors = this.rules_all.filter(v => v.service === service.name).map(v => v.host);
            return service.publish.hosts.concat(doors.filter(v => service.publish.hosts.includes(v) === false));
        },
        rule_key: function (rule) {
            return `${rule.machine} ${rule.host}`;
        },
        behind_text: function (rule) {
            return (rule.auth === null) ? 'nothing — anyone may reach it' : rule.auth;
        },
        // The wall put in front of a name, or taken away; the name keeps everything else it has
        guard: async function (rule, auth) {
            this.busy = true;
            this.report('', false);
            const problem = await door_rules_write(rule.machine, function (inbound) {
                inbound[rule.host] = door_rule_value(rule.service, rule.off, auth);
            });
            this.busy = false;
            if (problem !== null) {
                this.report(problem, true);
            }
        },
        // A service out from behind the wall: it answers its addresses as before, and a door's
        // rule that names a wall still has that one asked
        unwall: async function (row) {
            this.busy = true;
            this.report('', false);
            try {
                const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
                const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === row.name);
                if (entry === undefined) {
                    throw new Error(`${row.name} is not in the config any more`);
                }
                const service = Object.assign({}, entry);
                delete service.auth;
                const answer = await fetch(`/api/v1/services/${encodeURIComponent(row.name)}`, {method: 'PUT', body: JSON.stringify({service})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
            }
            catch (error) {
                this.report(error.message, true);
            }
            this.busy = false;
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
};

export default authwall_pane;
