import app_data_env_free from './app_data_env_free.js';
import machine_card from './machine_card.js';
import machine_icons from './machine_icons.js';
import machine_tile from './machine_tile.js';
import service_kind from './service_kind.js';
import state_read from './state_read.js';
import step_frame from './step_frame.js';

// How often the form asks how a server it brought up stands
const UP_EVERY_MS = 2000;
// The engines' tiles in this order, the first picked when the form opens
const ENGINE_ORDER = ['postgresql', 'mysql', 'couchdb'];
// A database's name, as a server takes it
const RE_DATABASE = /^[a-z][a-z0-9_]{0,31}$/;
// Each engine's port inside and its URL's scheme
const ENGINES = {
    mysql: {port: 3306, scheme: 'mysql'},
    postgresql: {port: 5432, scheme: 'postgresql'},
    couchdb: {port: 5984, scheme: 'http'},
};
const DATABASE_ICON = '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>';
const SERVER_ICON = '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>';
const BOX_ICON = '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>';
// What each engine is for, under its name on its tile
const ENGINE_SAYS = {
    postgresql: 'the usual pick; most apps speak it',
    mysql: 'for apps made for it: WordPress, Matomo',
    couchdb: 'documents and sync, over HTTP',
};

// New database, step by step: the engine, its version and what it starts with; the machine its
// data stays on; the apps given it; Check, with the database's name. A database lives in a server of its engine: one already up on that machine, or one
// Create brings up there first, said step by step as it comes up. A CouchDB is its server, given
// as its admin; a sample comes in a new server, under its own name. Each app ticked gets it at
// its next start, as its Data tab would give it.
const database_new = {
    template: `
<step-frame title="New database" :steps="steps" :step="step" :mode="mode" :can_next="step_ok.ok" :next_title="step_ok.why" :busy="busy" create_label="Create database" @step="step_go" @mode="mode = $event" @cancel="$emit('close')" @create="create">
    <template #engine>
        <div class="kind-tiles three" role="radiogroup" aria-label="Which database">
            <button v-for="item of engines" :key="item.value" type="button" role="radio" class="kind-tile" :class="{on: (item.value === m.engine)}" :aria-checked="(item.value === m.engine)" @click="engine_pick(item.value)">
                <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/></span>
                <b>{{ item.label }}</b>
                <span class="muted">{{ engine_says(item.value) }}</span>
            </button>
        </div>
        <div class="sf-inline">
            <b>Version</b>
            <span class="seg" role="group" aria-label="Its version">
                <button v-for="v of engine_item.versions" :key="v" type="button" :class="{on: (v === m.version)}" :aria-pressed="(v === m.version)" @click="m.version = v">{{ v }}</button>
            </span>
            <span class="muted">{{ engine_item.versions[0] }} is the newest</span>
        </div>
        <template v-if="(engine_item.samples.length > 0)">
            <h3 class="sf-sub">Start with</h3>
            <div class="kind-tiles three" role="radiogroup" aria-label="What it starts with">
                <button type="button" role="radio" class="kind-tile" :class="{on: (m.sample === '')}" :aria-checked="(m.sample === '')" @click="m.sample = ''">
                    <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>
                    <b>An empty database</b>
                    <span class="muted">tables come from the app</span>
                </button>
                <button v-for="item of engine_item.samples" :key="item.value" type="button" role="radio" class="kind-tile" :class="{on: (m.sample === item.value)}" :title="item.about" :aria-checked="(m.sample === item.value)" @click="m.sample = item.value">
                    <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/></span>
                    <b>{{ item.label }}</b>
                    <span class="muted">a sample: {{ item.about.split(',')[0] }}</span>
                </button>
            </div>
            <p v-if="(m.sample !== '')" class="sf-hint">It comes in a server of its own, as the database <code>{{ sample_item.database }}</code>.</p>
        </template>
        <p v-else-if="(m.engine === 'couchdb')" class="sf-hint">A CouchDB is one store: the app given it is its admin, and makes a database for each user its wall signs in.</p>
    </template>
    <template #machine>
        <div class="machine-cards" role="radiogroup" aria-label="The machine its data stays on">
            <machine-tile v-for="item of machine_cards" :key="item.value" :item="item" :on="(item.value === m.remote)" :disabled="item.disabled" :title="item.why" @click="m.remote = item.value"/>
            <button type="button" class="machine-card mc-add" :class="{alone: (machine_cards.length === 0)}" :disabled="busy" @click="machine_add">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                <b>Add a machine</b>
                <span class="muted">its agent dials in; you come back here with it picked</span>
            </button>
        </div>
        <p class="sf-info"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/><span>{{ server_says }}</span></p>
    </template>
    <template #given>
        <div v-if="(app_cards.length > 0)" class="sf-list" role="group" aria-label="The apps given it">
            <label v-for="item of app_cards" :key="item.name" class="sf-li" :class="{on: m.given.includes(item.name), off: item.disabled}" :title="item.why">
                <input v-model="m.given" type="checkbox" :value="item.name" :disabled="item.disabled" :aria-label="('Given to ' + item.title)">
                <b>{{ item.title }}</b>
                <span class="muted">{{ item.line }}</span>
                <span class="sf-li-end"><code v-if="m.given.includes(item.name)">{{ env_name }}</code><span v-else-if="item.disabled" class="muted">{{ item.why }}</span></span>
            </label>
        </div>
        <p v-if="(app_cards.length === 0)" class="sf-hint">No app yet: an app picks it later, in its Data tab on Apps.</p>
        <template v-else-if="(m.given.length > 0)">
            <p class="sf-hint">{{ m.given[0] }} gets, at every start</p>
            <code class="db-url">{{ url_shown }}</code>
        </template>
        <p v-else class="sf-hint">None is fine too: an app picks it later, in its Data tab on Apps; its password stays with serviceman.</p>
    </template>
    <template #check>
        <div v-if="((m.engine !== 'couchdb') && (m.sample === ''))" class="sf-field">
            <label for="db-new-name">Name</label>
            <input id="db-new-name" ref="name" v-model.trim="m.name" class="sf-mono" placeholder="orders" spellcheck="false" autocomplete="off" :class="{wrong: name_wrong}" @keydown.enter="create">
            <p :class="['sf-hint', {bad: name_wrong}]">{{ name_wrong ? name_problem : 'small letters, digits and _; it gets a user of its own, named after it' }}</p>
        </div>
        <p v-else class="sf-hint">It is called <code>{{ database_name }}</code>{{ (m.engine === 'couchdb') ? ', the app given it its admin' : ', as its sample names it' }}.</p>
        <template v-if="(mode === 'steps')">
            <div class="check-rows">
                <div v-for="row of check_rows" :key="row.key" class="check-row">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/>
                    <span class="cr-text"><span>{{ row.text }}</span><span v-if="(row.sub !== '')" class="muted">{{ row.sub }}</span></span>
                    <button type="button" class="link" @click="step = row.step">Change</button>
                </div>
            </div>
            <h3 class="rest-title">The rest, as it is today</h3>
            <div class="rest-cards">
                <div v-for="card of rest_cards" :key="card.id" class="rest-card">
                    <span class="muted">{{ card.title }}</span>
                    <b>{{ card.text }}</b>
                    <span class="sf-hint">{{ card.note }}</span>
                </div>
            </div>
        </template>
    </template>
    <template #summary>
        <p v-for="row of check_rows" :key="row.key" class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/><span>{{ row.text }}</span></p>
        <p v-for="card of rest_cards" :key="card.id" class="sum-line"><span>{{ card.title }}: {{ card.text }}</span></p>
    </template>
    <template #note>
        <span v-if="(said !== '')" class="muted"><span class="spin"/>{{ said }}</span>
        <span v-else-if="(note !== '')" class="bad">{{ note }}</span>
        <span v-else-if="((step_ok.ok === false) && (mode === 'page'))" class="muted">{{ step_ok.why }}</span>
    </template>
</step-frame>
`,
    components: {'machine-tile': machine_tile, 'step-frame': step_frame},
    props: {
        // What GET /api/v1/databases answers: {engines, machines, servers}
        view: {type: Object, required: true},
        // What the form held when Add a machine left it, the machine made since picked; or null
        restore: {type: Object, default: null},
        // The apps ticked when it opens, and their machine: New database from an app's Data tab
        given: {type: Array, default: () => []},
        remote: {type: String, default: ''},
    },
    emits: ['close', 'machine', 'made'],
    data: function () {
        const engine = engines_ordered(this.view.engines)[0];
        const free = this.view.machines.find(v => v.online && v.docker);
        const remote = (this.remote !== '') ? this.remote : ((free === undefined) ? '' : free.remote);
        const m = {engine: engine.value, version: engine.versions[0], sample: '', name: '', remote, given: this.given.slice()};
        if (this.restore !== null) {
            Object.assign(m, this.restore.model);
        }
        return {
            DATABASE_ICON,
            m,
            step: (this.restore === null) ? 0 : this.restore.step,
            mode: (this.restore === null) ? 'steps' : this.restore.mode,
            // The services and the machines as the status says them, for the cards
            state: null,
            busy: false,
            said: '',
            note: '',
        };
    },
    computed: {
        engines: function () {
            return engines_ordered(this.view.engines);
        },
        engine_item: function () {
            return this.engines.find(v => v.value === this.m.engine) || this.engines[0];
        },
        sample_item: function () {
            return this.engine_item.samples.find(v => v.value === this.m.sample) || {label: '', about: '', database: ''};
        },
        // What the database is called once made: its name, a sample's own, or a CouchDB's admin
        database_name: function () {
            if (this.m.engine === 'couchdb') {
                return 'admin';
            }
            return (this.m.sample === '') ? this.m.name : this.sample_item.database;
        },
        env_name: function () {
            return (this.m.engine === 'couchdb') ? 'COUCHDB_URL' : 'DATABASE_URL';
        },
        engine_text: function () {
            return `${this.engine_item.label} ${this.m.version}`;
        },
        remote_title: function () {
            return this.machine_title(this.m.remote);
        },
        // The server it goes in: one of its engine and version up on that machine, unless a
        // sample asks for one of its own
        server: function () {
            if (this.m.sample !== '') {
                return null;
            }
            return this.view.servers.find(v => (v.engine === this.m.engine) && (v.version === this.m.version) && (v.remote === this.m.remote) && (v.phase === 'up') && v.online) || null;
        },
        // The name a server brought up for it takes: its engine and the first number free
        server_name: function () {
            if (this.server !== null) {
                return this.server.name;
            }
            const taken = new Set(this.view.servers.map(v => v.name));
            let number = 1;
            while (taken.has(`${this.m.engine}-${number}`)) {
                number++;
            }
            return `${this.m.engine}-${number}`;
        },
        server_says: function () {
            if (this.m.remote === '') {
                return 'Its data stays on the machine picked, in a folder of its own.';
            }
            if (this.server !== null) {
                return `It goes in ${this.server.name}, the ${this.engine_text} up on ${this.remote_title} already; its data stays there.`;
            }
            return `A ${this.engine_text} is brought up on ${this.remote_title} first, as ${this.server_name}, always up; its data stays there, in a folder of its own.`;
        },
        steps: function () {
            return [
                {key: 'engine', name: 'Engine', question: 'Which database?', says: '', answer: this.engine_text},
                {key: 'machine', name: 'Machine', question: 'Where will it run?', says: 'Its data is kept on that machine, in a folder of its own.', answer: this.m.remote},
                {key: 'given', name: 'Given to', question: 'Which apps get it?', says: `Each gets the database's URL as ${this.env_name} at its next start.`, answer: (this.m.given.length === 0) ? 'none yet' : this.m.given.join(', ')},
                {key: 'check', name: 'Check', question: (this.mode === 'steps') ? 'Check, then create' : 'Its name', says: '', answer: (this.name_problem === '') ? this.database_name : ''},
            ];
        },
        name_problem: function () {
            if ((this.m.engine === 'couchdb') || (this.m.sample !== '')) {
                return '';
            }
            if (RE_DATABASE.test(this.m.name) === false) {
                return 'A name of small letters, digits and _, a letter first, up to 32';
            }
            if ((this.server !== null) && this.server.databases.some(v => v.name.toLowerCase() === this.m.name)) {
                return `${this.server.name} has a database called ${this.m.name} already`;
            }
            return '';
        },
        // Said once something is typed: an empty name is said by Next's title, not in red
        name_wrong: function () {
            return (this.m.name !== '') && (this.name_problem !== '');
        },
        // Whether the open step, or the whole page, has what it needs
        step_ok: function () {
            const key = (this.mode === 'page') ? 'all' : this.steps[Math.min(this.step, this.steps.length - 1)].key;
            if (((key === 'check') || (key === 'all')) && (this.name_problem !== '')) {
                return {ok: false, why: this.name_problem};
            }
            if (((key === 'machine') || (key === 'all')) && (this.m.remote === '')) {
                return {ok: false, why: 'A machine online with docker first'};
            }
            const card = this.machine_cards.find(v => v.value === this.m.remote);
            if (((key === 'machine') || (key === 'all')) && (card !== undefined) && card.disabled) {
                return {ok: false, why: `${this.remote_title} is ${card.why}: another machine`};
            }
            return {ok: true, why: ''};
        },
        // Each machine with what it has free and runs; one that is offline or has no docker its
        // agent reaches is shown, and says why it cannot be picked
        machine_cards: function () {
            const remotes = (this.state === null) ? [] : this.state.remotes;
            const services = (this.state === null) ? [] : this.state.services;
            const kinds = this.kinds;
            return this.view.machines.map(function (item) {
                const remote = remotes.find(v => v.name === item.remote) || {name: item.remote, title: item.title, phase: item.online ? 'online' : 'offline', left_at: null, machine: null};
                const count = services.filter(v => (v.remotes !== undefined) && v.remotes.includes(item.remote)).length;
                const card = machine_card(remote, kinds[item.remote], count);
                const why = (item.online === false) ? '' : ((item.docker === false) ? 'with no docker its agent reaches' : '');
                if (why !== '') {
                    card.lines = [card.lines[0], why];
                    card.meter = null;
                    card.away = true;
                }
                return Object.assign(card, {disabled: (item.online === false) || (why !== ''), why: (item.online === false) ? 'offline' : why});
            });
        },
        kinds: function () {
            const machines = ((this.state === null) || (this.state.canvas === undefined) || (this.state.canvas === null)) ? [] : this.state.canvas.machines;
            return Object.fromEntries(machines.map(v => [v.name, v.kind]));
        },
        // Every service, those that can be given it first: a container or a program on that
        // machine. One elsewhere does not reach this machine's servers, and one serviceman does
        // not start reads no variables: both are shown, and say why.
        app_cards: function () {
            const services = (this.state === null) ? [] : this.state.services;
            const cards = [];
            for (const service of services) {
                const kind = service_kind(service);
                const machine = ((service.remotes === undefined) || (service.remotes.length === 0)) ? '' : service.remotes[0];
                const title = this.machine_title(machine);
                let why = '';
                if (service.type === 'files') {
                    why = 'a page: it reads no variables';
                }
                else if ((service.type !== 'docker') && (service.type !== 'shell')) {
                    why = 'serviceman does not start it: it reads no variables';
                }
                else if (machine !== this.m.remote) {
                    why = `on ${title}: an app is given a database of its own machine`;
                }
                cards.push({name: service.name, title: service.name, icon: kind.icon, line: `${kind.word} · ${machine || 'serviceman'}`, disabled: (why !== ''), why});
            }
            return cards.filter(v => v.disabled === false).concat(cards.filter(v => v.disabled));
        },
        // What the first app ticked finds at every start, its password hidden: by the server's
        // name in a container, on 127.0.0.1 for a program
        url_shown: function () {
            const engine = ENGINES[this.m.engine];
            const app = (this.state === null) ? undefined : this.state.services.find(v => v.name === this.m.given[0]);
            const inside = (app === undefined) || (app.type === 'docker');
            const port = ((this.server === null) || (this.server.port === null)) ? 'its port' : this.server.port;
            const host = inside ? `serviceman-db-${this.server_name}:${engine.port}` : `127.0.0.1:${port}`;
            if (this.m.engine === 'couchdb') {
                return `${this.env_name}=${engine.scheme}://admin:••••••@${host}  COUCHDB_SECRET=••••••`;
            }
            const name = this.database_name || '…';
            return `${this.env_name}=${engine.scheme}://${name}:••••••@${host}/${name}`;
        },
        check_rows: function () {
            const keys = this.steps.map(v => v.key);
            return [
                {key: 'engine', step: keys.indexOf('engine'), icon: DATABASE_ICON, text: this.engine_text, sub: (this.m.sample === '') ? ((this.m.engine === 'couchdb') ? 'one store' : 'empty') : `filled with ${this.sample_item.label}`},
                {key: 'machine', step: keys.indexOf('machine'), icon: machine_icons[this.kinds[this.m.remote]] || SERVER_ICON, text: (this.m.remote === '') ? 'No machine yet' : `On ${this.m.remote}`, sub: (this.server === null) ? `in a new server, ${this.server_name}, its data in a folder of its own` : `in ${this.server.name}, up there already`},
                {key: 'given', step: keys.indexOf('given'), icon: BOX_ICON, text: (this.m.given.length === 0) ? 'Given to no app yet' : `Given to ${this.m.given.join(', ')}`, sub: (this.m.given.length === 0) ? '' : `as ${this.env_name}`},
            ];
        },
        // The rest, as serviceman does it today
        rest_cards: function () {
            return [
                {id: 'backups', title: 'Backups', text: 'none yet', note: 'serviceman makes none yet'},
                {id: 'reach', title: 'Reached from', text: 'its machine only', note: 'its apps there; nothing outside'},
                {id: 'adminer', title: 'Adminer', text: 'to look inside', note: (this.m.engine === 'couchdb') ? 'CouchDB has its own, Fauxton' : 'an app on Apps, given it'},
            ];
        },
    },
    watch: {
        // An app on another machine cannot keep it
        'm.remote': function () {
            const free = this.app_cards.filter(v => v.disabled === false).map(v => v.name);
            this.m.given = this.m.given.filter(v => free.includes(v));
        },
    },
    methods: {
        engine_says: function (engine) {
            return ENGINE_SAYS[engine] || '';
        },
        machine_title: function (name) {
            const found = this.view.machines.find(v => v.remote === name);
            return (found === undefined) ? (name || 'serviceman') : found.title;
        },
        engine_pick: function (value) {
            this.m.engine = value;
            this.m.version = this.engine_item.versions[0];
            this.m.sample = '';
        },
        // Back to any step, and on to the next one when this one has what it needs
        step_go: function (index) {
            if ((index > this.step) && (this.step_ok.ok === false)) {
                return;
            }
            this.step = Math.min(index, this.steps.length - 1);
            this.note = '';
            this.$nextTick(function () {
                if ((this.steps[this.step].key === 'check') && (this.$refs.name !== undefined)) {
                    this.$refs.name.focus();
                }
            });
        },
        // New remote, and back here with every answer kept and the machine made picked
        machine_add: function () {
            this.$emit('machine', {kind: 'database', model: JSON.parse(JSON.stringify(this.m)), step: this.steps.findIndex(v => v.key === 'machine'), mode: this.mode});
        },
        // The server first, brought up when there is none; then the database in it; then each
        // app given it, one write each. What fails is said, and what was made stays made.
        create: async function () {
            if ((this.step_ok.ok === false) || this.busy) {
                return;
            }
            this.busy = true;
            this.note = '';
            try {
                const server = (this.server === null) ? await this.server_up() : this.server;
                const database = this.database_name;
                if ((this.m.sample === '') && (this.m.engine !== 'couchdb')) {
                    this.said = `making ${database} in ${server.name}`;
                    await this.send('POST', `/api/v1/databases/${encodeURIComponent(server.name)}/databases`, {name: database});
                }
                for (const app of this.m.given) {
                    this.said = `giving it to ${app}`;
                    await this.give(app, server.name, database);
                }
                this.said = '';
                this.$emit('made', {server: server.name, database, given: this.m.given.slice()});
            }
            catch (error) {
                this.said = '';
                this.note = error.message;
            }
            finally {
                this.busy = false;
            }
        },
        // A server of its engine on that machine, waited for while it says each step
        server_up: async function () {
            const name = this.server_name;
            this.said = `${name}: on its way`;
            await this.send('POST', '/api/v1/databases', {name, engine: this.m.engine, version: this.m.version, remote: this.m.remote, sample: this.m.sample});
            for (;;) {
                await new Promise(v => setTimeout(v, UP_EVERY_MS));
                const view = await fetch('/api/v1/databases', {cache: 'no-store'}).then(v => v.json());
                const server = view.servers.find(v => v.name === name);
                if (server === undefined) {
                    throw new Error(`${name} is gone`);
                }
                if (server.phase === 'failed') {
                    throw new Error(`${name} did not come up: ${server.error}`);
                }
                if (server.phase === 'up') {
                    return server;
                }
                this.said = `${name}: ${server.said || 'coming up'}`;
            }
        },
        // The app's entry with one more database in it, in the variable named for its engine
        // that no row of its fills yet, written the way its Data tab writes it
        give: async function (app, server, database) {
            const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
            const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === app);
            if (entry === undefined) {
                throw new Error(`${app} is not in the config any more`);
            }
            const rows = (entry.databases || []).concat(entry.folders || []);
            const env = app_data_env_free(rows.map(v => v.env), this.env_name);
            const service = Object.assign({}, entry, {databases: (entry.databases || []).concat([{server, database, env}])});
            await this.send('PUT', `/api/v1/services/${encodeURIComponent(app)}`, {service});
        },
        send: async function (method, url, body) {
            const answer = await fetch(url, {method, body: JSON.stringify(body)});
            if (answer.ok === false) {
                throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
            }
            return answer;
        },
    },
    created: async function () {
        try {
            this.state = await state_read();
        }
        catch {
            this.state = null;
        }
    },
    mounted: function () {
        if (this.$refs.name !== undefined) {
            this.$refs.name.focus();
        }
    },
};

// PostgreSQL first, as New database is drawn, an engine the list does not name last; each one's
// versions newest first: an object's keys that are numbers ('16', '17') come smallest first
function engines_ordered(engines)
{
    return engines.slice().sort((a, b) => engine_rank(a) - engine_rank(b)).map(v => Object.assign({}, v, {versions: v.versions.slice().sort((a, b) => b.localeCompare(a, 'en', {numeric: true}))}));
}

function engine_rank(engine)
{
    return ENGINE_ORDER.includes(engine.value) ? ENGINE_ORDER.indexOf(engine.value) : ENGINE_ORDER.length;
}

export default database_new;
