import CATEGORIES from './categories.js';
import clock_of from './clock_of.js';
import data_table from './data_table.js';
import format_ms from './format_ms.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import service_kind from './service_kind.js';
import service_state_word from './service_state_word.js';
import state_pill from './state_pill.js';

// Every service, one row each, in the kit's table card: its name over its title or what is
// wrong, its kind, its machine, its address, its state as a pill. The find box and the state
// chips narrow it; a click on a row opens the service.
const services_pane = {
    template: `
<component :is="(embedded ? 'div' : 'article')" :id="(embedded ? null : 'detail')" :class="(embedded ? 'item-list' : 'list')">
    <template v-if="(embedded === false)">
    <page-head category="services" :count="services.length">
        <template #acts><button type="button" class="primary" @click="$emit('create')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New service</button></template>
    </page-head>
    </template>
    <data-table :columns="columns" :rows="rows" row_key="name" :row_class="(row => ((row.tone === '') ? [] : ('dt-' + row.tone)))" :on_row="(row => $emit('select', row.name))" :marks="false" framed :title="(embedded ? ('Services on ' + remote) : '')" :total="services_here.length" :foot="foot" :empty_icon="SERVICES_ICON" :empty_title="(embedded ? 'No service runs here yet' : 'No services yet')" :empty="(embedded ? 'Service here puts one on this machine: a docker image, an app folder or a program.' : 'A service is something serviceman runs and answers for: a docker image, an app folder, a program, a folder of files, or an address that already runs.')">
        <template v-if="embedded" #head_acts><button type="button" class="link dt-head-act" @click="$emit('create')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Service here</button></template>
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a service" aria-label="Find a service by its name, address, image or machine" spellcheck="false">
            <span class="dt-chips">
                <button v-if="((place !== null) && (embedded === false))" type="button" class="chip on" title="Show the services of every machine again" @click="$emit('only', null)">on {{ place.title }} ×</button>
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #empty_act><button type="button" class="primary" @click="$emit('create')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>{{ embedded ? 'Service here' : 'New service' }}</button></template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="row.icon" :name="row.name" :line="row.line" :tone="row.tone"/>
            <template v-else-if="(column.key === 'what')">{{ row.what }}</template>
            <span v-else-if="(column.key === 'machine')" :class="{muted: (row.machine === '—')}">{{ row.machine }}</span>
            <template v-else-if="(column.key === 'address')">
                <a v-if="(row.host !== '')" class="dt-address" :href="row.url" target="_blank" rel="noopener">{{ row.host }}</a>
                <span v-else-if="(row.brought !== '')" class="muted" title="Its port, brought to these machines">→ {{ row.brought }}</span>
                <span v-else class="muted">no address</span>
                <span v-if="(row.more > 0)" class="tag">+{{ row.more }}</span>
            </template>
            <state-pill v-else-if="(column.key === 'state')" :tone="row.pill" :text="row.state"/>
        </template>
    </data-table>
</component>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, 'state-pill': state_pill},
    // remote: the one machine the list is narrowed to, or null for all of them; embedded: the
    // table card alone, on that machine's page, titled with it and with Service here in its band
    props: {
        state: {type: Object, default: null},
        remote: {type: String, default: null},
        embedded: {type: Boolean, default: false},
    },
    emits: ['create', 'only', 'select'],
    data: function () {
        return {filter: '', show: 'all', SERVICES_ICON: CATEGORIES.find(v => v.key === 'services').icon};
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
        // The table's columns, each that may fold with when, the address last; on a phone the
        // kind and the machine share a line, the address one of its own
        columns: function () {
            // On a machine's own page, every row is on it: no Machine column
            return [
                {key: 'name', label: 'Name'},
                {key: 'what', label: 'What', fold: 1},
                {key: 'machine', label: 'Machine', fold: 2},
                {key: 'address', label: 'Address', fold: 3, phone: 'row'},
                {key: 'state', label: 'State', phone: 'state'},
            ].filter(v => (this.embedded === false) || (v.key !== 'machine'));
        },
        // The footer: how many, how many run, sleep, and need a look, of the machine's or all
        foot: function () {
            const services = this.services_here;
            const out = [{text: `${services.length} ${(services.length === 1) ? 'service' : 'services'}`, tone: ''}];
            const running = services.filter(v => v.phase === 'running').length;
            const asleep = services.filter(v => v.phase === 'stopped').length;
            const attention = services.filter(v => this.is_attention(v)).length;
            if (running > 0) {
                out.push({text: `${running} running`, tone: ''});
            }
            if (asleep > 0) {
                out.push({text: `${asleep} asleep`, tone: ''});
            }
            if (attention > 0) {
                out.push({text: `${attention} ${(attention === 1) ? 'needs' : 'need'} you`, tone: 'bad'});
            }
            return out;
        },
        // Every row shown, in the order the config lists them
        rows: function () {
            const wanted = this.filter.toLowerCase();
            return this.services_here.filter(v => this.is_shown(v, wanted)).map(v => this.row_of(v));
        },
    },
    methods: {
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
        // What wants a look: it broke, it lost its machine or its machine is offline, or it gave
        // up restarting
        is_attention: function (service) {
            return (service.phase === 'failed') || (service.phase === 'lost') || (service.gave_up === true) || ((service.error !== null) && (service.phase !== 'running')) || this.machine_away(service);
        },
        row_of: function (service) {
            const host = (service.publish.hosts.length === 0) ? '' : service.publish.hosts[0];
            const kind = service_kind(service);
            const away = this.machine_away(service);
            const tone = this.is_attention(service) ? 'bad' : ((service.doing !== null) ? 'warn' : '');
            return {
                name: service.name,
                icon: kind.icon,
                what: kind.word,
                machine: this.machine_text(service),
                tone,
                line: this.line_of(service, tone, away),
                pill: {bad: 'bad', warn: 'busy'}[tone] || ((service.phase === 'running') ? 'run' : 'idle'),
                host,
                url: this.url_of(host),
                more: Math.max(0, service.publish.hosts.length - 1),
                // Where its port is brought, for a program with no address of its own
                brought: this.brought_text(service),
                type: service.type,
                state: away ? 'machine offline' : service_state_word(service),
            };
        },
        // The line under the name: what is wrong, red; what it is doing, orange; else its title,
        // or one short line about now when it has none
        line_of: function (service, tone, away) {
            if (away) {
                const remote = this.remotes.find(v => v.name === service.remotes[0]);
                return ((remote.left_at === null) || (remote.left_at === undefined)) ? 'machine offline' : `machine offline since ${clock_of(remote.left_at)}`;
            }
            if (tone === 'bad') {
                return (service.error === null) ? service_state_word(service) : service.error;
            }
            if ((tone === 'warn') && (service.progress_text !== null) && (service.progress_text !== '')) {
                return service.progress_text;
            }
            if ((service.title !== '') && (service.title !== null) && (service.title !== service.name)) {
                return service.title;
            }
            return this.detail_of(service);
        },
        // One short line about now: how many run, or when it goes to sleep
        detail_of: function (service) {
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

export default services_pane;
