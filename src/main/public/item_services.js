import data_table from './data_table.js';
import service_kind from './service_kind.js';
import service_state_word from './service_state_word.js';

// The services an item carries, one table: on a machine's Overview under its numbers, and the
// whole of its Services tab. A click on a row opens the service.
const item_services = {
    template: `
<data-table class="item-services" :columns="columns" :rows="rows" row_key="name" :on_row="(row => $emit('select', row.service))" :marks="false" :empty="empty">
    <template #cell="{row, column}">
        <span v-if="(column.key === 'name')" class="row-of">
            <svg class="dt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/>
            <button type="button" class="link" title="The service's page" @click="$emit('select', row.service)"><b>{{ row.title }}</b></button>
        </span>
        <span v-else-if="(column.key === 'what')">{{ row.what }}</span>
        <template v-else-if="(column.key === 'address')">
            <a v-if="(row.url !== '')" :href="row.url" target="_blank" rel="noopener"><code>{{ row.host }}</code></a>
            <span v-else class="muted">no address</span>
        </template>
        <span v-else-if="(column.key === 'state')" class="dt-state"><span class="dot" :class="row.phase"/>{{ row.state }}</span>
    </template>
</data-table>
`,
    components: {'data-table': data_table},
    // services: the ones it carries; port: the port serviceman answers on, for their links;
    // title: what the first column is headed with, "Services on vps1"
    props: {
        services: {type: Array, required: true},
        port: {type: Number, required: true},
        title: {type: String, default: 'Name'},
    },
    emits: ['select'],
    computed: {
        columns: function () {
            return [
                {key: 'name', label: this.title, wraps: true},
                {key: 'what', label: 'What', fold: 1},
                {key: 'address', label: 'Address', fold: 2},
                {key: 'state', label: 'State'},
            ];
        },
        rows: function () {
            const port = (this.port === 80) ? '' : `:${this.port}`;
            return this.services.map(function (service) {
                const host = (service.publish.hosts.length === 0) ? '' : service.publish.hosts[0];
                const kind = service_kind(service);
                return {
                    name: service.name,
                    service,
                    icon: kind.icon,
                    what: kind.word,
                    title: service.title || service.name,
                    host,
                    url: (host === '') ? '' : `http://${host.replace(/\/.*$/, '')}${port}${host.includes('/') ? host.slice(host.indexOf('/')) : ''}`,
                    phase: (service.doing === null) ? service.phase : 'starting',
                    state: service_state_word(service),
                };
            });
        },
        empty: function () {
            return 'No service runs here yet: + Service here puts one on it.';
        },
    },
};

export default item_services;
