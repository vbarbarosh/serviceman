import format_ms from './format_ms.js';
import logline_link from './logline_link.js';

// The front page: every service, one line each, under the machine it runs on. A filter and the
// state chips narrow it; a click on a line opens the rest of it below, and its page from there.
const services_pane = {
    template: `
<article id="detail" class="list">
    <div class="list-head">
        <h1>Services</h1>
        <span class="muted">{{ services.length }}</span>
        <div class="list-acts">
            <button type="button" class="primary" @click="$emit('create')">+ Add service</button>
        </div>
    </div>
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="filter by name, address, image, machine" spellcheck="false">
        <button v-if="(place !== null)" type="button" class="chip on" title="Show the services of every machine again" @click="$emit('only', null)">on {{ place.title }} ×</button>
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
            <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
        <span class="list-right">
            <span class="muted">Group by</span>
            <span class="seg">
                <button type="button" :class="{on: grouped}" @click="grouped = true">Remote</button>
                <button type="button" :class="{on: (grouped === false)}" @click="grouped = false">None</button>
            </span>
        </span>
    </div>
    <ul class="fold-list">
        <template v-for="group of groups" :key="group.key">
            <li v-if="grouped" class="group">
                <span class="row-of">
                    <b :title="group.title">{{ group.title }}</b>
                    <span v-if="(group.phase !== null)" class="dot" :class="group.phase"/>
                    <span class="muted">{{ group.text }}</span>
                    <a v-if="(group.phase !== null && logs_url('remote', group.key) !== null)" class="tag" :href="logs_url('remote', group.key)" target="_blank" rel="noopener" title="This machine's lines in Logline, the last 24 hours">logs ↗</a>
                </span>
            </li>
            <li v-for="row of group.rows" :key="row.name" :class="{open: is_open(row)}">
                <button type="button" class="fold-line" :aria-expanded="is_open(row)" @click="toggle(row)">
                    <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                    <span class="dot" :class="row.phase"/>
                    <b class="name" :title="row.title">{{ row.title }}</b>
                    <span class="route muted" :title="row.hosts.join(' ')">{{ (row.host === '' ? 'no address' : row.host) }}{{ (row.more > 0 ? ' +' + row.more : '') }}</span>
                    <span class="word" :class="{bad: row.bad}" :title="row.detail">{{ row.state }}</span>
                </button>
                <div v-if="is_open(row)" class="fold-details">
                    <dl>
                        <template v-if="(row.title !== row.name)">
                            <dt>Name</dt>
                            <dd><code>{{ row.name }}</code></dd>
                        </template>
                        <dt>Address</dt>
                        <dd v-if="(row.hosts.length === 0)" class="muted">no address</dd>
                        <dd v-else><div v-for="host of row.hosts" :key="host"><a :href="url_of(host)" target="_blank" rel="noopener"><code>{{ host }}</code></a></div></dd>
                        <dt>Kind</dt>
                        <dd>{{ row.type }}<span v-if="(row.image !== null)" class="muted"> · <code>{{ row.image }}</code></span></dd>
                        <dt>Runs on</dt>
                        <dd :class="{muted: (row.machines === '')}">{{ (row.machines === '' ? 'no machine named' : row.machines) }}</dd>
                        <dt>State</dt>
                        <dd :class="{bad: row.bad}">{{ row.state }}</dd>
                        <template v-if="(row.detail !== '')">
                            <dt>Now</dt>
                            <dd :class="(row.bad ? 'bad' : 'muted')">{{ row.detail }}</dd>
                        </template>
                    </dl>
                    <div class="fold-actions">
                        <button type="button" class="link" @click="$emit('select', row.name)">open its page</button>
                        <a v-if="(logs_url('service', row.name) !== null)" :href="logs_url('service', row.name)" target="_blank" rel="noopener" title="This service's lines in Logline, the last 24 hours">logs ↗</a>
                    </div>
                </div>
            </li>
        </template>
        <li v-if="(groups.length === 0)" class="muted empty">{{ services.length === 0 ? 'No services yet. A service is a docker image, a program, or an address serviceman answers for.' : 'Nothing matches.' }}</li>
    </ul>
</article>
`,
    // remote: the one machine the list is narrowed to, or null for all of them
    props: ['state', 'remote'],
    emits: ['create', 'only', 'select'],
    data: function () {
        // `opened` is the services whose details are shown, by name
        return {filter: '', show: 'all', grouped: true, opened: {}};
    },
    computed: {
        services: function () {
            return ((this.state === null) ? [] : this.state.services);
        },
        remotes: function () {
            return ((this.state === null) ? [] : this.state.remotes);
        },
        place: function () {
            const found = this.remotes.find(v => v.name === this.remote);
            return ((found === undefined) ? null : {name: found.name, title: (found.title || found.name), tags: found.tags});
        },
        // What the machine carries — by its name, or by a #tag it has — the way its card counts it
        services_here: function () {
            const place = this.place;
            if (place === null) {
                return this.services;
            }
            return this.services.filter(v => v.remotes.some(vv => (vv.startsWith('#') ? place.tags.includes(vv.slice(1)) : vv === place.name)));
        },
        chips: function () {
            const services = this.services_here;
            return [
                {value: 'all', label: 'All', phase: null, count: services.length},
                {value: 'running', label: 'Running', phase: 'running', count: services.filter(v => v.phase === 'running').length},
                {value: 'stopped', label: 'Stopped', phase: 'stopped', count: services.filter(v => v.phase === 'stopped').length},
                {value: 'attention', label: 'Needs attention', phase: 'failed', count: services.filter(v => this.is_attention(v)).length},
            ];
        },
        // One group per machine, in the order the config lists the machines; a service that
        // names a tag or nothing at all gets a group of its own after them
        groups: function () {
            const out = [];
            const group_by_key = {};
            for (const remote of this.remotes) {
                const phase = ((remote.phase === 'online') ? 'running' : 'failed');
                const text = ((remote.phase === 'online') ? `online · ${(remote.latency_ms === null) ? '…' : `${remote.latency_ms}ms`}` : 'offline');
                group_by_key[remote.name] = {key: remote.name, title: (remote.title || remote.name), phase, text, rows: []};
            }
            const wanted = this.filter.toLowerCase();
            for (const service of this.services_here) {
                if (this.is_shown(service, wanted) === false) {
                    continue;
                }
                const key = (this.grouped ? (service.remotes[0] || '') : 'all');
                if (group_by_key[key] === undefined) {
                    const title = ((key === '') ? 'Runs somewhere else' : `Machines tagged ${key}`);
                    group_by_key[key] = {key, title, phase: null, text: '', rows: []};
                }
                group_by_key[key].rows.push(this.row_of(service));
            }
            for (const key of Object.keys(group_by_key)) {
                const group = group_by_key[key];
                if (group.rows.length === 0) {
                    continue;
                }
                if (group.text === '') {
                    group.text = `${group.rows.length} ${(group.rows.length === 1) ? 'service' : 'services'}`;
                }
                else {
                    group.text += ` · ${group.rows.length} ${(group.rows.length === 1) ? 'service' : 'services'}`;
                }
                out.push(group);
            }
            return out;
        },
    },
    methods: {
        is_open: function (row) {
            return (this.opened[row.name] === true);
        },
        toggle: function (row) {
            this.opened = Object.assign({}, this.opened, {[row.name]: (this.is_open(row) === false)});
        },
        logs_url: function (kind, name) {
            return logline_link(this.state.logline, kind, name);
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
            const host = ((service.publish.hosts.length === 0) ? '' : service.publish.hosts[0]);
            return {
                name: service.name,
                title: (service.title || service.name),
                phase: ((service.doing === null) ? service.phase : 'starting'),
                host,
                hosts: service.publish.hosts,
                more: Math.max(0, service.publish.hosts.length - 1),
                type: service.type,
                image: (service.image || null),
                machines: service.remotes.map(v => (v.startsWith('#') ? `machines tagged ${v.slice(1)}` : this.remote_title(v))).join(', '),
                state: ((service.doing === null) ? service.phase : service.doing),
                detail: this.detail_of(service),
                bad: ((service.error !== null) && (service.phase !== 'running')),
            };
        },
        // One short line about now: what it is doing, why it broke, or when it goes to sleep
        detail_of: function (service) {
            if (service.doing !== null) {
                return ((service.progress_text === null) ? '' : service.progress_text);
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
        remote_title: function (name) {
            const found = this.remotes.find(v => v.name === name);
            return ((found === undefined) ? name : (found.title || found.name));
        },
        url_of: function (host) {
            if (host === '') {
                return '';
            }
            const port = ((this.state.listen.port === 80) ? '' : `:${this.state.listen.port}`);
            const mark = host.indexOf('/');
            const name = ((mark === -1) ? host : host.slice(0, mark));
            const path = ((mark === -1) ? '' : host.slice(mark));
            return `http://${name}${port}${path}`;
        },
    },
};

export default services_pane;
