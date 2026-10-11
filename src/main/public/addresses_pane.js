import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';

// Every name a request can arrive on, one row each, and the service that answers it — through
// serviceman's own door, or through the door of a machine. The doors themselves are set up on
// their own page, behind the button at the top.
const addresses_pane = {
    template: `
<article id="detail" class="list">
    <div class="list-head">
        <h1>Addresses</h1>
        <span class="muted">{{ rows_all.length }}</span>
        <div class="list-acts">
            <button type="button" @click="$emit('doors')">Doors and door names</button>
        </div>
    </div>
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="filter by name or service" spellcheck="false">
        <button v-if="(place_title !== null)" type="button" class="chip on" title="Show every address again" @click="$emit('only', null)">the door of {{ place_title }} ×</button>
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
    </div>
    <div class="wide-scroll card">
        <table class="list-table">
            <thead>
                <tr>
                    <th>Address</th>
                    <th>Goes to</th>
                    <th>Arrives through</th>
                    <th>Behind</th>
                    <th>On</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="row of rows" :key="row.key" class="pick" :class="{off: row.off}" @click="$emit('select', row.service)">
                    <td>
                        <a :href="row.url" target="_blank" rel="noopener" @click.stop><code>{{ row.address }}</code></a>
                        <span v-if="(row.note !== '')" class="muted"> · {{ row.note }}</span>
                    </td>
                    <td><span class="row-of"><span class="dot" :class="row.phase"/>{{ row.service_title }}</span></td>
                    <td :class="{muted: (row.remote === null)}">{{ row.through }}</td>
                    <td :class="{muted: (row.behind === null)}">{{ row.behind === null ? '—' : row.behind }}</td>
                    <td @click.stop>
                        <span v-if="(row.remote === null)" class="pill running" title="serviceman answers its own addresses for as long as the service is in the config">on</span>
                        <span v-else class="seg" :title="('Whether the door of ' + row.remote + ' answers this name')">
                            <button type="button" :class="{on: (row.off === false)}" :disabled="busy" @click="turn(row, true)">On</button>
                            <button type="button" :class="{on: row.off}" :disabled="busy" @click="turn(row, false)">Off</button>
                        </span>
                    </td>
                </tr>
                <tr v-if="(note !== '')">
                    <td class="bad" colspan="5">{{ note }}</td>
                </tr>
                <tr v-if="(rows.length === 0)">
                    <td class="muted" colspan="5">{{ rows_all.length === 0 ? 'No addresses yet. A service with a publish.host has one; a door name is added under Doors.' : 'Nothing matches.' }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</article>
`,
    // remote: the one machine whose door names the list is narrowed to, or null for every address
    props: ['state', 'remote'],
    emits: ['doors', 'only', 'select'],
    data: function () {
        return {filter: '', show: 'all', busy: false, note: ''};
    },
    computed: {
        // Sorted by the name itself, the way one is looked for
        rows_all: function () {
            const out = [];
            if (this.state === null) {
                return out;
            }
            const service_by_name = {};
            for (const service of this.state.services) {
                service_by_name[service.name] = service;
                for (const host of service.publish.hosts) {
                    const note = ((host.includes('/') && service.publish.strip_prefix) ? 'prefix stripped' : '');
                    out.push(this.row_of(`${service.name} ${host}`, host, this.url_of(host), note, service, null, null, false));
                }
            }
            for (const remote of this.state.remotes) {
                const rule_by_host = ((remote.inbound === undefined) ? {} : remote.inbound);
                for (const host of Object.keys(rule_by_host)) {
                    const rule = rule_by_host[host];
                    const service = (service_by_name[rule.service] || null);
                    out.push(this.row_of(`${remote.name} ${host}`, host, `https://${host}/`, '', service, remote, rule.auth, rule.off));
                }
            }
            out.sort((a, b) => a.address.localeCompare(b.address));
            return out;
        },
        rows_here: function () {
            if (this.place_title === null) {
                return this.rows_all;
            }
            return this.rows_all.filter(v => v.remote === this.remote);
        },
        rows: function () {
            const wanted = this.filter.toLowerCase();
            return this.rows_here.filter(v => this.is_shown(v, wanted));
        },
        place_title: function () {
            const found = ((this.state === null) ? undefined : this.state.remotes.find(v => v.name === this.remote));
            return ((found === undefined) ? null : (found.title || found.name));
        },
        chips: function () {
            const rows = this.rows_here;
            return [
                {value: 'all', label: 'All', count: rows.length},
                {value: 'serviceman', label: 'serviceman', count: rows.filter(v => v.remote === null).length},
                {value: 'door', label: 'A remote’s door', count: rows.filter(v => v.remote !== null).length},
                {value: 'behind', label: 'Behind a wall', count: rows.filter(v => v.behind !== null).length},
            ];
        },
    },
    methods: {
        // A door name set aside, or put back; the rest of the rule stays as it is written
        turn: async function (row, on) {
            if (row.off === (on === false)) {
                return;
            }
            this.busy = true;
            this.note = '';
            const error = await door_rules_write(row.remote, function (inbound) {
                inbound[row.address] = door_rule_value(row.service, on === false, row.behind);
            });
            this.busy = false;
            this.note = ((error === null) ? '' : error);
        },
        row_of: function (key, address, url, note, service, remote, behind, off) {
            const port = this.state.listen.port;
            return {
                key,
                address,
                url,
                note,
                service: ((service === null) ? '' : service.name),
                service_title: ((service === null) ? 'no such service' : (service.title || service.name)),
                phase: ((service === null) ? 'failed' : service.phase),
                remote: ((remote === null) ? null : remote.name),
                through: ((remote === null) ? `serviceman :${port}` : `the door of ${remote.title || remote.name}`),
                behind: ((behind === undefined) ? null : behind),
                off,
            };
        },
        is_shown: function (row, wanted) {
            if ((this.show === 'serviceman') && (row.remote !== null)) {
                return false;
            }
            if ((this.show === 'door') && (row.remote === null)) {
                return false;
            }
            if ((this.show === 'behind') && (row.behind === null)) {
                return false;
            }
            if (wanted === '') {
                return true;
            }
            const words = [row.address, row.service, row.service_title, row.through, row.behind || ''].join(' ').toLowerCase();
            return words.includes(wanted);
        },
        // Where the address opens: on the service door, with its port unless it is the one a
        // browser leaves out
        url_of: function (host) {
            const port = ((this.state.listen.port === 80) ? '' : `:${this.state.listen.port}`);
            const mark = host.indexOf('/');
            const name = ((mark === -1) ? host : host.slice(0, mark));
            const path = ((mark === -1) ? '' : host.slice(mark));
            return `http://${name}${port}${path}`;
        },
    },
};

export default addresses_pane;
