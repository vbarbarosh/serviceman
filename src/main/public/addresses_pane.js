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
    <ul class="fold-list">
        <li v-for="row of rows" :key="row.key" :class="{off: row.off, open: row_open(row)}">
            <button type="button" class="fold-line" :aria-expanded="row_open(row)" @click="row_toggle(row)">
                <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                <span class="dot" :class="row_dot(row)"/>
                <b class="name" :title="row.address">{{ row.address }}</b>
                <span class="route muted" :title="(row.place + ' → ' + row.service_title)">{{ row.place }} → {{ row.service_title }}</span>
                <span class="word" :class="{bad: (row.service === ''), muted: (row.behind === null && row.off === false && row.service !== '')}">{{ row_word(row) }}</span>
            </button>
            <div v-if="row_open(row)" class="fold-details">
                <dl>
                    <dt>Opens</dt>
                    <dd><a :href="row.url" target="_blank" rel="noopener"><code>{{ row.address }}</code></a><span v-if="(row.note !== '')" class="muted"> · {{ row.note }}</span></dd>
                    <dt>Goes to</dt>
                    <dd><span v-if="(row.service === '')" class="bad">no such service</span><button v-else type="button" class="link" @click="$emit('select', row.service)">{{ row.service_title }}</button><span v-if="(row.service !== '')" class="muted"> · {{ row.phase }}</span></dd>
                    <dt>Through</dt>
                    <dd :class="{muted: (row.remote === null)}">{{ row.through }}</dd>
                    <dt>Behind</dt>
                    <dd :class="{muted: (row.behind === null)}">{{ (row.behind === null ? 'nothing — anyone may reach it' : row.behind) }}</dd>
                </dl>
                <div class="fold-actions">
                    <span v-if="(row.remote === null)" class="muted">serviceman answers its own addresses for as long as the service is in the config</span>
                    <label v-else :title="('Whether the door of ' + row.place + ' answers this name')"><input type="checkbox" :checked="(row.off === false)" :disabled="busy" @change="turn(row, $event.target.checked)"> Answering</label>
                </div>
            </div>
        </li>
        <li v-if="(rows.length === 0)" class="muted empty">{{ rows_all.length === 0 ? 'No addresses yet. A service with a publish.host has one; a door name is added under Doors.' : 'Nothing matches.' }}</li>
    </ul>
    <p v-if="(note !== '')" class="bad">{{ note }}</p>
</article>
`,
    // remote: the one machine whose door names the list is narrowed to, or null for every address
    props: ['state', 'remote'],
    emits: ['doors', 'only', 'select'],
    data: function () {
        // `opened` is the addresses whose details are shown, by their row's key
        return {filter: '', show: 'all', busy: false, note: '', opened: {}};
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
        row_open: function (row) {
            return (this.opened[row.key] === true);
        },
        row_toggle: function (row) {
            this.opened = Object.assign({}, this.opened, {[row.key]: (this.row_open(row) === false)});
        },
        // Where an address stands, in a word or two for its one line
        row_word: function (row) {
            if (row.service === '') {
                return 'no such service';
            }
            if (row.off) {
                return 'set aside';
            }
            return ((row.behind === null) ? 'no wall' : `behind ${row.behind}`);
        },
        // The service's own dot, while the name is answered
        row_dot: function (row) {
            return (row.off ? '' : row.phase);
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
                place: ((remote === null) ? 'serviceman' : (remote.title || remote.name)),
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
