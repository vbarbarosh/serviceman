import app_data_env_free from './app_data_env_free.js';
import app_data_value from './app_data_value.js';
import app_kind_of from './app_kind_of.js';
import database_env_given from './database_env_given.js';
import storage_get from './storage_get.js';
import storage_set from './storage_set.js';
import to_clipboard from './to_clipboard.js';

// What each kind of row is called on its card
const KIND_WORDS = {database: 'Database', folder: 'Folder', rest: 'REST'};

// The kinds of app serviceman starts itself, and so puts the variables in the env of
const KINDS_STARTED = ['app folder', 'docker image', 'program'];

// What every database URL shows of its password: the page never has it
const DOTS = '•'.repeat(8);
// A variable's _URL, with the number a second one of its name has; and the names a pick is
// given until one is typed, by the kind of server it picks
const RE_URL_ENV = /_URL(_\d+)?$/;
const RE_ENV_GIVEN = /^(DATABASE|COUCHDB|MONGODB)_URL(_\d+)?$/;

// Each engine as its URL says it and its servers are named: its scheme and its port inside
const ENGINES = {
    mysql: {label: 'MySQL', scheme: 'mysql', port: 3306},
    postgresql: {label: 'PostgreSQL', scheme: 'postgresql', port: 5432},
    couchdb: {label: 'CouchDB', scheme: 'http', port: 5984},
    mongodb: {label: 'MongoDB', scheme: 'mongodb', port: 27017},
};

