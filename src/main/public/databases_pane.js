import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import database_cell from './database_cell.js';
import database_new from './database_new.js';
import database_rows from './database_rows.js';
import database_state from './database_state.js';
import forward_state from './forward_state.js';
import item_facts from './item_facts.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import state_pill from './state_pill.js';
import to_clipboard from './to_clipboard.js';

// How often an open pane asks how the servers stand: one coming up says each step within seconds
const REFRESH_MS = 3000;
// What a database's tables are called in its head, where an engine has none
const TABLES_WORDS = {couchdb: 'Users', mongodb: 'Collections'};

// Databases: every database on the machines, a row each, in one table: its engine, its machine,
// its size, the apps given it, how it stands. Each lives in a database server serviceman runs
// there, a container always up, its data in a folder kept for it there; a server with no
// database yet, coming up or failed is a row of its own. + New database opens New database; a row
// opens the database's page. An app finds one given it in DATABASE_URL at every start (a
// CouchDB in COUCHDB_URL, a MongoDB in MONGODB_URL), and the passwords stay with serviceman: the
// page sees names, sizes and who uses what, and a database's URL, its password in it, only
// when Copy URL asks for it, straight onto the clipboard.
const databases_pane = {
    template: `
<article id="detail" class="list databases" :class="{form: (place_now.page === 'new')}">
    <p v-if="(view === null)" class="muted"><span v-if="(load_error === '')" class="spin"/>{{ (load_error === '') ? 'reading…' : load_error }}</p>
    <database-new v-else-if="(place_now.page === 'new')" :view="view" :restore="(place_now.restore || null)" :given="(place_now.given || [])" :remote="(place_now.remote || '')" @close="$emit('place', null)" @made="made" @machine="$emit('machine', $event)"/>
    <template v-else-if="(place_now.page === 'database')">
        <div class="item-head">
            <svg class="item-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" :stroke="colour_of(open_server)" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/>
            <h1>{{ open_title }}</h1>
            <span class="pill" :class="state_of(open_server).pill"><span class="dot" :class="state_of(open_server).dot"/>{{ state_of(open_server).word }}</span>
            <span class="tag">{{ engine_text(open_server) }}</span>
            <span class="muted">in {{ open_server.name }} on {{ open_server.title }}</span>
            <item-facts :facts="open_facts"/>
            <div class="acts crumb-acts">
                <button v-if="(open_server.phase === 'failed')" type="button" :disabled="(busy || (open_server.online === false))" :title="(open_server.online ? 'Again where it was, with the password its data was made with' : (open_server.title + ' is offline'))" @click="again(open_server)">Bring it up again</button>
                <button type="button" :disabled="((removing !== null) || (open_server.phase === 'removing'))" @click="remove_begin(open_server)">Remove…</button>
            </div>
        </div>
        <p v-if="(state_of(open_server).detail !== '')" :class="(state_of(open_server).bad ? 'bad' : 'muted')"><span v-if="(open_server.phase === 'starting')" class="spin"/>{{ state_of(open_server).detail }}</p>
        <div v-if="(removing !== null)" class="card db-card">
            <p>Removing <b>{{ open_title }}</b> removes its server, <b>{{ open_server.name }}</b>: its container on {{ open_server.title }} stops, and every database in it goes, its folder there too{{ (others.length === 0) ? '' : (': ' + others.map(v => v.name).join(', ') + ' as well') }}. {{ used_text(open_server) }}Type its server's name to go on:</p>
            <div class="row-of">
                <input ref="remove_name" v-model.trim="removing.typed" :placeholder="open_server.name" spellcheck="false" autocomplete="off" aria-label="The server's name, typed again" @keydown.enter="remove_save">
                <button type="button" class="danger" :disabled="((removing.typed !== open_server.name) || busy)" @click="remove_save">Remove {{ open_server.name }}</button>
                <button type="button" :disabled="busy" @click="removing = null">Cancel</button>
            </div>
        </div>
        <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
        <h2 class="db-sub">Given to</h2>
        <data-table :columns="app_columns" :rows="open_apps" row_key="name" :on_row="(row => $emit('select', row.name))" :marks="false" :empty="open_apps_empty">
            <template #cell="{row, column}">
                <button v-if="(column.key === 'name')" type="button" class="link" @click="$emit('select', row.name)"><b>{{ row.name }}</b></button>
                <code v-else-if="(column.key === 'env')">{{ row.env }}</code>
            </template>
        </data-table>
        <h2 class="db-sub">Reached from</h2>
        <div class="db-fwds">
            <div v-if="(open_server.port !== null)" class="db-fwd">
                <b>{{ open_server.title }}</b>
                <code>127.0.0.1:{{ open_server.port }}</code>
                <span class="muted">its own machine</span>
                <span class="db-fwd-acts">
                    <button type="button" :disabled="(copy_why(open_server.remote, null) !== '')" :title="copy_title(open_server.remote, open_server.port, null)" @click="url_copy(open_server.remote)">{{ ((copied === open_server.remote) ? 'Copied' : 'Copy URL') }}</button>
                </span>
            </div>
            <div v-for="item of open_server.forwards" :key="item.label" class="db-fwd">
                <b>{{ machine_title(item.to.remote) }}</b>
                <code>{{ end_text(item.to) }}</code>
                <forward-state :forward="item" :remotes="remotes_named" :reason="true"/>
                <span v-if="(item.apps.length > 0)" class="muted">{{ item.apps.join(', ') }} {{ (item.apps.length === 1) ? 'finds' : 'find' }} it here</span>
                <span class="db-fwd-acts">
                    <button v-if="(item.to.socket === null)" type="button" :disabled="(copy_why(item.to.remote, item) !== '')" :title="copy_title(item.to.remote, item.to.port, item)" @click="url_copy(item.to.remote)">{{ ((copied === item.to.remote) ? 'Copied' : 'Copy URL') }}</button>
                    <button type="button" class="line-x" :disabled="busy" :title="drop_title(item)" :aria-label="('Bring it to ' + machine_title(item.to.remote) + ' no more')" @click="forward_drop(item)">×</button>
                </span>
            </div>
            <div v-if="(adding !== null)" class="db-fwd db-fwd-new">
                <select ref="adding_remote" v-model="adding.remote" aria-label="The machine it shows up on">
                    <option value="" disabled>a machine</option>
                    <option v-for="item of forward_machines" :key="item.remote" :value="item.remote">{{ item.title }}{{ item.online ? '' : ' · offline' }}</option>
                </select>
                <span class="db-fwd-at"><span class="muted">127.0.0.1:</span><input v-model.trim="adding.port" :placeholder="String(engine_port)" inputmode="numeric" spellcheck="false" autocomplete="off" aria-label="The port there" @keydown.enter.prevent="forward_save"></span>
                <span class="db-fwd-acts">
                    <button type="button" class="primary" :disabled="(busy || (adding.remote === ''))" @click="forward_save">Save</button>
                    <button type="button" :disabled="busy" @click="forward_cancel">Cancel</button>
                </span>
            </div>
            <p v-if="(forward_note !== '')" class="bad">{{ forward_note }}</p>
            <p v-if="((open_server.forwards.length === 0) && (adding === null))" class="muted">Reached on {{ open_server.title }} alone. On a machine picked here its port shows up at that machine's 127.0.0.1 too, as <code>ssh -L</code> brings one, with no ssh: the agents carry it, and a program there picks it in its Data tab. Nothing opens to the internet.</p>
            <button v-if="(adding === null)" type="button" class="db-fwd-add" :disabled="(busy || (open_server.phase !== 'up') || (forward_machines.length === 0))" :title="forward_add_title" @click="forward_add">{{ (open_server.forwards.length === 0) ? '+ a machine' : '+ another machine' }}</button>
        </div>
        <template v-if="(others.length > 0)">
            <h2 class="db-sub">Beside it in {{ open_server.name }}</h2>
            <data-table :columns="columns" :rows="other_rows" row_key="key" :on_row="row_open" :marks="false" empty="">
                <template #cell="{row, column}"><table-cell :row="row" :column="column" @select="$emit('select', $event)"/></template>
            </data-table>
        </template>
    </template>
    <template v-else>
        <page-head category="databases" :count="databases_count">
            <template #acts>
                <button type="button" class="primary" @click="$emit('place', {page: 'new'})"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database</button>
            </template>
        </page-head>
        <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
        <data-table :columns="columns" :rows="rows_shown" row_key="key" :row_class="(row => (row.bad ? 'dt-bad' : []))" :on_row="row_open" :marks="false" framed :total="rows.length" :foot="foot" :empty_icon="DATABASES_ICON" empty_title="No databases yet" empty="A database server on a machine of yours, empty or with a sample, given to your apps by its URL.">
            <template #tools>
                <input v-model.trim="filter" type="search" placeholder="Find a database" aria-label="Find a database by its name, engine, machine or app" spellcheck="false">
                <span class="dt-chips">
                    <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                        <span v-if="(chip.dot !== null)" class="dot" :class="chip.dot"/>
                        {{ chip.label }}
                        <span class="muted">{{ chip.count }}</span>
                    </button>
                </span>
            </template>
            <template #empty_act><button type="button" class="primary" @click="$emit('place', {page: 'new'})"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New database</button></template>
            <template #cell="{row, column}">
                <name-cell v-if="(column.key === 'name')" :icon="row.icon" :name="row.name" :line="(row.bad ? row.detail : row.aside)" :tone="(row.bad ? 'bad' : '')"/>
                <state-pill v-else-if="(column.key === 'state')" :tone="({running: 'run', failed: 'bad', starting: 'busy', stopping: 'busy'}[row.dot] || 'idle')" :text="row.state"/>
                <table-cell v-else :row="row" :column="column" @select="$emit('select', $event)"/>
            </template>
        </data-table>
    </template>
</article>
`,
    components: {
        'data-table': data_table,
        'database-new': database_new,
        'forward-state': forward_state,
        'item-facts': item_facts,
        'name-cell': name_cell,
        'page-head': page_head,
        'state-pill': state_pill,
        'table-cell': database_cell,
    },
    // place: what is open, null for the table; {page: 'new', restore, given, remote} for New
    // database; {page: 'database', server, database} for a database's page, database '' for a
    // server with none
    props: {
        place: {type: Object, default: null},
    },
    emits: ['changed', 'machine', 'place', 'select'],
    data: function () {
        // removing: Remove's typed confirmation on a database's page; adding: a machine its port
        // is brought to, being picked, {remote, port}, and forward_note what a write of them, or
        // a Copy URL, said; copied: the machine whose URL Copy URL put on the clipboard last
        return {DATABASE_ICON: database_rows.DATABASE_ICON, DATABASES_ICON: CATEGORIES.find(v => v.key === 'databases').icon, view: null, load_error: '', filter: '', show: 'all', removing: null, adding: null, forward_note: '', copied: '', busy: false, note: '', bad: false, timer: null};
    },
    computed: {
        // The page open: a database that is not there any more shows the table
        place_now: function () {
            if ((this.place === null) || (this.view === null)) {
                return {page: 'list'};
            }
            if ((this.place.page === 'database') && (this.open_server === null)) {
                return {page: 'list'};
            }
            return this.place;
        },
        servers: function () {
            return (this.view === null) ? [] : this.view.servers;
        },
        // A row per database, and one for each server with none to show
        rows: function () {
            return database_rows(this.servers, this.view.engines);
        },
        rows_shown: function () {
            const words = this.filter.toLowerCase().split(/\s+/).filter(v => v !== '');
            const show = this.show;
            return this.rows.filter(function (row) {
                if ((show === 'running') && (row.dot !== 'running')) {
                    return false;
                }
                if ((show === 'needs') && (row.bad === false)) {
                    return false;
                }
                const text = [row.name, row.server, row.engine, row.machine].concat(row.apps).join(' ').toLowerCase();
                return words.every(v => text.includes(v));
            });
        },
        chips: function () {
            return [
                {value: 'all', label: 'All', dot: null, count: this.rows.length},
                {value: 'running', label: 'Running', dot: 'running', count: this.rows.filter(v => v.dot === 'running').length},
                {value: 'needs', label: 'Needs you', dot: 'failed', count: this.rows.filter(v => v.bad).length},
            ];
        },
        databases_count: function () {
            return (this.view === null) ? '' : String(this.rows.filter(v => v.database !== '').length);
        },
        // The name over what is wrong or what it is, its engine, machine, size, the apps it is
        // given to, its state; on a phone the engine and the machine share a line, the apps one
        // of their own
        columns: function () {
            return [
                {key: 'name', label: 'Name'},
                {key: 'engine', label: 'Engine', fold: 4},
                {key: 'machine', label: 'Remote', fold: 3},
                {key: 'size', label: 'Size', align: 'right', fold: 2, phone: 'hide'},
                {key: 'apps', label: 'Given to', wraps: true, fold: 5, phone: 'row'},
                {key: 'state', label: 'Status', phone: 'state'},
            ];
        },
        // The footer: how many, how many run, how many need a look
        foot: function () {
            const running = this.rows.filter(v => v.dot === 'running').length;
            const bad = this.rows.filter(v => v.bad).length;
            const out = [{text: `${this.rows.length} ${(this.rows.length === 1) ? 'database' : 'databases'}`, tone: ''}, {text: `${running} running`, tone: ''}];
            if (bad > 0) {
                out.push({text: `${bad} ${(bad === 1) ? 'needs' : 'need'} you`, tone: 'bad'});
            }
            return out;
        },
        open_server: function () {
            if ((this.place === null) || (this.place.page !== 'database')) {
                return null;
            }
            return this.servers.find(v => v.name === this.place.server) || null;
        },
        open_database: function () {
            if (this.open_server === null) {
                return null;
            }
            return this.open_server.databases.find(v => v.name === this.place.database) || null;
        },
        open_title: function () {
            return (this.open_database === null) ? this.open_server.name : this.open_database.name;
        },
        // The databases beside it in its server, which its Remove takes too
        others: function () {
            return this.open_server.databases.filter(v => v !== this.open_database);
        },
        other_rows: function () {
            return this.rows.filter(v => (v.server === this.open_server.name) && (v.database !== '') && (v.database !== this.place.database));
        },
        // What its tiles said, in its head: its size, its tables (a CouchDB's users, a MongoDB's
        // collections), and where it is reached from; its server is named in the line beside its
        // engine
        open_facts: function () {
            const server = this.open_server;
            const database = this.open_database;
            const couch = (server.engine === 'couchdb');
            const out = [];
            out.push({label: 'Size', value: (database === null) ? '—' : database_rows.size(database.bytes), small: '', share: null, title: (database === null) ? 'no database in it' : `its data, on ${server.title}`});
            out.push({label: TABLES_WORDS[server.engine] || 'Tables', value: (database === null) ? '—' : String(database.tables), small: '', share: null, title: (database === null) ? '' : (couch ? 'a database each, made by the app' : 'as its server says them')});
            // Short, as a phone has room for: the machines by name in its title and its card
            const others = [...new Set(server.forwards.map(v => this.machine_title(v.to.remote)))];
            const reached = (others.length === 0) ? 'nothing outside it' : `and on ${others.join(', ')} through its forwards; nothing outside them`;
            out.push({label: 'Reached from', value: (others.length === 0) ? 'its machine' : `${others.length + 1} machines`, small: (server.port === null) ? '' : `127.0.0.1:${server.port}`, share: null, mono: true, title: (server.port === null) ? reached : `127.0.0.1:${server.port} on ${server.title}, ${reached}`});
            return out;
        },
        open_apps: function () {
            if (this.open_database === null) {
                return [];
            }
            const envs = this.open_database.envs;
            return this.open_database.apps.map(v => ({name: v, env: envs[v]}));
        },
        open_apps_empty: function () {
            const server = this.open_server;
            if ((this.open_database === null) && (server.phase === 'failed')) {
                return 'No database: it did not come up. Bring it up again once what it says is fixed.';
            }
            if ((this.open_database === null) && (server.phase === 'starting')) {
                return 'Its databases show once it is up.';
            }
            if ((this.open_database === null) && (server.online === false)) {
                return `Its databases show once ${server.title} is back.`;
            }
            if (this.open_database === null) {
                return 'No database in it yet: New database makes one in it.';
            }
            if (this.open_database.user === null) {
                return 'No app can be given it: it was made outside serviceman, with no user of its own.';
            }
            return 'No app yet: an app is given it in its Data tab, on Apps.';
        },
        // The machines by name and title, as a forward's state names them
        remotes_named: function () {
            return this.view.machines.map(v => ({name: v.remote, title: v.title}));
        },
        // The machines its port may be brought to: every one but its own, where it is already
        forward_machines: function () {
            return this.view.machines.filter(v => v.remote !== this.open_server.remote);
        },
        forward_add_title: function () {
            if (this.open_server.phase !== 'up') {
                return 'Once it is up';
            }
            return (this.forward_machines.length === 0) ? 'It is on the only machine: add another on Remotes' : 'Its port at another machine\'s 127.0.0.1 too';
        },
        // Where it is reached at on its machine, the port it shows up at on others by default
        engine_port: function () {
            const engine = this.view.engines.find(v => v.value === this.open_server.engine);
            return (engine === undefined) ? '' : engine.port;
        },
        app_columns: function () {
            return [
                {key: 'name', label: 'App'},
                {key: 'env', label: 'Finds it in'},
            ];
        },
    },
    watch: {
        place: function () {
            this.removing = null;
            this.adding = null;
            this.forward_note = '';
            this.copied = '';
            this.note = '';
        },
    },
    mounted: function () {
        this.read();
        this.timer = setInterval(this.read, REFRESH_MS);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
    methods: {
        read: async function () {
            try {
                const answer = await fetch('/api/v1/databases', {cache: 'no-store'});
                if (answer.ok === false) {
                    throw new Error(`the databases could not be read: ${answer.status}`);
                }
                this.view = await answer.json();
                this.load_error = '';
            }
            catch (error) {
                this.load_error = error.message;
            }
        },
        row_open: function (row) {
            this.$emit('place', {page: 'database', server: row.server, database: row.database});
        },
        // Made: its page, and what was made said on it
        made: async function (made) {
            await this.read();
            this.$emit('changed');
            this.$emit('place', {page: 'database', server: made.server, database: made.database});
            await this.$nextTick();
            this.note = `${made.database} is made in ${made.server}${(made.given.length === 0) ? '' : `, given to ${made.given.join(', ')} from its next start`}.`;
            this.bad = false;
        },
        // A server that failed, brought up again where it was: its volume keeps the data it
        // had, and serviceman the password that data was made with
        again: async function (server) {
            this.busy = true;
            this.note = '';
            try {
                const answer = await fetch('/api/v1/databases', {method: 'POST', body: JSON.stringify({name: server.name, engine: server.engine, version: server.version, remote: server.remote, sample: server.sample})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                await this.read();
            }
            catch (error) {
                this.note = error.message;
                this.bad = true;
            }
            finally {
                this.busy = false;
            }
        },
        remove_begin: function (server) {
            this.removing = {server: server.name, typed: ''};
            this.$nextTick(() => this.$refs.remove_name.focus());
        },
        remove_save: async function () {
            if ((this.removing.typed !== this.removing.server) || this.busy) {
                return;
            }
            const name = this.removing.server;
            this.busy = true;
            this.note = '';
            try {
                const answer = await fetch(`/api/v1/databases/${encodeURIComponent(name)}`, {method: 'DELETE'});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                this.removing = null;
                await this.read();
                this.$emit('changed');
                this.$emit('place', null);
                await this.$nextTick();
                this.note = `${name} is removed.`;
                this.bad = false;
            }
            catch (error) {
                this.note = error.message;
                this.bad = true;
            }
            finally {
                this.busy = false;
            }
        },
        forward_add: function () {
            const first = this.forward_machines.find(v => this.open_server.forwards.some(vv => vv.to.remote === v.remote) === false);
            this.adding = {remote: (first === undefined) ? '' : first.remote, port: ''};
            this.forward_note = '';
            this.$nextTick(() => this.$refs.adding_remote.focus());
        },
        forward_cancel: function () {
            this.adding = null;
            this.forward_note = '';
        },
        // The forwards it has, and one more where it was picked, the port its engine listens on
        // when none is typed
        forward_save: async function () {
            if ((this.adding === null) || (this.adding.remote === '') || this.busy) {
                return;
            }
            const port = (this.adding.port === '') ? String(this.engine_port) : this.adding.port;
            if ((/^\d{1,5}$/.test(port) === false) || (Number(port) < 1) || (Number(port) > 65535)) {
                this.forward_note = 'A port is a number from 1 to 65535';
                return;
            }
            const ends = this.open_server.forwards.map(v => end_of(v.to)).concat([{remote: this.adding.remote, port: Number(port)}]);
            if (await this.forwards_write(ends)) {
                this.adding = null;
            }
        },
        // Why Copy URL cannot give the URL a program on that machine reaches it at, or ''
        copy_why: function (remote, forward) {
            if (this.open_server.phase !== 'up') {
                return 'Once it is up';
            }
            if (this.open_database === null) {
                return 'No database in it yet';
            }
            if (this.open_database.user === null) {
                return 'Made outside serviceman: serviceman has no user of its own for it';
            }
            if ((forward !== null) && forward.off) {
                return 'Its forward is set aside: turn it on in Forwards';
            }
            return '';
        },
        // What Copy URL puts on the clipboard, its password shown as dots: serviceman says it
        // when it is clicked, and the page keeps it nowhere
        copy_title: function (remote, port, forward) {
            const why = this.copy_why(remote, forward);
            if (why !== '') {
                return why;
            }
            const engine = this.view.engines.find(v => v.value === this.open_server.engine);
            const scheme = (engine === undefined) ? this.open_server.engine : engine.scheme;
            const user = this.open_database.user;
            const tail = (this.open_server.engine === 'couchdb') ? '' : `/${this.open_database.name}`;
            return `${scheme}://${user}:${'•'.repeat(8)}@127.0.0.1:${port}${tail}, its password in it, for a program on ${this.machine_title(remote)}`;
        },
        url_copy: async function (remote) {
            this.forward_note = '';
            try {
                const query = new URLSearchParams({database: this.open_database.name, remote});
                const answer = await fetch(`/api/v1/databases/${encodeURIComponent(this.open_server.name)}/url?${query}`, {cache: 'no-store'});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                if (await to_clipboard(said.url) === false) {
                    throw new Error('The browser did not take it on the clipboard');
                }
                this.copied = remote;
            }
            catch (error) {
                this.forward_note = error.message;
            }
        },
        drop_title: function (item) {
            const where = this.machine_title(item.to.remote);
            if (item.apps.length === 0) {
                return `Bring it to ${where} no more`;
            }
            return `Bring it to ${where} no more: ${item.apps.join(', ')} ${(item.apps.length === 1) ? 'finds' : 'find'} it here, and the next start stops without it`;
        },
        forward_drop: async function (item) {
            await this.forwards_write(this.open_server.forwards.filter(v => v !== item).map(v => end_of(v.to)));
        },
        // Where its port shows up, the whole list: what serviceman answers is the page now
        forwards_write: async function (ends) {
            this.busy = true;
            this.forward_note = '';
            try {
                const answer = await fetch(`/api/v1/databases/${encodeURIComponent(this.open_server.name)}/forwards`, {method: 'PUT', body: JSON.stringify({forwards: ends.map(v => ({to: v}))})});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                this.view = said;
                return true;
            }
            catch (error) {
                this.forward_note = error.message;
                return false;
            }
            finally {
                this.busy = false;
            }
        },
        machine_title: function (name) {
            const found = this.view.machines.find(v => v.remote === name);
            return (found === undefined) ? (name || 'this host') : found.title;
        },
        // A forward's end as its line shows it: a port on that machine's loopback, or a socket
        end_text: function (to) {
            return (to.socket === null) ? `127.0.0.1:${to.port}` : to.socket;
        },
        colour_of: function (server) {
            return database_rows.ENGINE_COLOURS[server.engine] || 'currentColor';
        },
        engine_text: function (server) {
            return database_rows.engine_text(server, this.view.engines);
        },
        state_of: function (server) {
            return database_state(server);
        },
        used_text: function (server) {
            const apps = [...new Set(server.databases.flatMap(v => v.apps))];
            if (apps.length === 0) {
                return '';
            }
            return `${apps.join(', ')} ${(apps.length === 1) ? 'is given it, and finds' : 'are given it, and find'} no database at the next start. `;
        },
    },
};

// A forward's end as the config writes it, from the end the answer shows
function end_of(to)
{
    const place = to.here ? {here: true} : {remote: to.remote};
    return Object.assign(place, (to.socket === null) ? {port: to.port} : {socket: to.socket});
}

export default databases_pane;
