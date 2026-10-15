import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import fold_table from './fold_table.js';

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
    <fold-table v-slot="fold" class="card" :order="['behind', 'through', 'service']">
        <table class="list-table">
            <thead>
                <tr>
                    <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                    <th>Address</th>
                    <th data-fold="service">Goes to</th>
                    <th data-fold="through">Arrives through</th>
                    <th data-fold="behind">Behind</th>
                    <th>On</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="row of rows" :key="row.key">
                    <tr class="pick" :class="{off: row.off, foldable: (fold.folded.length > 0), open: fold.is_open(row.key)}" @click="row_click(row, fold, $event)">
                        <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td class="wraps">
                            <a :href="row.url" target="_blank" rel="noopener" @click.stop><code>{{ row.address }}</code></a>
                            <span v-if="(row.note !== '')" class="muted"> · {{ row.note }}</span>
                        </td>
                        <td data-fold="service">
                            <button v-if="(fold.folded.length > 0)" type="button" class="link row-of" title="The service's page" @click="$emit('select', row.service)"><span class="dot" :class="row.phase"/>{{ row.service_title }}</button>
                            <span v-else class="row-of"><span class="dot" :class="row.phase"/>{{ row.service_title }}</span>
                        </td>
                        <td data-fold="through" :class="{muted: (row.remote === null)}">{{ row.through }}</td>
                        <td data-fold="behind" :class="{muted: (row.behind === null)}">{{ row.behind === null ? '—' : row.behind }}</td>
                        <td @click.stop>
                            <span v-if="(row.remote === null)" class="pill running" title="serviceman answers its own addresses for as long as the service is in the config">on</span>
                            <span v-else class="seg" :title="('Whether the door of ' + row.remote + ' answers this name')">
                                <button type="button" :class="{on: (row.off === false)}" :disabled="busy" @click="turn(row, true)">On</button>
                                <button type="button" :class="{on: row.off}" :disabled="busy" @click="turn(row, false)">Off</button>
                            </span>
                        </td>
                    </tr>
                    <tr v-if="fold.is_open(row.key)" class="fold-more">
                        <td :colspan="fold.span">
                            <dl class="fold-details">
                                <template v-if="fold.folded.includes('service')">
                                    <dt>Goes to</dt>
                                    <dd><button type="button" class="link row-of" title="The service's page" @click="$emit('select', row.service)"><span class="dot" :class="row.phase"/>{{ row.service_title }}</button></dd>
                                </template>
                                <template v-if="fold.folded.includes('through')">
                                    <dt>Arrives through</dt>
                                    <dd :class="{muted: (row.remote === null)}">{{ row.through }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('behind')">
                                    <dt>Behind</dt>
                                    <dd :class="{muted: (row.behind === null)}">{{ row.behind === null ? 'nothing — anyone may reach it' : row.behind }}</dd>
                                </template>
                            </dl>
                        </td>
                    </tr>
                </template>
                <tr v-if="(rows.length === 0)">
                    <td class="muted wraps" colspan="6">{{ rows_all.length === 0 ? 'No addresses yet. A service with a publish.host has one; a door name is added under Doors.' : 'Nothing matches.' }}</td>
                </tr>
            </tbody>
        </table>
    </fold-table>
    <p v-if="(note !== '')" class="bad">{{ note }}</p>
</article>
`,
    components: {'fold-table': fold_table},
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
        // With nothing folded a row opens its service, as it always has; with columns folded it
        // opens what folded, and the service is a link of its own
        row_click: function (row, fold, event) {
            if (fold.folded.length === 0) {
                this.$emit('select', row.service);
                return;
            }
            fold.toggle(row.key, event);
        },
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