// An app's Data tab, in its Settings window: what the app is given, a row each, every row filling
// one variable of its env. A database and a folder are real, kept in the app's config and handed
// to it at every start: a database of the Databases page, picked from a list, as its own user's
// URL, which this page never sees whole; a folder kept for it on its machine or one of that
// machine, as its path (FILES_DIR), mounted at /data/files in a container. REST (REST_URL) is a
// sketch for now, kept in this browser under the app's name. A store for each user is real too: a
// CouchDB of the Databases page, at /_couch on the app's own address, a database of their own for
// each user its wall signs in, which the agent at that CouchDB's machine's door answers; it is
// kept in the app's config as `store`. A row goes at once, with Undo in its place; a page, which
// has no program to read a variable, takes REST and a store, at its own address.
const app_data_tab = {
    template: `
<div class="app-data">
    <div class="app-data-adds">
        <button type="button" :disabled="((pick_free === null) || saving)" :title="pick_title" @click="click_database">+ Database</button>
        <button type="button" :disabled="((started === false) || (machine === null) || saving)" :title="(started ? ('New database, on ' + (machine || 'its machine') + ', given to ' + app.name) : 'serviceman does not start it, so it hands it no database')" @click="$emit('new_database', {given: [app.name], remote: machine})">New database…</button>
        <button type="button" :disabled="((started === false) || saving)" :title="(started ? 'A folder kept for it, or one of its machine, at every start' : 'serviceman does not start it, so it hands it no folder')" @click="click_folder">+ Folder</button>
        <button type="button" :disabled="((store !== null) || (store_free === null) || saving)" :title="store_title" @click="click_store">+ Store for each user</button>
        <button type="button" :disabled="has_rest" :title="(has_rest ? 'It has REST already' : '')" @click="click_rest">+ REST</button>
    </div>
    <p class="muted app-settings-says">{{ how }}</p>
    <p v-if="(error !== '')" class="bad app-data-error">{{ error }}</p>
    <p v-if="(removed !== null)" class="app-data-removed">Removed {{ removed_title }} · <button type="button" class="link" :disabled="saving" @click="click_undo">Undo</button></p>
    <p v-if="((picks.length === 0) && (folders.length === 0) && (items.length === 0) && (store === null))" class="muted app-data-none">Nothing yet: each row fills one variable of {{ app.name }}.</p>
    <ul v-else class="app-data-list">
        <li v-for="(pick, index) of picks" :key="('pick-' + index)" class="app-data-item">
            <div class="app-data-what">
                <span class="app-data-kind">Database</span>
                <select :value="key_of(pick)" :disabled="saving" aria-label="Which database" @change="change_pick(pick, $event.target.value)">
                    <option v-if="(option_of(pick) === null)" :value="key_of(pick)">{{ pick.database }} on {{ pick.server }}, not there now</option>
                    <optgroup v-for="group of groups" :key="group.server" :label="group.label">
                        <option v-for="option of group.options" :key="option.key" :value="option.key" :disabled="option.disabled">{{ option.label }}</option>
                    </optgroup>
                </select>
                <button type="button" class="app-data-remove" :disabled="saving" :title="('Remove ' + pick.database + '; Undo brings it back')" @click="click_remove_pick(index)">Remove</button>
            </div>
            <div class="app-data-var">
                <input :value="pick.env" class="app-data-env" :class="{bad: (env_taken(pick.env, pick) || (pick.env === ''))}" :disabled="saving" spellcheck="false" autocomplete="off" aria-label="The variable it fills" @input="input_env" @change="change_env(pick, $event.target.value)">
                <code class="app-data-value"><span class="muted">=&nbsp;</span>{{ url_of(pick) }}</code>
            </div>
            <div class="app-data-acts">
                <span class="app-data-says" :class="(pick_problem(pick) === '') ? 'muted' : 'bad'">{{ pick_says(pick) }}</span>
            </div>
        </li>
        <li v-if="(store !== null)" key="store" class="app-data-item">
            <div class="app-data-what">
                <span class="app-data-kind">Store</span>
                <select :value="store.server" :disabled="saving" aria-label="Which CouchDB" @change="change_store($event.target.value)">
                    <option v-if="(couch_of(store.server) === null)" :value="store.server">each user · {{ store.server }}, not there now</option>
                    <option v-for="server of couches" :key="server.name" :value="server.name">each user · {{ server.name }} on {{ server.title }}</option>
                </select>
                <button type="button" class="app-data-remove" :disabled="saving" title="Remove the store; Undo brings it back" @click="click_remove_store">Remove</button>
            </div>
            <div class="app-data-var">
                <code class="app-data-value">{{ host }}/_couch</code>
            </div>
            <div class="app-data-acts">
                <span class="app-data-says" :class="(store_problem === '') ? 'muted' : 'bad'">{{ store_says }}</span>
            </div>
        </li>
        <li v-for="(folder, index) of folders" :key="('folder-' + index)" class="app-data-item">
            <div class="app-data-what">
                <span class="app-data-kind">Folder</span>
                <select :value="((folder.path === null) ? 'kept' : 'machine')" :disabled="saving" aria-label="Which folder" @change="change_from(folder, $event.target.value)">
                    <option value="kept">a folder kept for it</option>
                    <option value="machine">a folder of its machine</option>
                </select>
                <input v-if="(folder.path !== null)" :value="folder.path" class="app-data-path" placeholder="/srv/photos" :disabled="saving" spellcheck="false" autocomplete="off" aria-label="The folder on its machine" @change="change_path(folder, $event.target.value.trim())">
                <button type="button" class="app-data-remove" :disabled="saving" title="Remove the folder; Undo brings it back" @click="click_remove_folder(index)">Remove</button>
            </div>
            <div class="app-data-var">
                <input :value="folder.env" class="app-data-env" :class="{bad: (env_taken(folder.env, folder) || (folder.env === ''))}" :disabled="saving" spellcheck="false" autocomplete="off" aria-label="The variable it fills" @input="input_env" @change="change_env(folder, $event.target.value)">
                <code class="app-data-value"><span class="muted">=&nbsp;</span>{{ folder_value(folder, index) }}</code>
            </div>
            <div class="app-data-acts">
                <span class="app-data-says" :class="(folder_problem(folder) === '') ? 'muted' : 'bad'">{{ folder_says(folder) }}</span>
            </div>
        </li>
        <li v-for="(item, index) of items" :key="item.id" class="app-data-item">
            <div class="app-data-what">
                <span class="app-data-kind">{{ KIND_WORDS[item.kind] }}</span>
                <span class="pill app-data-sketch-tag" title="Kept in this browser; nothing is made behind it yet">sketch</span>
                <select v-model="item.keep" aria-label="Where its documents are kept" @change="keep">
                    <option value="serviceman">documents kept by serviceman</option>
                </select>
                <button type="button" class="app-data-remove" :title="('Remove ' + title_of(item) + '; Undo brings it back')" @click="click_remove(index)">Remove</button>
            </div>
            <div class="app-data-var">
                <input v-if="runs" :value="item.env" class="app-data-env" :class="{bad: (env_taken(item.env, item) || (item.env === ''))}" spellcheck="false" autocomplete="off" aria-label="The variable it fills" @input="input_env_item(item, $event)" @change="keep">
                <code class="app-data-value"><span v-if="runs" class="muted">=&nbsp;</span>{{ value_of(item) }}</code>
            </div>
            <div class="app-data-acts">
                <button type="button" @click="click_copy(item)">{{ ((copied === item.id) ? 'Copied' : 'Copy') }}</button>
                <span class="app-data-says" :class="((env_taken(item.env, item) || (item.env === '')) ? 'bad' : 'muted')">{{ says_of(item) }}</span>
            </div>
        </li>
    </ul>
</div>
`,
    props: {
        app: {type: Object, required: true},
        // Where it opens, crm.localhost: what REST_URL is made of
        host: {type: String, required: true},
    },
    emits: ['new_database', 'saved'],
    data: function () {
        // picks and folders: its databases and its folders as its config has them; store: its
        // store for each user, {server}, or null; servers: the Databases page's, read when the tab
        // opens; removed: the row Remove took and where it was, for Undo; items: the sketch's
        // rows, this browser's
        const picks = (this.app.databases === undefined) ? [] : this.app.databases.map(v => Object.assign({}, v));
        const folders = (this.app.folders === undefined) ? [] : this.app.folders.map(v => Object.assign({}, v));
        const store = ((this.app.store === undefined) || (this.app.store === null)) ? null : {server: this.app.store.server};
        return {KIND_WORDS, picks, folders, store, servers: null, items: items_read(this.app.name), removed: null, saving: false, error: '', copied: ''};
    },
    computed: {
        kind: function () {
            return app_kind_of(this.app);
        },
        // It has a program to read a variable: every kind but a page
        runs: function () {
            return (this.kind !== 'page');
        },
        started: function () {
            return KINDS_STARTED.includes(this.kind);
        },
        // The machine it runs on, where it reaches a database
        machine: function () {
            return ((this.app.remotes === undefined) || (this.app.remotes.length === 0)) ? null : this.app.remotes[0];
        },
        // Adminer's own image, which opens on DATABASE_URL logged in (adminer_login_put)
        adminer: function () {
            return (typeof this.app.image === 'string') && /^(.*\/)?adminer(:[^/]*)?$/.test(this.app.image);
        },
        has_rest: function () {
            return this.items.some(v => v.kind === 'rest');
        },
        // The databases offered, by server: those on its own machine with a user serviceman
        // made; the others are shown, and say why they cannot be picked
        groups: function () {
            const out = [];
            for (const server of ((this.servers === null) ? [] : this.servers)) {
                const away = (server.remote !== this.machine);
                const options = server.databases.map(function (database) {
                    const why = away ? `, on ${server.title}` : ((database.user === null) ? ', made outside serviceman' : '');
                    return {key: `${server.name}/${database.name}`, label: `${database.name} · ${server.name}${why}`, disabled: (why !== '') || (server.phase !== 'up'), server, database};
                });
                if (options.length > 0) {
                    out.push({server: server.name, label: `${server.name} · ${engine_of(server).label} ${server.version} on ${server.title}`, options});
                }
            }
            return out;
        },
        // The first database it can pick and has not, or null when there is none
        pick_free: function () {
            if (this.started === false) {
                return null;
            }
            const taken = this.picks.map(v => this.key_of(v));
            const all = this.groups.flatMap(v => v.options);
            return all.find(v => (v.disabled === false) && (taken.includes(v.key) === false)) || null;
        },
        pick_title: function () {
            if (this.started === false) {
                return 'serviceman does not start it, so it hands it no database';
            }
            if (this.servers === null) {
                return 'reading the databases…';
            }
            if (this.pick_free === null) {
                return `No database on ${this.machine || 'its machine'} to pick: New database brings one up`;
            }
            return 'A database of the Databases page, handed to it at every start';
        },
        // The CouchDBs of the Databases page: a store for each user is one of them
        couches: function () {
            return ((this.servers === null) ? [] : this.servers).filter(v => v.engine === 'couchdb');
        },
        // The first CouchDB that is up, for + Store for each user; null with no wall to say who
        // the user is, or none up
        store_free: function () {
            if ((this.app.auth === null) || (this.app.auth === undefined)) {
                return null;
            }
            return this.couches.find(v => v.phase === 'up') || null;
        },
        store_title: function () {
            if (this.store !== null) {
                return 'It has a store for each user already';
            }
            if ((this.app.auth === null) || (this.app.auth === undefined)) {
                return 'A store for each user needs a wall in front of the app, to say who the user is: give it one in its Settings';
            }
            if (this.servers === null) {
                return 'reading the databases…';
            }
            if (this.store_free === null) {
                return 'No CouchDB is up: New database brings one up';
            }
            return 'A database of their own for each user its wall signs in, at /_couch on its own address';
        },
        // What stands in the store's way now, or ''
        store_problem: function () {
            if (this.store === null) {
                return '';
            }
            const server = this.couch_of(this.store.server);
            if ((this.app.auth === null) || (this.app.auth === undefined)) {
                return 'No wall in front of it to say who the user is: give it one in its Settings';
            }
            if ((server === null) && (this.servers !== null)) {
                return `${this.store.server} is not on Databases now`;
            }
            if ((server !== null) && (server.phase !== 'up')) {
                return `${this.store.server} is not up: see Databases`;
            }
            return '';
        },
        store_says: function () {
            if (this.store_problem !== '') {
                return this.store_problem;
            }
            const server = this.couch_of(this.store.server);
            const where = (server === null) ? 'its machine' : server.title;
            return `A database of their own for each user ${this.app.auth} signs in. The agent of ${where} answers it at its door, for a name of this app that comes in there.`;
        },
        // What becomes of every value, said once over the rows
        how: function () {
            if (this.runs === false) {
                return 'A page has no program to read a variable: it keeps its data through REST, at its own address.';
            }
            if (this.started) {
                return 'A database and a folder are handed to it at its next start, as their variables say. REST is a sketch for now, kept in this browser.';
            }
            return 'serviceman does not start it: it hands it no database and no folder.';
        },
        removed_title: function () {
            if (this.removed.kind === 'store') {
                return 'the store for each user';
            }
            if (this.removed.kind === 'pick') {
                return this.removed.row.database;
            }
            return (this.removed.kind === 'folder') ? 'the folder' : this.title_of(this.removed.row);
        },
    },
    mounted: function () {
        this.servers_read();
    },
    methods: {
        servers_read: async function () {
            try {
                const answer = await fetch('/api/v1/databases', {cache: 'no-store'});
                this.servers = (await answer.json()).servers;
            }
            catch {
                this.servers = [];
            }
        },
        click_database: function () {
            const free = this.pick_free;
            const env = app_data_env_free(this.picks.concat(this.folders, this.items).map(v => v.env), database_env_given(free.server.engine));
            this.picks.push({server: free.server.name, database: free.database.name, env});
            this.removed = null;
            this.picks_save();
        },
        // A folder kept for it, the first; one of its machine once its path is typed
        click_folder: function () {
            const env = app_data_env_free(this.picks.concat(this.folders, this.items).map(v => v.env), 'FILES_DIR');
            this.folders.push({path: null, env});
            this.removed = null;
            this.picks_save();
        },
        // Kept for it at once; one of its machine waits for its path
        change_from: function (folder, from) {
            folder.path = (from === 'kept') ? null : '';
            if (folder.path === null) {
                this.picks_save();
            }
        },
        change_path: function (folder, value) {
            folder.path = value;
            if (this.folder_problem(folder) === '') {
                this.picks_save();
            }
        },
        click_remove_folder: function (index) {
            this.removed = {kind: 'folder', row: this.folders[index], index};
            this.folders.splice(index, 1);
            this.picks_save();
        },
        click_store: function () {
            this.store = {server: this.store_free.name};
            this.removed = null;
            this.picks_save();
        },
        change_store: function (name) {
            this.store = {server: name};
            this.picks_save();
        },
        click_remove_store: function () {
            this.removed = {kind: 'store', row: this.store, index: 0};
            this.store = null;
            this.picks_save();
        },
        couch_of: function (name) {
            return this.couches.find(v => v.name === name) || null;
        },
        click_rest: function () {
            this.add({kind: 'rest', keep: 'serviceman', env: 'REST_URL'});
        },
        // A name it was given and not typed follows the kind of server picked: COUCHDB_URL for
        // a CouchDB, MONGODB_URL for a MongoDB, DATABASE_URL for the others
        change_pick: function (pick, key) {
            const at = key.indexOf('/');
            pick.server = key.slice(0, at);
            pick.database = key.slice(at + 1);
            const option = this.option_of(pick);
            if ((option !== null) && RE_ENV_GIVEN.test(pick.env) && (pick.env.startsWith(database_env_given(option.server.engine).replace(/_URL$/, '')) === false)) {
                pick.env = app_data_env_free(this.picks.concat(this.folders, this.items).filter(v => v !== pick).map(v => v.env), database_env_given(option.server.engine));
            }
            this.picks_save();
        },
        // A variable's name as an env takes it: letters, digits and _, upper case
        input_env: function (event) {
            event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        },
        input_env_item: function (item, event) {
            this.input_env(event);
            item.env = event.target.value;
        },
        // Kept once it is a name no other row fills; otherwise said, and kept as it was
        change_env: function (pick, value) {
            if ((value === '') || this.env_taken(value, pick)) {
                this.error = (value === '') ? 'A variable needs a name.' : `Another row fills ${value} already.`;
                return;
            }
            pick.env = value;
            this.picks_save();
        },
        click_remove_pick: function (index) {
            this.removed = {kind: 'pick', row: this.picks[index], index};
            this.picks.splice(index, 1);
            this.picks_save();
        },
        click_remove: function (index) {
            this.removed = {kind: 'item', row: this.items[index], index};
            this.items.splice(index, 1);
            this.keep();
        },
        click_undo: function () {
            if (this.removed.kind === 'store') {
                this.store = this.removed.row;
                this.removed = null;
                this.picks_save();
                return;
            }
            const list = {pick: this.picks, folder: this.folders, item: this.items}[this.removed.kind];
            list.splice(Math.min(this.removed.index, list.length), 0, this.removed.row);
            const kind = this.removed.kind;
            this.removed = null;
            if (kind === 'item') {
                this.keep();
            }
            else {
                this.picks_save();
            }
        },
        // Its databases, its folders and its store written into the app's config as they are now,
        // a folder of its machine whose path is not typed yet left out: the service as the config
        // has it, the three replaced, the way Settings writes it
        picks_save: async function () {
            this.saving = true;
            this.error = '';
            try {
                const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
                const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === this.app.name);
                if (entry === undefined) {
                    throw new Error(`${this.app.name} is not in the config any more`);
                }
                const service = Object.assign({}, entry, {
                    databases: this.picks.map(v => ({server: v.server, database: v.database, env: v.env})),
                    folders: this.folders.filter(v => v.path !== '').map(v => ({path: v.path, env: v.env})),
                });
                for (const key of ['databases', 'folders']) {
                    if (service[key].length === 0) {
                        delete service[key];
                    }
                }
                if (this.store === null) {
                    delete service.store;
                }
                else {
                    service.store = {server: this.store.server};
                }
                const answer = await fetch(`/api/v1/services/${encodeURIComponent(this.app.name)}`, {method: 'PUT', body: JSON.stringify({service})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                this.$emit('saved', this.app.name);
            }
            catch (error) {
                this.error = `Not kept: ${error.message}`;
            }
            finally {
                this.saving = false;
            }
        },
        click_copy: async function (item) {
            if (await to_clipboard(this.value_of(item))) {
                const self = this;
                this.copied = item.id;
                setTimeout(function () {
                    if (self.copied === item.id) {
                        self.copied = '';
                    }
                }, 1500);
            }
        },
        add: function (item) {
            const env = app_data_env_free(this.picks.concat(this.folders, this.items).map(v => v.env), item.env);
            this.items.push(Object.assign(item, {id: id_make(), env, env_own: false}));
            this.removed = null;
            this.keep();
        },
        keep: function () {
            storage_set(storage_name(this.app.name), JSON.stringify(this.items));
        },
        key_of: function (pick) {
            return `${pick.server}/${pick.database}`;
        },
        option_of: function (pick) {
            return this.groups.flatMap(v => v.options).find(v => v.key === this.key_of(pick)) || null;
        },
        // As the app finds it, its password left out: by the server's name on the databases'
        // network for an app in a container, on 127.0.0.1 at its port for a program on the machine
        url_of: function (pick) {
            const option = this.option_of(pick);
            if (option === null) {
                return `…://…:${DOTS}@…/${pick.database}`;
            }
            const engine = engine_of(option.server);
            const user = (option.database.user === null) ? '…' : option.database.user;
            const host = (this.app.runs_in === 'machine') ? `127.0.0.1:${option.server.port}` : `serviceman-db-${option.server.name}:${engine.port}`;
            if (option.server.engine === 'couchdb') {
                return `${engine.scheme}://${user}:${DOTS}@${host}`;
            }
            return `${engine.scheme}://${user}:${DOTS}@${host}/${pick.database}`;
        },
        // Why a pick will not reach the app as it is, or nothing; an Adminer with no wall is one,
        // and an Adminer given a MongoDB, which it does not speak
        pick_problem: function (pick) {
            const given = this.option_of(pick);
            if (this.adminer && (pick.env === 'DATABASE_URL') && (given !== null) && (given.server.engine === 'mongodb')) {
                return 'Adminer opens SQL databases, not MongoDB';
            }
            if (this.adminer && (pick.env === 'DATABASE_URL') && (this.app.auth === null) && (given !== null)) {
                return 'Adminer opens on it only behind a wall: pick one in Settings';
            }
            if ((pick.env === '') || this.env_taken(pick.env, pick)) {
                return 'another row fills this variable too: one of them is lost';
            }
            if (this.servers === null) {
                return '';
            }
            const option = this.option_of(pick);
            if (option === null) {
                return `${pick.server} has no ${pick.database} now: its next start stops with that reason`;
            }
            if (option.disabled) {
                return `${option.label}: its next start stops with that reason`;
            }
            return '';
        },
        // An Adminer opens on DATABASE_URL, logged in, for whoever its wall lets in, and lets
        // nobody in without one (src/main/adminer)
        pick_says: function (pick) {
            const problem = this.pick_problem(pick);
            if (problem !== '') {
                return problem;
            }
            if (this.adminer && (pick.env === 'DATABASE_URL')) {
                return (this.app.auth === null) ? 'Adminer opens on it only behind a wall: pick one in Settings' : `Adminer opens on it, logged in, for whoever ${this.app.auth} lets in`;
            }
            const option = this.option_of(pick);
            if ((option !== null) && (option.server.engine === 'couchdb')) {
                return `its admin, at every start, and ${secret_env(pick.env)}, the secret it trusts a signed user name by`;
            }
            return 'its own user and password, at every start';
        },
        env_taken: function (env, row) {
            return this.picks.concat(this.folders, this.items).some(v => (v !== row) && (v.env === env));
        },
        // As the app finds it: mounted at /data/files in a container, then /data/files-2; on
        // its machine, the folder's own path, the one kept for it in the agent's data/
        folder_value: function (folder, index) {
            const suffix = (index === 0) ? '' : `-${index + 1}`;
            if (this.app.runs_in === 'container') {
                return `/data/files${suffix}`;
            }
            if (folder.path === null) {
                return `~/serviceman-agent/data/${this.app.name}/files${suffix}`;
            }
            return (folder.path === '') ? '…' : folder.path;
        },
        // Why a folder will not reach the app as it is, or nothing: as the config refuses one
        folder_problem: function (folder) {
            if ((folder.env === '') || this.env_taken(folder.env, folder)) {
                return 'another row fills this variable too: one of them is lost';
            }
            if (folder.path === null) {
                return '';
            }
            if (folder.path === '') {
                return 'type its full path, like /srv/photos';
            }
            if ((folder.path.startsWith('/') === false) || folder.path.endsWith('/') || folder.path.includes('//') || /(^|\/)\.\.?(\/|$)/.test(folder.path)) {
                return 'a full path, like /srv/photos';
            }
            if (/^\/(bin|boot|dev|etc|lib|lib32|lib64|proc|run|sbin|sys|usr)(\/|$)|^\/var\/lib\/serviceman(\/|$)/.test(folder.path)) {
                return 'a folder of the system\'s own: it gets a folder of its own, like /srv/photos';
            }
            return '';
        },
        folder_says: function (folder) {
            const problem = this.folder_problem(folder);
            if (problem !== '') {
                return problem;
            }
            if (this.app.runs_in === 'container') {
                return (folder.path === null) ? 'kept for it on its machine, mounted at every start' : `${folder.path} of its machine, mounted at every start`;
            }
            return (folder.path === null) ? 'kept for it on its machine, made at its next start' : 'made at its next start when it is not there';
        },
        title_of: function () {
            return 'REST';
        },
        value_of: function (item) {
            return app_data_value(item, {name: this.app.name, kind: this.kind, host: this.host});
        },
        // What a row has to say of its own: a name left empty or given twice, in red; nothing
        // for the rest, as the line over the rows says it
        says_of: function (item) {
            if (this.runs && (item.env === '')) {
                return 'a variable needs a name';
            }
            if (this.runs && this.env_taken(item.env, item)) {
                return `another row fills ${item.env} too: one of them is lost`;
            }
            return '';
        },
    },
};

// A server's engine as its URL says it; one the page does not know is said by its own name
function engine_of(server)
{
    return ENGINES[server.engine] || {label: server.engine, scheme: server.engine, port: ''};
}

// The variable a CouchDB's secret comes in, beside its URL's (database_env.js says it the same)
function secret_env(env)
{
    return RE_URL_ENV.test(env) ? env.replace(RE_URL_ENV, '_SECRET$1') : `${env}_SECRET`;
}

// The name the sketch's rows of an app are kept under in this browser
function storage_name(name)
{
    return `serviceman.app_data.${name}`;
}

// The sketch's rows this browser kept for an app, REST alone; a database or a folder the sketch
// kept here before they were real is left out, and none when it kept something unreadable
function items_read(name)
{
    try {
        const kept = JSON.parse(storage_get(storage_name(name)));
        return Array.isArray(kept) ? kept.filter(v => v.kind === 'rest') : [];
    }
    catch {
        return [];
    }
}

function id_make()
{
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default app_data_tab;
