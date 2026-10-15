import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import fold_table from './fold_table.js';

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
        <fold-table v-slot="fold" :order="['acts', 'service', 'machine']">
            <table>
                <thead>
                    <tr>
                        <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                        <th>Name</th>
                        <th data-fold="machine">Door of</th>
                        <th data-fold="service">Answered by</th>
                        <th data-fold="acts"></th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="rule of guarded" :key="rule_key(rule)">
                        <tr :class="{off: rule.off, foldable: (fold.folded.length > 0), open: fold.is_open(rule_key(rule))}" @click="fold.toggle(rule_key(rule), $event)">
                            <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                            <td class="wraps"><code class="name">{{ rule.host }}</code><span v-if="rule.off" class="muted"> · set aside</span></td>
                            <td data-fold="machine">{{ rule.title }}</td>
                            <td data-fold="service"><button type="button" class="link" @click="$emit('select', rule.service)">{{ rule.service }}</button></td>
                            <td data-fold="acts"><button type="button" :disabled="busy" @click="guard(rule, null)">Stop guarding</button></td>
                        </tr>
                        <tr v-if="fold.is_open(rule_key(rule))" class="fold-more">
                            <td :colspan="fold.span">
                                <dl class="fold-details">
                                    <template v-if="fold.folded.includes('machine')">
                                        <dt>Door of</dt>
                                        <dd>{{ rule.title }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('service')">
                                        <dt>Answered by</dt>
                                        <dd><button type="button" class="link" @click="$emit('select', rule.service)">{{ rule.service }}</button></dd>
                                    </template>
                                    <template v-if="fold.folded.includes('acts')">
                                        <dt>Change</dt>
                                        <dd class="fold-actions"><button type="button" :disabled="busy" @click="guard(rule, null)">Stop guarding</button></dd>
                                    </template>
                                </dl>
                            </td>
                        </tr>
                    </template>
                    <tr v-if="(guarded.length === 0)">
                        <td class="muted wraps" colspan="4">Nothing yet — pick a name below.</td>
                    </tr>
                </tbody>
            </table>
        </fold-table>
        <h2>Not behind it</h2>
        <fold-table v-slot="fold" :order="['acts', 'behind', 'service', 'machine']">
            <table>
                <thead>
                    <tr>
                        <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                        <th>Name</th>
                        <th data-fold="machine">Door of</th>
                        <th data-fold="service">Answered by</th>
                        <th data-fold="behind">Behind</th>
                        <th data-fold="acts"></th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="rule of open" :key="rule_key(rule)">
                        <tr :class="{off: rule.off, foldable: (fold.folded.length > 0), open: fold.is_open(rule_key(rule))}" @click="fold.toggle(rule_key(rule), $event)">
                            <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                            <td class="wraps"><code class="name">{{ rule.host }}</code><span v-if="rule.off" class="muted"> · set aside</span></td>
                            <td data-fold="machine">{{ rule.title }}</td>
                            <td data-fold="service"><button type="button" class="link" @click="$emit('select', rule.service)">{{ rule.service }}</button></td>
                            <td data-fold="behind" :class="{muted: (rule.auth === null)}">{{ behind_text(rule) }}</td>
                            <td data-fold="acts"><button type="button" :disabled="busy" @click="guard(rule, wall)">Guard with {{ wall }}</button></td>
                        </tr>
                        <tr v-if="fold.is_open(rule_key(rule))" class="fold-more">
                            <td :colspan="fold.span">
                                <dl class="fold-details">
                                    <template v-if="fold.folded.includes('machine')">
                                        <dt>Door of</dt>
                                        <dd>{{ rule.title }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('service')">
                                        <dt>Answered by</dt>
                                        <dd><button type="button" class="link" @click="$emit('select', rule.service)">{{ rule.service }}</button></dd>
                                    </template>
                                    <template v-if="fold.folded.includes('behind')">
                                        <dt>Behind</dt>
                                        <dd :class="{muted: (rule.auth === null)}">{{ behind_text(rule) }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('acts')">
                                        <dt>Change</dt>
                                        <dd class="fold-actions"><button type="button" :disabled="busy" @click="guard(rule, wall)">Guard with {{ wall }}</button></dd>
                                    </template>
                                </dl>
                            </td>
                        </tr>
                    </template>
                    <tr v-if="(open.length === 0)">
                        <td class="muted wraps" colspan="5">Every name a door answers is behind {{ wall }}.</td>
                    </tr>
                </tbody>
            </table>
        </fold-table>
    </template>
    <p :class="(bad ? 'bad' : 'muted')">{{ note }} <template v-if="(note === '')">A name is given to a door on the <button type="button" class="link" @click="$emit('doors')">Doors</button> page.</template></p>
</article>
`,
    components: {'fold-table': fold_table},
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
        rule_key: function (rule) {
            return `${rule.machine} ${rule.host}`;
        },
        behind_text: function (rule) {
            return ((rule.auth === null) ? 'nothing — anyone may reach it' : rule.auth);
        },
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
