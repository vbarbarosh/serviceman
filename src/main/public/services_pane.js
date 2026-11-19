import data_table from './data_table.js';
import format_ms from './format_ms.js';
import is_name_in_title from './is_name_in_title.js';
import logline_link from './logline_link.js';
import logs_link from './logs_link.js';

// What a service is, as its row says it, with its icon: the inside of a 24x24 stroked svg
const KINDS = {
    docker: {word: 'Docker image', icon: '<rect x="3" y="10" width="5" height="4"/><rect x="9" y="10" width="5" height="4"/><rect x="9" y="5" width="5" height="4"/><rect x="15" y="10" width="5" height="4"/><path d="M2 15h20c-1 3.5-4 5.5-9 5.5S3.5 18.5 2 15z"/>'},
    app_folder: {word: 'App folder', icon: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M9 14l2 2 4-4"/>'},
    program: {word: 'Program', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>'},
    files: {word: 'Folder of files', icon: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'},
    socket: {word: 'App on a socket', icon: '<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"/>'},
    external: {word: 'Already running', icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'},
};

// Every service, one row each, in one table: its kind, its machine, its address, how it stands.
// A filter and the state chips narrow it; a click on a row opens the service.
const services_pane = {
    template: `
<article id="detail" class="list">
    <div class="list-head">
        <h1>Services</h1>
        <span class="muted">{{ services.length }}</span>
        <div class="list-acts">
            <button type="button" class="primary" @click="$emit('create')">+ New service</button>
        </div>
    </div>
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="find a service" aria-label="Find a service by its name, address, image or machine" spellcheck="false">
        <button v-if="(place !== null)" type="button" class="chip on" title="Show the services of every machine again" @click="$emit('only', null)">on {{ place.title }} ×</button>
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
            <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
    </div>
    <data-table :columns="columns" :rows="rows" row_key="name" :on_row="(row => $emit('select', row.name))" :marks="false" :empty="((services.length === 0) ? 'No services yet. A service is a docker image, a program, or an address serviceman answers for.' : 'Nothing matches.')">
        <template #cell="{row, column}">
            <span v-if="(column.key === 'name')" class="row-of">
                <svg class="dt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/>
                <button type="button" class="link" title="The service's page" @click="$emit('select', row.name)"><b>{{ row.title }}</b></button>
                <code v-if="row.name_shown" class="muted">{{ row.name }}</code>
                <logs-link :url="logs_url('service', row.name, row.remotes)" kind="service"/>
            </span>
            <template v-else-if="(column.key === 'what')">{{ row.what }}</template>
            <span v-else-if="(column.key === 'machine')" :class="{muted: (row.machine === '—')}">{{ row.machine }}</span>
            <template v-else-if="(column.key === 'address')">
                <a v-if="(row.host !== '')" :href="row.url" target="_blank" rel="noopener"><code>{{ row.host }}</code></a>
                <span v-else-if="(row.brought !== '')" class="muted" title="Its port, brought to these machines">→ {{ row.brought }}</span>
                <span v-else class="muted">no address</span>
                <span v-if="(row.more > 0)" class="tag">+{{ row.more }}</span>
            </template>
            <span v-else-if="(column.key === 'state')" class="dt-state"><span class="dot" :class="row.phase"/>{{ row.state }}</span>
            <span v-else-if="(column.key === 'detail')" :class="(row.bad ? 'bad' : 'muted')" :title="row.detail">{{ row.detail }}</span>
        </template>
    </data-table>
</article>
`,
    components: {'data-table': data_table, 'logs-link': logs_link},
    // remote: the one machine the list is narrowed to, or null for all of them
    props: ['state', 'remote'],
    emits: ['create', 'only', 'select'],
    data: function () {
        return {filter: '', show: 'all'};
    },
    computed: {
        services: function () {
            return (this.state === null) ? [] : this.state.services;
        },
        remotes: function () {
            return (this.state === null) ? [] : this.state.remotes;
        },
        place: function () {
            const found = this.remotes.find(v => v.name === this.remote);
            return (found === undefined) ? null : {name: found.name, title: found.title || found.name, tags: found.tags};
        },
        // What the machine carries — by its name, or by a #tag it has — the way its card counts it
        services_here: function () {
            const place = this.place;
            if (place === null) {
                return this.services;
            }
            return this.services.filter(v => v.remotes.some(vv => vv.startsWith('#') ? place.tags.includes(vv.slice(1)) : vv === place.name));
        },
        chips: function () {
            const services = this.services_here;
            return [
                {value: 'all', label: 'All', phase: null, count: services.length},
                {value: 'running', label: 'Running', phase: 'running', count: services.filter(v => v.phase === 'running').length},
                {value: 'stopped', label: 'Asleep', phase: 'stopped', count: services.filter(v => v.phase === 'stopped').length},
                {value: 'attention', label: 'Needs you', phase: 'failed', count: services.filter(v => this.is_attention(v)).length},
            ];
        },
        // The table's columns, each that may fold with when: the detail first, the address last
        columns: function () {
            return [
                {key: 'name', label: 'Name', wraps: true},
                {key: 'what', label: 'What', fold: 2},
                {key: 'machine', label: 'Machine', fold: 3},
                {key: 'address', label: 'Address', fold: 4},
                {key: 'state', label: 'State'},
                {key: 'detail', label: 'Detail', fold: 1, hide: v => (v.detail === '')},
            ];
        },
        // Every row shown, in the order the config lists them
        rows: function () {
            const wanted = this.filter.toLowerCase();
            return this.services_here.filter(v => this.is_shown(v, wanted)).map(v => this.row_of(v));
        },
    },
    methods: {
        logs_url: function (kind, name, remotes) {
            return logline_link(this.state.logline, kind, name, remotes);
        },
        is_shown: function (service, wanted) {
            if ((this.show === 'running') && (service.phase !== 'running')) {
                return false;
            }
            if ((this.show === 'stopped') && (service.phase !== 'stopped')) {
                return false;
            }
            if ((this.show === 'attention') && (this.is_attention(service) === false)) {
                return false;
            }
            if (wanted === '') {
                return true;
            }
            const titles = service.remotes.map(v => this.remote_title(v));
            const words = [service.name, service.title || '', service.type, service.phase, service.image || ''].concat(service.publish.hosts, service.remotes, titles).join(' ').toLowerCase();
            return words.includes(wanted);
        },
        // What wants a look: it broke, it lost its machine, or it gave up restarting
        is_attention: function (service) {
            return (service.phase === 'failed') || (service.phase === 'lost') || (service.gave_up === true) || ((service.error !== null) && (service.phase !== 'running'));
        },
        row_of: function (service) {
            const host = (service.publish.hosts.length === 0) ? '' : service.publish.hosts[0];
            const kind = KINDS[kind_of(service)];
            const away = this.machine_away(service);
            return {
                name: service.name,
                icon: kind.icon,
                what: kind.word,
                machine: this.machine_text(service),
                title: service.title || service.name,
                name_shown: is_name_in_title(service.title, service.name) === false,
                remotes: service.remotes,
                phase: away ? 'failed' : ((service.doing === null) ? service.phase : 'starting'),
                host,
                url: this.url_of(host),
                more: Math.max(0, service.publish.hosts.length - 1),
                // Where its port is brought, for a program with no address of its own
                brought: this.brought_text(service),
                type: service.type,
                state: away ? 'machine offline' : this.state_word(service),
                detail: this.detail_of(service),
                bad: (service.error !== null) && (service.phase !== 'running'),
            };
        },
        // One short line about now: what it is doing, why it broke, or when it goes to sleep
        detail_of: function (service) {
            if (service.doing !== null) {
                return (service.progress_text === null) ? '' : service.progress_text;
            }
            if ((service.error !== null) && (service.phase !== 'running')) {
                return service.error;
            }
            if ((service.phase === 'running') && (service.policy.instances.max > 1)) {
                return `${service.instances_running} of ${service.policy.instances.max} instances`;
            }
            if ((service.phase === 'running') && (service.stop_in_ms !== null)) {
                return `sleeps in ${format_ms(service.stop_in_ms)}`;
            }
            if ((service.phase === 'running') && (service.uptime_ms !== null)) {
                return `up ${format_ms(service.uptime_ms)}`;
            }
            if ((service.phase === 'stopped') && (service.policy.start === 'on_demand')) {
                return 'starts on the first request';
            }
            return '';
        },
        // The machines a program's port is brought to by the forwards that are part of it
        brought_text: function (service) {
            const forwards = (this.state.forwards === undefined) ? [] : this.state.forwards.filter(v => v.service === service.name);
            const titles = forwards.map(v => (v.to.here ? 'this host' : this.remote_title(v.to.remote)));
            return titles.filter((title, index) => titles.indexOf(title) === index).join(', ');
        },
        // How it stands, in the word its kind says it with: a folder of files is served, an
        // address already running answers, one that sleeps until visited is asleep
        state_word: function (service) {
            if (service.doing !== null) {
                return service.doing;
            }
            if (service.phase === 'running') {
                return {files: 'served', external: 'answers'}[service.type] || 'running';
            }
            if ((service.phase === 'stopped') && (service.policy.start === 'on_demand')) {
                return 'asleep';
            }
            return service.phase;
        },
        // The machine it runs on by its title; a tag as written; serviceman for a folder of
        // files, which it serves itself; a dash for an address that runs somewhere else
        machine_text: function (service) {
            if (service.type === 'files') {
                return 'serviceman';
            }
            if (service.remotes.length === 0) {
                return '—';
            }
            const first = service.remotes[0].startsWith('#') ? service.remotes[0] : this.remote_title(service.remotes[0]);
            return (service.remotes.length === 1) ? first : `${first} +${service.remotes.length - 1}`;
        },
        // The one machine it runs on is not linked now: what it says of itself is old
        machine_away: function (service) {
            if (((service.type !== 'docker') && (service.type !== 'shell')) || (service.remotes.length !== 1)) {
                return false;
            }
            const found = this.remotes.find(v => v.name === service.remotes[0]);
            return (found !== undefined) && (found.phase !== 'online');
        },
        remote_title: function (name) {
            const found = this.remotes.find(v => v.name === name);
            return (found === undefined) ? name : (found.title || found.name);
        },
        url_of: function (host) {
            if (host === '') {
                return '';
            }
            const port = (this.state.listen.port === 80) ? '' : `:${this.state.listen.port}`;
            const mark = host.indexOf('/');
            const name = (mark === -1) ? host : host.slice(0, mark);
            const path = (mark === -1) ? '' : host.slice(mark);
            return `http://${name}${port}${path}`;
        },
    },
};

// The kind of a service, a key of KINDS
function kind_of(service)
{
    if (service.type === 'docker') {
        return 'docker';
    }
    if (service.type === 'shell') {
        return (service.app_folder === null) ? 'program' : 'app_folder';
    }
    if (service.type === 'files') {
        return 'files';
    }
    return ((service.socket !== null) && (service.socket !== undefined)) ? 'socket' : 'external';
}

export default services_pane;
