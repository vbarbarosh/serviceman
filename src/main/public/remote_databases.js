import data_table from './data_table.js';

// What the engines are called on a row
const ENGINES = {mysql: 'MySQL', postgresql: 'PostgreSQL', couchdb: 'CouchDB'};

// A machine's Databases tab: the database servers serviceman brought up on it, one row each with
// the databases in it as the servers say them now; a click on a row opens Databases, where they
// are made and removed.
const remote_databases = {
    template: `
<article id="detail" class="list">
    <p v-if="(error !== '')" class="bad">{{ error }}</p>
    <data-table :columns="columns" :rows="rows" row_key="name" :on_row="(() => $emit('databases'))" :marks="false" :empty="empty">
        <template #cell="{row, column}">
            <span v-if="(column.key === 'name')" class="row-of">
                <svg class="dt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/></svg>
                <b>{{ row.name }}</b>
            </span>
            <span v-else-if="(column.key === 'engine')">{{ row.engine }}</span>
            <span v-else-if="(column.key === 'databases')" :class="{muted: (row.databases === '')}">{{ (row.databases === '') ? 'none yet' : row.databases }}</span>
            <span v-else-if="(column.key === 'state')" class="dt-state"><span class="dot" :class="row.dot"/>{{ row.phase }}</span>
        </template>
    </data-table>
</article>
`,
    components: {'data-table': data_table},
    props: ['view'],
    emits: ['databases'],
    data: function () {
        return {servers: null, error: ''};
    },
    computed: {
        columns: function () {
            return [
                {key: 'name', label: `Databases on ${this.view.title || this.view.name}`, wraps: true},
                {key: 'engine', label: 'Engine', fold: 2},
                {key: 'databases', label: 'In it', fold: 1, wraps: true},
                {key: 'state', label: 'State'},
            ];
        },
        rows: function () {
            const servers = (this.servers === null) ? [] : this.servers.filter(v => v.remote === this.view.name);
            return servers.map(function (server) {
                return {
                    name: server.name,
                    engine: `${ENGINES[server.engine] || server.engine} ${server.version}`,
                    databases: server.databases.map(v => v.name).join(', '),
                    phase: server.phase,
                    dot: {up: 'running', starting: 'starting', failed: 'failed'}[server.phase] || 'stopped',
                };
            });
        },
        empty: function () {
            return (this.servers === null) ? 'reading…' : 'No database server on this machine: Databases brings one up.';
        },
    },
    methods: {
        load: async function () {
            try {
                const answer = await fetch('/api/v1/databases', {cache: 'no-store'});
                this.servers = (await answer.json()).servers;
            }
            catch (error) {
                this.error = `Its databases could not be read: ${error.message}`;
                this.servers = [];
            }
        },
    },
    created: function () {
        this.load();
    },
};

export default remote_databases;
