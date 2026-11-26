import data_table from './data_table.js';
import database_cell from './database_cell.js';
import database_rows from './database_rows.js';

// A machine's Databases tab: the databases on it, a row each as the Databases table draws them,
// and + New database here. A click on a row opens the database's page on Databases.
const remote_databases = {
    template: `
<article id="detail" class="list">
    <div class="list-head">
        <h2>Databases on {{ view.title || view.name }}</h2>
        <span class="muted">{{ count }}</span>
        <div class="list-acts">
            <button type="button" class="primary add" :disabled="(view.phase !== 'online')" :title="((view.phase === 'online') ? 'A database whose data stays on this machine' : 'Once it is online')" @click="$emit('databases', {page: 'new', remote: view.name})"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database here</button>
        </div>
    </div>
    <p v-if="(error !== '')" class="bad">{{ error }}</p>
    <data-table :columns="columns" :rows="rows" row_key="key" :on_row="(row => $emit('databases', {page: 'database', server: row.server, database: row.database}))" :marks="false" :empty="empty">
        <template #cell="{row, column}"><database-cell :row="row" :column="column" @select="$emit('select', $event)"/></template>
    </data-table>
</article>
`,
    components: {'data-table': data_table, 'database-cell': database_cell},
    props: ['view'],
    emits: ['databases', 'select'],
    data: function () {
        return {answer: null, error: ''};
    },
    computed: {
        columns: function () {
            return [
                {key: 'name', label: 'Name', wraps: true},
                {key: 'engine', label: 'Engine', fold: 3},
                {key: 'size', label: 'Size', align: 'right', fold: 2},
                {key: 'apps', label: 'Given to', wraps: true, fold: 4},
                {key: 'state', label: 'Status'},
                {key: 'detail', label: 'Detail', fold: 1, hide: v => (v.detail === '')},
            ];
        },
        rows: function () {
            if (this.answer === null) {
                return [];
            }
            return database_rows(this.answer.servers.filter(v => v.remote === this.view.name), this.answer.engines);
        },
        count: function () {
            return (this.answer === null) ? '' : String(this.rows.filter(v => v.database !== '').length);
        },
        empty: function () {
            return (this.answer === null) ? 'reading…' : 'No database on this machine yet: + New database here brings one up.';
        },
    },
    methods: {
        load: async function () {
            try {
                const answer = await fetch('/api/v1/databases', {cache: 'no-store'});
                this.answer = await answer.json();
            }
            catch (error) {
                this.error = `Its databases could not be read: ${error.message}`;
                this.answer = {servers: [], engines: []};
            }
        },
    },
    created: function () {
        this.load();
    },
};

export default remote_databases;
