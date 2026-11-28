import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import database_cell from './database_cell.js';
import database_rows from './database_rows.js';

// A machine's Databases tab: the databases on it, a row each as the Databases table draws them,
// and + New database here. A click on a row opens the database's page on Databases.
const remote_databases = {
    template: `
<article id="detail" class="list">
    <p v-if="(error !== '')" class="bad">{{ error }}</p>
    <!-- The kit's table card, as Services on a machine: its title and count, New database here
         at its right end; with none yet, what would be here and how to bring the first up -->
    <data-table :columns="columns" :rows="rows" row_key="key" :row_class="(row => (row.bad ? 'dt-bad' : []))" :on_row="(row => $emit('databases', {page: 'database', server: row.server, database: row.database}))" :marks="false" framed :title="('Databases on ' + (view.title || view.name))" :total="((answer === null) ? null : rows.length)" :empty_icon="DATABASES_ICON" :empty_title="((answer === null) ? '' : 'No database here yet')" :empty="((answer === null) ? 'reading…' : 'New database here brings up a database server on this machine, empty or with a sample, given to your apps by its URL.')">
        <template #head_acts><button type="button" class="link dt-head-act" :disabled="(view.phase !== 'online')" :title="((view.phase === 'online') ? 'A database whose data stays on this machine' : 'Once it is online')" @click="$emit('databases', {page: 'new', remote: view.name})"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database here</button></template>
        <template #cell="{row, column}"><database-cell :row="row" :column="column" @select="$emit('select', $event)"/></template>
        <template #empty_act><button type="button" class="primary" :disabled="(view.phase !== 'online')" @click="$emit('databases', {page: 'new', remote: view.name})"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database here</button></template>
    </data-table>
</article>
`,
    components: {'data-table': data_table, 'database-cell': database_cell},
    props: ['view'],
    emits: ['databases', 'select'],
    data: function () {
        return {DATABASES_ICON: CATEGORIES.find(v => v.key === 'databases').icon, answer: null, error: ''};
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
