import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import https_off_note from './https_off_note.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import state_pill from './state_pill.js';
import walls_of from './walls_of.js';

// How often the ways are asked again while the page is open: serviceman keeps each lookup as long
const WAYS_EVERY_MS = 30000;

// The mark of a way's check in its row's tile, an icon's inside: works, measured not to, not
// told by what was measured, nothing to measure, being checked; and the colour of each
const WAY_ICONS = {ok: '<path d="M5 12l5 5 9-10"/>', bad: '<path d="M6 6l12 12M18 6L6 18"/>', unsure: '<path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.7V14M12 17.5v.5"/>', none: '<path d="M7 12h10"/>', checking: '<path d="M6 12h.5M12 12h.5M18 12h.5"/>'};
const WAY_TONES = {ok: 'run', bad: 'bad', unsure: 'warn', none: '', checking: ''};

// Where a name is set, as the link says it
const SET_IN_WORDS = {settings: 'Settings', apps: 'Apps', config: 'Config', doors: 'Doors'};

// Every name a request can arrive on, one row each, and the service that answers it — through
// serviceman's own door, an app's own port, or the door of a machine — with its whole way: who
// opens it, whether it works as far as serviceman can tell and why not, and where it is set.
// The doors themselves are set up on their own page, behind the button at the top.
const addresses_pane = {
    template: `
<article id="detail" class="list">
    <page-head category="addresses" :count="rows_all.length">
        <template #acts>
            <button type="button" @click="$emit('doors')">Doors and door names</button>
        </template>
    </page-head>
    <https-off-note v-if="https_off_shown" :https_off="state.tailnet.https_off"/>
    <p v-if="(ways_error !== '')" class="bad">Not checked whether each opens: {{ ways_error }}</p>
    <data-table :columns="columns" :rows="rows" row_key="key" :row_class="row_class" :acts="(row => (row.remote !== null))" framed :total="rows_here.length" :foot="foot" :empty_icon="ADDRESSES_ICON" empty_title="No addresses yet" empty="An address shows up here once a service is published at a name, or a machine's door answers one.">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find an address or a service" aria-label="Find an address by its name or its service" spellcheck="false">
            <span class="dt-chips">
                <button v-if="(place_title !== null)" type="button" class="chip on" title="Show every address again" @click="$emit('only', null)">the door of {{ place_title }} ×</button>
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    <span v-if="(chip.value === 'bad')" class="dot failed"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #empty_act><button type="button" class="primary" @click="$emit('create')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New service</button></template>
        <template #cell="{row, column, more}">
            <span v-if="(column.key === 'address')" :title="way_mark_title(row)">
                <name-cell :icon="WAY_ICONS[way_class(row)]" :tile="WAY_TONES[way_class(row)]" :name="row.address" :line="line_of(row, more)" :tone="WAY_TONES[way_class(row)]" mono/>
            </span>
            <button v-else-if="(column.key === 'service')" type="button" class="link dt-state" title="The service's page" @click="$emit('select', row.service)"><span class="dot" :class="row.phase"/>{{ row.service_title }}</button>
            <span v-else-if="(column.key === 'who')" :title="way_title(row)">{{ way_who(row) }}</span>
            <button v-else-if="(column.key === 'set_in')" type="button" class="link" :title="set_in_title(row)" @click="set_in_open(row)">{{ set_in_words(row) }}</button>
            <code v-else-if="(column.key === 'through')" :class="{muted: (row.remote === null)}">{{ row.through }}</code>
            <template v-else-if="(column.key === 'behind')">
                <span v-if="(row.behind !== null)" class="tag walled"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>{{ row.behind }}</span>
                <span v-else class="muted">{{ (more ? 'nothing — anyone may reach it' : '—') }}</span>
            </template>
            <state-pill v-else-if="(column.key === 'on')" :tone="on_of(row).tone" :text="on_of(row).text"/>
        </template>
        <!-- A door's name is answered or set aside, and put behind a wall, in its window:
             serviceman's own always are answered -->
        <template #actions="{row}">
            <span class="seg" :title="('Whether the door of ' + row.remote + ' answers this name')">
                <button type="button" :class="{on: (row.off === false)}" :disabled="busy" @click="turn(row, true)">On</button>
                <button type="button" :class="{on: row.off}" :disabled="busy" @click="turn(row, false)">Off</button>
            </span>
            <label v-if="(row.kind === 'door')" class="behind-pick" :title="((row.service_auth === null) ? 'The wall its door asks before this name is answered' : (row.service_title + ' stands behind ' + row.service_auth + ' at every address: its Settings, on Apps'))">
                Behind
                <select :value="((row.rule_auth === null) ? '' : row.rule_auth)" :disabled="(busy || (row.service_auth !== null))" @change="guard(row, (($event.target.value === '') ? null : $event.target.value))">
                    <option value="">nothing</option>
                    <option v-for="item of walls" :key="item.name" :value="item.name">{{ item.name }}</option>
                </select>
            </label>
        </template>
    </data-table>
    <p v-if="(note !== '')" class="bad">{{ note }}</p>
</article>
`,
    components: {'data-table': data_table, 'https-off-note': https_off_note, 'name-cell': name_cell, 'page-head': page_head, 'state-pill': state_pill},
    // remote: the one machine whose door names the list is narrowed to, or null for every address
    props: ['state', 'remote'],
    emits: ['apps', 'config', 'create', 'doors', 'only', 'select', 'settings'],
    data: function () {
        // ways: each row's way by its key (address_ways), null until serviceman first says;
        // ways_error: why it did not
        return {filter: '', show: 'all', busy: false, note: '', ways: null, ways_error: '', timer: null, ADDRESSES_ICON: CATEGORIES.find(v => v.key === 'addresses').icon, WAY_ICONS, WAY_TONES};
    },
    computed: {
        // The table's columns, each that may fold with when: what stands in front first; on a
        // phone who opens it and where it goes share a line
        columns: function () {
            return [
                {key: 'address', label: 'Address'},
                {key: 'who', label: 'Who opens it', fold: 5},
                {key: 'service', label: 'Goes to', fold: 4},
                {key: 'set_in', label: 'Set in', fold: 3, phone: 'hide'},
                {key: 'through', label: 'Arrives through', fold: 2, phone: 'hide'},
                {key: 'behind', label: 'Behind', fold: 1, phone: 'hide'},
                {key: 'on', label: 'Status', phone: 'state'},
            ];
        },
        // The footer: how many, behind a wall, not opening, and not told
        foot: function () {
            const rows = this.rows_here;
            const out = [{text: `${rows.length} ${(rows.length === 1) ? 'address' : 'addresses'}`, tone: ''}];
            const walled = rows.filter(v => v.behind !== null).length;
            const bad = rows.filter(v => this.check_of(v) === 'bad').length;
            const unsure = rows.filter(v => this.check_of(v) === 'unsure').length;
            if (walled > 0) {
                out.push({text: `${walled} behind a wall`, tone: ''});
            }
            if (bad > 0) {
                out.push({text: `${bad} not opening`, tone: 'bad'});
            }
            if (unsure > 0) {
                out.push({text: `${unsure} not sure`, tone: 'warn'});
            }
            return out;
        },
        // Said over the table while an app's own port has a tailnet link that opens over http
        https_off_shown: function () {
            const tailnet = this.state.tailnet;
            if ((tailnet === undefined) || (tailnet === null) || (tailnet.https_off === undefined) || (tailnet.https_off === null)) {
                return false;
            }
            return this.rows_all.some(v => (v.kind === 'port') && (v.url !== ''));
        },
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
                    const note = (host.includes('/') && service.publish.strip_prefix) ? 'prefix stripped' : '';
                    out.push(this.row_of('service', `service ${service.name} ${host}`, host, this.url_of(host), note, service, null, service.auth, false));
                }
            }
            // Each app's own port, on serviceman's name on the tailnet
            const tailnet = ((this.state.tailnet === undefined) || (this.state.tailnet === null)) ? null : this.state.tailnet.name;
            // https once they answer it on the tailnet's certificate; why not, as Health says it
            const scheme = ((tailnet !== null) && (this.state.tailnet.https === true)) ? 'https' : 'http';
            const https_off = ((tailnet === null) || (this.state.tailnet.https_off === undefined) || (this.state.tailnet.https_off === null)) ? '' : `http only: ${this.state.tailnet.https_off.why}`;
            const ports = ((this.state.app_ports === undefined) || (this.state.app_ports === null)) ? {} : this.state.app_ports;
            for (const name of Object.keys(ports)) {
                const service = service_by_name[name] || null;
                const port = ports[name].port;
                const address = (tailnet === null) ? `:${port}` : `${tailnet}:${port}`;
                const url = (tailnet === null) ? '' : `${scheme}://${tailnet}:${port}/`;
                const row = this.row_of('port', `port ${name}`, address, url, https_off, service, null, (service === null) ? undefined : service.auth, false);
                row.through = `serviceman :${port}`;
                out.push(row);
            }
            for (const remote of this.state.remotes) {
                const rule_by_host = (remote.inbound === undefined) ? {} : remote.inbound;
                for (const host of Object.keys(rule_by_host)) {
                    const rule = rule_by_host[host];
                    const service = service_by_name[rule.service] || null;
                    // The wall the service stands behind at every address comes before the rule's
                    const behind = ((service !== null) && (service.auth !== null)) ? service.auth : rule.auth;
                    const row = this.row_of('door', `door ${remote.name} ${host}`, host, `https://${host}/`, '', service, remote, behind, rule.off);
                    // Its own wall, as its rule writes it, and the one its service stands behind
                    // everywhere, which comes first
                    row.rule_auth = ((rule.auth === undefined) || (rule.auth === null)) ? null : rule.auth;
                    row.service_auth = ((service === null) || (service.auth === null) || (service.auth === undefined)) ? null : service.auth;
                    out.push(row);
                }
            }
            out.sort((a, b) => a.address.localeCompare(b.address));
            return out;
        },
        keys: function () {
            return this.rows_all.map(v => v.key).join('\n');
        },
        // The walls a door's name may be put behind, as the Authwall page lists them
        walls: function () {
            return walls_of(this.state);
        },
        // The apps, as the Apps page lists them: where their names are set
        app_names: function () {
            return (this.state === null) ? [] : this.state.services.filter(v => (v.type === 'files') || (v.app_folder !== null) || ((v.socket !== null) && (v.socket !== undefined))).map(v => v.name);
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
            const found = (this.state === null) ? undefined : this.state.remotes.find(v => v.name === this.remote);
            return (found === undefined) ? null : (found.title || found.name);
        },
        chips: function () {
            const rows = this.rows_here;
            return [
                {value: 'all', label: 'All', count: rows.length},
                {value: 'serviceman', label: 'serviceman', count: rows.filter(v => v.remote === null).length},
                {value: 'door', label: 'A remote’s door', count: rows.filter(v => v.remote !== null).length},
                {value: 'behind', label: 'Behind a wall', count: rows.filter(v => v.behind !== null).length},
                {value: 'bad', label: 'Not opening', count: rows.filter(v => this.check_of(v) === 'bad').length},
            ];
        },
    },
    watch: {
        // A name added or taken away while the page is open is checked at once
        keys: function () {
            this.ways_load();
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
            const problem = await door_rules_write(row.remote, function (inbound) {
                inbound[row.address] = door_rule_value(row.service, on === false, row.rule_auth);
            });
            this.busy = false;
            this.note = (problem === null) ? '' : problem;
        },
        // A wall put in front of a door's name, or taken away; the name keeps everything else
        guard: async function (row, auth) {
            if (row.rule_auth === auth) {
                return;
            }
            this.busy = true;
            this.note = '';
            const problem = await door_rules_write(row.remote, function (inbound) {
                inbound[row.address] = door_rule_value(row.service, row.off, auth);
            });
            this.busy = false;
            this.note = (problem === null) ? '' : problem;
        },
        row_of: function (kind, key, address, url, note, service, remote, behind, off) {
            const port = this.state.listen.port;
            return {
                kind,
                key,
                address,
                url,
                note,
                service: (service === null) ? '' : service.name,
                service_title: (service === null) ? 'no such service' : (service.title || service.name),
                phase: (service === null) ? 'failed' : service.phase,
                remote: (remote === null) ? null : remote.name,
                through: (remote === null) ? `serviceman :${port}` : `the door of ${remote.title || remote.name}`,
                behind: (behind === undefined) ? null : behind,
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
            if ((this.show === 'bad') && (this.check_of(row) !== 'bad')) {
                return false;
            }
            if (wanted === '') {
                return true;
            }
            const way = this.way_of(row);
            const words = [row.address, row.service, row.service_title, row.through, row.behind || ''].concat((way === null) ? [] : [way.who, way.why]).join(' ').toLowerCase();
            return words.includes(wanted);
        },
        // Its way as serviceman last checked it, null while it has not (address_ways)
        way_of: function (row) {
            if (this.ways === null) {
                return null;
            }
            const found = this.ways[row.key];
            return (found === undefined) ? null : found;
        },
        check_of: function (row) {
            const way = this.way_of(row);
            return (way === null) ? null : way.check;
        },
        // Not checked yet: being checked, or not checked at all where serviceman did not answer
        way_class: function (row) {
            const check = this.check_of(row);
            if (check !== null) {
                return check;
            }
            return (this.ways_error === '') ? 'checking' : 'none';
        },
        // A row not opening is edged red, one not told orange; one set aside is struck through
        row_class: function (row) {
            const check = this.check_of(row);
            return [{bad: 'dt-bad', unsure: 'dt-warn'}[check] || []].concat(row.off ? ['off'] : []).flat();
        },
        // The line under the address: what was measured where it does not open, else its note
        line_of: function (row, more) {
            const why = this.way_why(row, more);
            return (why === '') ? row.note : why;
        },
        // Whether it is answered: on; off where a door's name is set aside; not opening, or not
        // sure, as its check says
        on_of: function (row) {
            if (row.off) {
                return {tone: 'idle', text: 'off'};
            }
            const check = this.check_of(row);
            if (check === 'bad') {
                return {tone: 'bad', text: 'not opening'};
            }
            if (check === 'unsure') {
                return {tone: 'busy', text: 'not sure'};
            }
            return {tone: 'run', text: 'on'};
        },
        // What the mark beside an address says: whether it opens, and for whom
        way_mark_title: function (row) {
            const way = this.way_of(row);
            if (way === null) {
                return (this.ways_error === '') ? 'Being checked' : 'Not checked';
            }
            const said = {ok: 'Opens', bad: 'Does not open', unsure: 'Not told by what serviceman could measure', none: 'Not checked'}[way.check];
            return (way.why === '') ? said : `${said}: ${way.why}`;
        },
        way_who: function (row) {
            const way = this.way_of(row);
            if (way === null) {
                return (this.ways_error === '') ? 'checking' : 'not checked';
            }
            if (way.who !== '') {
                return way.who;
            }
            return (way.check === 'none') ? 'not checked' : 'no one';
        },
        // What was measured, under the mark where it is not a tick; in the row's window, how it is
        // found as well
        way_why: function (row, more) {
            const way = this.way_of(row);
            if (way === null) {
                return '';
            }
            const parts = (way.check === 'ok') ? [] : [way.why];
            if (more) {
                parts.push(`found by ${way.found}`);
            }
            return parts.filter(v => v !== '').join(' · ');
        },
        way_title: function (row) {
            const way = this.way_of(row);
            if (way === null) {
                return (this.ways_error === '') ? 'Being checked' : 'Not checked';
            }
            return `Found by ${way.found}`;
        },
        // Where the name is set: a door's names on Doors, an app's own port on Apps, a name under
        // the apps domain in the config, an app's other names on Apps, any other service's in
        // its settings
        set_in_of: function (row) {
            if (row.kind === 'door') {
                return 'doors';
            }
            if (row.kind === 'port') {
                return 'apps';
            }
            const domain = ((this.state.apps === undefined) || (this.state.apps === null)) ? null : this.state.apps.domain;
            const name = row.address.split('/')[0];
            if ((domain !== null) && name.endsWith(`.${domain}`)) {
                return 'config';
            }
            return this.app_names.includes(row.service) ? 'apps' : 'settings';
        },
        set_in_words: function (row) {
            return SET_IN_WORDS[this.set_in_of(row)];
        },
        set_in_title: function (row) {
            const set_in = this.set_in_of(row);
            if (set_in === 'settings') {
                return `The settings of ${row.service_title}, where its addresses are`;
            }
            if (set_in === 'apps') {
                return (row.kind === 'port') ? `Apps: serviceman gives each app its own port, from the config's apps.ports up` : `Apps, with the Settings of ${row.service_title} open`;
            }
            if (set_in === 'config') {
                return 'The config, at the apps domain: every app is named under it';
            }
            return 'Doors, where the names a machine\'s door answers are set';
        },
        set_in_open: function (row) {
            const set_in = this.set_in_of(row);
            if (set_in === 'settings') {
                this.$emit('settings', row.service);
            }
            else if (set_in === 'apps') {
                this.$emit('apps', (row.service === '') ? null : row.service);
            }
            else if (set_in === 'config') {
                this.$emit('config', '"apps"');
            }
            else {
                this.$emit('doors');
            }
        },
        ways_load: async function () {
            try {
                const answer = await fetch('/api/v1/addresses/ways', {cache: 'no-store'});
                const said = await answer.json();
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                this.ways = said.ways;
                this.ways_error = '';
            }
            catch (error) {
                this.ways_error = error.message;
            }
        },
        // Where the address opens: on the service door, with its port unless it is the one a
        // browser leaves out
        url_of: function (host) {
            const port = (this.state.listen.port === 80) ? '' : `:${this.state.listen.port}`;
            const mark = host.indexOf('/');
            const name = (mark === -1) ? host : host.slice(0, mark);
            const path = (mark === -1) ? '' : host.slice(mark);
            return `http://${name}${port}${path}`;
        },
    },
    created: function () {
        this.ways_load();
        this.timer = setInterval(this.ways_load, WAYS_EVERY_MS);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
};

export default addresses_pane;
