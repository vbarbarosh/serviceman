import app_data_env_free from './app_data_env_free.js';
import app_data_value from './app_data_value.js';
import app_kind_of from './app_kind_of.js';
import storage_get from './storage_get.js';
import storage_set from './storage_set.js';
import to_clipboard from './to_clipboard.js';

// What each kind of row is called on its card
const KIND_WORDS = {database: 'Database', folder: 'Folder', rest: 'REST'};

// The kinds of app serviceman starts itself, and so puts the variables in the env of
const KINDS_STARTED = ['app folder', 'docker image', 'program'];

// What every database URL shows of its password: the page never has it
const DOTS = '•'.repeat(8);

// Each engine as its URL says it and its servers are named: its scheme and its port inside
const ENGINES = {
    mysql: {label: 'MySQL', scheme: 'mysql', port: 3306},
    postgresql: {label: 'PostgreSQL', scheme: 'postgresql', port: 5432},
};

// An app's Data tab, in its Settings window: what the app is given, a row each, every row filling
// one variable of its env. A database is real: one of the Databases page, picked from a list,
// kept in the app's config and handed to it at every start as its own user's URL, which this
// page never sees whole. A folder (FILES_DIR) and REST (REST_URL) are a sketch for now, kept in
// this browser under the app's name. A row goes at once, with Undo in its place; a page, which
// has no program to read a variable, takes REST alone, at its own address.
const app_data_tab = {
    template: `
<div class="app-data">
    <div class="app-data-adds">
        <button type="button" :disabled="((pick_free === null) || saving)" :title="pick_title" @click="click_database">+ Database</button>
        <button type="button" :disabled="(runs === false)" @click="click_folder">+ Folder</button>
        <button type="button" :disabled="has_rest" :title="(has_rest ? 'It has REST already' : '')" @click="click_rest">+ REST</button>
    </div>
    <p class="muted app-settings-says">{{ how }}</p>
    <p v-if="(error !== '')" class="bad app-data-error">{{ error }}</p>
    <p v-if="(removed !== null)" class="app-data-removed">Removed {{ removed_title }} · <button type="button" class="link" :disabled="saving" @click="click_undo">Undo</button></p>
    <p v-if="((picks.length === 0) && (items.length === 0))" class="muted app-data-none">Nothing yet: each row fills one variable of {{ app.name }}.</p>
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
        <li v-for="(item, index) of items" :key="item.id" class="app-data-item">
            <div class="app-data-what">
                <span class="app-data-kind">{{ KIND_WORDS[item.kind] }}</span>
                <span class="pill app-data-sketch-tag" title="Kept in this browser; nothing is made behind it yet">sketch</span>
                <template v-if="(item.kind === 'folder')">
                    <select v-model="item.from" aria-label="Which folder" @change="keep">
                        <option value="kept">a folder kept for it</option>
                        <option value="machine">a folder of its machine</option>
                    </select>
                    <input v-if="(item.from === 'machine')" v-model.trim="item.path" class="app-data-path" placeholder="/srv/files" spellcheck="false" autocomplete="off" aria-label="The folder on its machine" @change="keep">
                </template>
                <select v-else v-model="item.keep" aria-label="Where its documents are kept" @change="keep">
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
    emits: ['saved'],
    data: function () {
        // picks: its databases as its config has them; servers: the Databases page's, read when
        // the tab opens; removed: the row Remove took and where it was, for Undo; items: the
        // sketch's rows, this browser's
        const picks = (this.app.databases === undefined) ? [] : this.app.databases.map(v => Object.assign({}, v));
        return {KIND_WORDS, picks, servers: null, items: items_read(this.app.name), removed: null, saving: false, error: '', copied: ''};
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
                return `No database on ${this.machine || 'its machine'} to pick: Databases brings one up`;
            }
            return 'A database of the Databases page, handed to it at every start';
        },
        // What becomes of every value, said once over the rows
        how: function () {
            if (this.runs === false) {
                return 'A page has no program to read a variable: it keeps its data through REST, at its own address.';
            }
            if (this.started) {
                return 'A database is handed to it at its next start, as its variable says. A folder and REST are a sketch for now, kept in this browser.';
            }
            return 'serviceman does not start it: copy each value into it yourself.';
        },
        removed_title: function () {
            return (this.removed.kind === 'pick') ? this.removed.row.database : this.title_of(this.removed.row);
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
            const env = app_data_env_free(this.picks.map(v => v.env).concat(this.items.map(v => v.env)), 'DATABASE_URL');
            this.picks.push({server: free.server.name, database: free.database.name, env});
            this.removed = null;
            this.picks_save();
        },
        click_folder: function () {
            this.add({kind: 'folder', from: 'kept', path: '', env: 'FILES_DIR'});
        },
        click_rest: function () {
            this.add({kind: 'rest', keep: 'serviceman', env: 'REST_URL'});
        },
        change_pick: function (pick, key) {
            const at = key.indexOf('/');
            pick.server = key.slice(0, at);
            pick.database = key.slice(at + 1);
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
            const list = (this.removed.kind === 'pick') ? this.picks : this.items;
            list.splice(Math.min(this.removed.index, list.length), 0, this.removed.row);
            const kind = this.removed.kind;
            this.removed = null;
            if (kind === 'pick') {
                this.picks_save();
            }
            else {
                this.keep();
            }
        },
        // The databases written into the app's config as they are now: the service as the
        // config has it, its databases replaced, the way Settings writes it
        picks_save: async function () {
            this.saving = true;
            this.error = '';
            try {
                const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
                const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === this.app.name);
                if (entry === undefined) {
                    throw new Error(`${this.app.name} is not in the config any more`);
                }
                const service = Object.assign({}, entry, {databases: this.picks.map(v => ({server: v.server, database: v.database, env: v.env}))});
                if (service.databases.length === 0) {
                    delete service.databases;
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
            const env = app_data_env_free(this.picks.map(v => v.env).concat(this.items.map(v => v.env)), item.env);
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
            return `${engine.scheme}://${user}:${DOTS}@${host}/${pick.database}`;
        },
        // Why a pick will not reach the app as it is, or nothing; an Adminer with no wall is one
        pick_problem: function (pick) {
            if (this.adminer && (pick.env === 'DATABASE_URL') && (this.app.auth === null) && (this.option_of(pick) !== null)) {
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
            return 'its own user and password, at every start';
        },
        env_taken: function (env, row) {
            return this.picks.some(v => (v !== row) && (v.env === env)) || this.items.some(v => (v !== row) && (v.env === env));
        },
        title_of: function (item) {
            return (item.kind === 'folder') ? 'the folder' : 'REST';
        },
        value_of: function (item) {
            return app_data_value(item, {name: this.app.name, kind: this.kind, host: this.host});
        },
        // What a row has to say of its own: a name left empty or given twice, in red; a folder
        // mounted into an image; nothing for the rest, as the line over the rows says it
        says_of: function (item) {
            if (this.runs && (item.env === '')) {
                return 'a variable needs a name';
            }
            if (this.runs && this.env_taken(item.env, item)) {
                return `another row fills ${item.env} too: one of them is lost`;
            }
            if ((item.kind === 'folder') && (this.kind === 'docker image')) {
                return 'mounted there, inside the image';
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

// The name the sketch's rows of an app are kept under in this browser
function storage_name(name)
{
    return `serviceman.app_data.${name}`;
}

// The sketch's rows this browser kept for an app, a folder or REST; a database the sketch kept
// here before databases were real is left out, and none when it kept something unreadable
function items_read(name)
{
    try {
        const kept = JSON.parse(storage_get(storage_name(name)));
        return Array.isArray(kept) ? kept.filter(v => ['folder', 'rest'].includes(v.kind)) : [];
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
