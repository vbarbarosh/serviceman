import data_table from './data_table.js';

// How often an open pane asks how the servers stand: one coming up says each step within seconds
const REFRESH_MS = 3000;
// What each phase of a server is called, and its dot
const PHASES = {
    up: {label: 'up', dot: 'running'},
    starting: {label: 'coming up', dot: 'starting'},
    failed: {label: 'failed', dot: 'failed'},
    removing: {label: 'being removed', dot: 'stopping'},
};
// A server's name: what its container and its folder are called after
const RE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

// Databases: the database servers serviceman runs on the machines, a container each, always up,
// its data in a folder kept for it there. + MySQL brings one up on a machine, empty or filled
// with a sample; + Database makes an empty one inside a server. An app picks one of them in its
// Data tab on Apps and finds it in DATABASE_URL at every start. The passwords stay with
// serviceman: the page sees names, sizes and who uses what.
const databases_pane = {
    template: `
<article id="detail" class="list databases">
    <div class="list-head">
        <h1>Databases</h1>
        <span class="muted">{{ count_text }}</span>
        <div class="list-acts">
            <button v-for="engine of engines" :key="engine.value" type="button" class="primary" :disabled="(form !== null)" @click="form_begin(engine)">+ {{ engine.label }}</button>
        </div>
    </div>
    <p class="muted">A database server on one of your machines, always up, its data kept there. An app picks one of its databases in its Data tab, on Apps, and finds it in <code>DATABASE_URL</code> at every start; the passwords stay with serviceman.</p>
    <div v-if="(form !== null)" class="card db-card db-form">
        <div class="db-form-grid">
            <label for="db-form-remote">Machine</label>
            <select id="db-form-remote" v-model="form.remote">
                <option v-for="item of machine_options" :key="item.value" :value="item.value" :disabled="item.disabled">{{ item.label }}</option>
            </select>
            <label for="db-form-version">{{ form.engine.label }}</label>
            <select id="db-form-version" v-model="form.version">
                <option v-for="version of form.engine.versions" :key="version" :value="version">{{ version }}</option>
            </select>
            <label for="db-form-sample">Filled with</label>
            <select id="db-form-sample" v-model="form.sample">
                <option value="">nothing: an empty server</option>
                <option v-for="sample of form.engine.samples" :key="sample.value" :value="sample.value">{{ sample.label }}</option>
            </select>
            <label for="db-form-name">Name</label>
            <input id="db-form-name" v-model.trim="form.name" :class="{wrong: (name_problem !== '')}" spellcheck="false" autocomplete="off" @keydown.enter="form_save">
        </div>
        <p class="muted db-form-says">{{ form_says }}</p>
        <p v-if="(name_problem !== '')" class="bad">{{ name_problem }}</p>
        <div class="row-of">
            <button type="button" class="primary" :disabled="((form.remote === '') || (name_problem !== '') || busy)" @click="form_save">Bring it up</button>
            <button type="button" :disabled="busy" @click="form = null">Cancel</button>
        </div>
    </div>
    <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
    <p v-if="(view === null)" class="muted"><span v-if="(load_error === '')" class="spin"/>{{ (load_error === '') ? 'reading…' : load_error }}</p>
    <p v-else-if="((servers.length === 0) && (form === null))" class="muted">No database yet: <button type="button" class="link" @click="form_begin(engines[0])">+ {{ engines[0].label }}</button> brings one up on a machine of yours, empty or filled with a sample.</p>
    <section v-for="server of servers" :key="server.name" class="db-server">
        <div class="list-head db-head">
            <h2>
                <svg class="db-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/></svg>
                {{ server.name }}
            </h2>
            <span class="muted db-where">{{ where_text(server) }}</span>
            <span class="db-phase"><span class="dot" :class="phase_of(server).dot"/><span :class="{bad: (server.phase === 'failed')}"><span v-if="(server.phase === 'starting')" class="spin"/>{{ phase_text(server) }}</span></span>
            <div class="list-acts">
                <button type="button" :disabled="((server.phase !== 'up') || (server.online === false) || (adding !== null))" :title="add_title(server)" @click="add_begin(server)">+ Database</button>
                <button type="button" :disabled="(server.phase === 'removing')" @click="remove_begin(server)">Remove…</button>
            </div>
        </div>
        <p v-if="(server.phase === 'failed')" class="bad db-why">{{ server.error }}</p>
        <div v-if="((removing !== null) && (removing.server === server.name))" class="card db-card">
            <p>Removing <b>{{ server.name }}</b> stops its container on {{ server.title }} and takes away every database in it, its folder there too. {{ used_text(server) }}Type its name to go on:</p>
            <div class="row-of">
                <input ref="remove_name" v-model.trim="removing.typed" :placeholder="server.name" spellcheck="false" autocomplete="off" aria-label="The server's name, typed again" @keydown.enter="remove_save">
                <button type="button" class="danger" :disabled="((removing.typed !== server.name) || busy)" @click="remove_save">Remove {{ server.name }}</button>
                <button type="button" :disabled="busy" @click="removing = null">Cancel</button>
            </div>
        </div>
        <div v-if="((adding !== null) && (adding.server === server.name))" class="card db-card">
            <div class="row-of">
                <input ref="add_name" v-model.trim="adding.name" placeholder="shop" spellcheck="false" autocomplete="off" aria-label="The new database's name" @keydown.enter="add_save">
                <button type="button" class="primary" :disabled="((add_problem !== '') || busy)" @click="add_save">Make it</button>
                <button type="button" :disabled="busy" @click="adding = null">Cancel</button>
                <span :class="((add_problem === '') ? 'muted' : 'bad')">{{ (add_problem === '') ? 'empty, with a user of its own named after it' : add_problem }}</span>
            </div>
        </div>
        <data-table :columns="columns" :rows="server.databases" :row_key="v => v.name" :more="cell_more" actions_label="" :empty="empty_text(server)">
            <template #cell="{row, column}">
                <code v-if="(column.key === 'name')">{{ row.name }}</code>
                <span v-else-if="(column.key === 'tables')">{{ row.tables }}</span>
                <span v-else-if="(column.key === 'size')">{{ size_text(row.bytes) }}</span>
                <span v-else-if="(column.key === 'apps')" class="db-apps">
                    <span v-if="(row.apps.length === 0)" class="muted">no app yet</span>
                    <template v-for="(name, index) of row.apps" v-else :key="name"><button type="button" class="link" @click="$emit('select', name)">{{ name }}<span v-if="(index < (row.apps.length - 1))" class="db-comma">,</span></button></template>
                </span>
            </template>
        </data-table>
    </section>
</article>
`,
    components: {'data-table': data_table},
    emits: ['select', 'changed'],
    data: function () {
        // form: + MySQL's form; adding: + Database's form in a server; removing: Remove's
        return {view: null, load_error: '', form: null, adding: null, removing: null, busy: false, note: '', bad: false, timer: null};
    },
    computed: {
        servers: function () {
            return (this.view === null) ? [] : this.view.servers;
        },
        engines: function () {
            return (this.view === null) ? [{value: 'mysql', label: 'MySQL', versions: [], samples: []}] : this.view.engines;
        },
        count_text: function () {
            if (this.view === null) {
                return '';
            }
            const databases = this.servers.reduce((sum, v) => sum + v.databases.length, 0);
            return `${this.servers.length} ${(this.servers.length === 1) ? 'server' : 'servers'} · ${databases} ${(databases === 1) ? 'database' : 'databases'}`;
        },
        columns: function () {
            return [
                {key: 'name', label: 'Database', wraps: true},
                {key: 'tables', label: 'Tables', align: 'right', fold: 1},
                {key: 'size', label: 'Size', align: 'right', fold: 2},
                {key: 'apps', label: 'Used by', wraps: true},
            ];
        },
        // A machine can hold one when it is online with docker; the others are said, not hidden
        machine_options: function () {
            const out = [{value: '', label: 'Pick a machine…', disabled: true}];
            for (const item of this.view.machines) {
                let why = '';
                if (item.online === false) {
                    why = ' · offline';
                }
                else if (item.docker === false) {
                    why = ' · no docker';
                }
                out.push({value: item.remote, label: item.title + why, disabled: (why !== '')});
            }
            return out;
        },
        form_says: function () {
            const sample = this.form.engine.samples.find(v => v.value === this.form.sample);
            const machine = this.view.machines.find(v => v.remote === this.form.remote);
            const where = (machine === undefined) ? 'the machine you pick' : machine.title;
            if (sample === undefined) {
                return `${this.form.engine.label} ${this.form.version} on ${where}, always up, its data in a folder kept for it there; + Database makes the databases in it.`;
            }
            return `${sample.label}: ${sample.about}. Fetched once from where it is published and loaded only when its sha256 is the one pinned here.`;
        },
        name_problem: function () {
            if (this.form === null) {
                return '';
            }
            if (RE_NAME.test(this.form.name) === false) {
                return 'A name is up to 40 small letters, digits and hyphens, a letter first.';
            }
            if (this.servers.some(v => v.name === this.form.name)) {
                return `${this.form.name} is taken.`;
            }
            return '';
        },
        add_problem: function () {
            if (this.adding === null) {
                return '';
            }
            if (/^[a-z][a-z0-9_]{0,31}$/.test(this.adding.name) === false) {
                return 'up to 32 small letters, digits and _, a letter first';
            }
            const server = this.servers.find(v => v.name === this.adding.server);
            if ((server !== undefined) && server.databases.some(v => v.name === this.adding.name)) {
                return `${this.adding.name} is there already`;
            }
            return '';
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
        // The name is the engine's and the first number free: mysql-1, then mysql-2
        form_begin: function (engine) {
            const taken = new Set(this.servers.map(v => v.name));
            let number = 1;
            while (taken.has(`${engine.value}-${number}`)) {
                number++;
            }
            const free = this.view.machines.find(v => v.online && v.docker);
            const sample = (engine.samples.length > 0) ? engine.samples[0].value : '';
            this.form = {engine, version: engine.versions[0], sample, remote: (free === undefined) ? '' : free.remote, name: `${engine.value}-${number}`};
            this.note = '';
        },
        form_save: async function () {
            if ((this.form.remote === '') || (this.name_problem !== '') || this.busy) {
                return;
            }
            const body = {name: this.form.name, engine: this.form.engine.value, version: this.form.version, remote: this.form.remote, sample: this.form.sample};
            if (await this.send('POST', '/api/v1/databases', body, `${body.name} is coming up`)) {
                this.form = null;
            }
        },
        add_begin: function (server) {
            this.adding = {server: server.name, name: ''};
            this.$nextTick(() => this.$refs.add_name[0].focus());
        },
        add_save: async function () {
            if ((this.add_problem !== '') || this.busy) {
                return;
            }
            const url = `/api/v1/databases/${encodeURIComponent(this.adding.server)}/databases`;
            if (await this.send('POST', url, {name: this.adding.name}, `${this.adding.name} is made`)) {
                this.adding = null;
            }
        },
        remove_begin: function (server) {
            this.removing = {server: server.name, typed: ''};
            this.$nextTick(() => this.$refs.remove_name[0].focus());
        },
        remove_save: async function () {
            if ((this.removing.typed !== this.removing.server) || this.busy) {
                return;
            }
            const url = `/api/v1/databases/${encodeURIComponent(this.removing.server)}`;
            if (await this.send('DELETE', url, null, `${this.removing.server} is being removed`)) {
                this.removing = null;
            }
        },
        // One request, its answer said under the head; true when it went through
        send: async function (method, url, body, done) {
            this.busy = true;
            this.note = '';
            try {
                const init = {method, headers: {'content-type': 'application/json'}};
                if (body !== null) {
                    init.body = JSON.stringify(body);
                }
                const answer = await fetch(url, init);
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `${answer.status}`);
                }
                this.note = done;
                this.bad = false;
                await this.read();
                this.$emit('changed');
                return true;
            }
            catch (error) {
                this.note = error.message;
                this.bad = true;
                return false;
            }
            finally {
                this.busy = false;
            }
        },
        phase_of: function (server) {
            if ((server.online === false) && (server.phase === 'up')) {
                return {label: 'machine offline', dot: 'failed'};
            }
            return PHASES[server.phase] || {label: server.phase, dot: ''};
        },
        // What a server coming up is doing now: pulling, starting, loading its sample
        phase_text: function (server) {
            if ((server.phase === 'starting') && server.said) {
                return server.said;
            }
            return this.phase_of(server).label;
        },
        where_text: function (server) {
            const engine = this.engines.find(v => v.value === server.engine);
            return `${(engine === undefined) ? server.engine : engine.label} ${server.version} · on ${server.title}`;
        },
        add_title: function (server) {
            if (server.online === false) {
                return `${server.title} is offline`;
            }
            if (server.phase !== 'up') {
                return 'once it is up';
            }
            return 'An empty database in it, with a user of its own';
        },
        used_text: function (server) {
            const apps = [...new Set(server.databases.flatMap(v => v.apps))];
            if (apps.length === 0) {
                return '';
            }
            return `${apps.join(', ')} ${(apps.length === 1) ? 'uses' : 'use'} it and will find no database at the next start. `;
        },
        empty_text: function (server) {
            if (server.online === false) {
                return `Its databases show once ${server.title} is back.`;
            }
            if (server.phase === 'starting') {
                return 'Its databases show once it is up.';
            }
            if (server.phase === 'failed') {
                return 'No database: it did not come up.';
            }
            return 'No database in it yet: + Database makes one.';
        },
        size_text: function (bytes) {
            if (bytes < 1024*1024) {
                return `${Math.max(1, Math.round(bytes/1024))} KB`;
            }
            if (bytes < 1024*1024*1024) {
                return `${(bytes/1024/1024).toFixed(1)} MB`;
            }
            return `${(bytes/1024/1024/1024).toFixed(1)} GB`;
        },
        cell_more: function () {
            return false;
        },
    },
};

export default databases_pane;
