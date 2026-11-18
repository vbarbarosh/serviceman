import app_data_engines from './app_data_engines.js';
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

// An app's Data tab, in its Settings window: what the app is given, a row each, every row filling
// one variable of its env: a database of a kind and a version (DATABASE_URL, MONGO_URL), a folder
// (FILES_DIR), REST for its documents and files (REST_URL). A sketch for now: the rows are kept in
// this browser, under the app's name, and nothing is made behind them; the values are what
// serviceman would give. A row goes at once, with Undo in its place; a page, which has no program
// to read a variable, takes REST alone, at its own address.
const app_data_tab = {
    template: `
<div class="app-data">
    <p class="muted app-data-sketch">A sketch: kept in this browser, nothing is made yet.</p>
    <div class="app-data-adds">
        <button type="button" :disabled="(runs === false)" @click="click_database">+ Database</button>
        <button type="button" :disabled="(runs === false)" @click="click_folder">+ Folder</button>
        <button type="button" :disabled="has_rest" :title="(has_rest ? 'It has REST already' : '')" @click="click_rest">+ REST</button>
    </div>
    <p class="muted app-settings-says">{{ how }}</p>
    <p v-if="(removed !== null)" class="app-data-removed">Removed {{ title_of(removed.item) }} · <button type="button" class="link" @click="click_undo">Undo</button></p>
    <p v-if="(items.length === 0)" class="muted app-data-none">Nothing yet: each row fills one variable of {{ app.name }}.</p>
    <ul v-else class="app-data-list">
        <li v-for="(item, index) of items" :key="item.id" class="app-data-item">
            <div class="app-data-what">
                <span class="app-data-kind">{{ KIND_WORDS[item.kind] }}</span>
                <template v-if="(item.kind === 'database')">
                    <select :value="item.engine" aria-label="Its kind" @change="change_engine(item, $event.target.value)">
                        <option v-for="engine of engines" :key="engine.value" :value="engine.value">{{ engine.label }}</option>
                    </select>
                    <select v-model="item.version" aria-label="Its version" @change="keep">
                        <option v-for="version of engine_of(item).versions" :key="version" :value="version">{{ version }}</option>
                    </select>
                </template>
                <template v-else-if="(item.kind === 'folder')">
                    <select v-model="item.from" aria-label="Which folder" @change="keep">
                        <option value="kept">a folder kept for it</option>
                        <option value="machine">a folder of its machine</option>
                    </select>
                    <input v-if="(item.from === 'machine')" v-model.trim="item.path" class="app-data-path" placeholder="/srv/files" spellcheck="false" autocomplete="off" aria-label="The folder on its machine" @change="keep">
                </template>
                <select v-else v-model="item.keep" aria-label="Where its documents are kept" @change="keep">
                    <option value="serviceman">documents kept by serviceman</option>
                    <option v-for="mongo of mongos" :key="mongo.id" :value="mongo.id">documents kept in its {{ mongo.env }}</option>
                </select>
                <button type="button" class="app-data-remove" :title="('Remove ' + title_of(item) + '; Undo brings it back')" @click="click_remove(index)">Remove</button>
            </div>
            <div class="app-data-var">
                <input v-if="runs" :value="item.env" class="app-data-env" :class="{bad: (is_taken(item) || (item.env === ''))}" spellcheck="false" autocomplete="off" aria-label="The variable it fills" @input="input_env(item, $event)" @change="keep">
                <code class="app-data-value"><span v-if="runs" class="muted">=&nbsp;</span>{{ value_of(item, shown.includes(item.id)) }}</code>
            </div>
            <div class="app-data-acts">
                <button v-if="(item.kind === 'database')" type="button" @click="click_show_hide(item)">{{ (shown.includes(item.id) ? 'Hide' : 'Show') }}</button>
                <button type="button" @click="click_copy(item)">{{ ((copied === item.id) ? 'Copied' : 'Copy') }}</button>
                <button v-if="engine_of(item).adminer" type="button" disabled title="Adminer opens this database once serviceman makes it">Adminer</button>
                <span class="app-data-says" :class="((is_taken(item) || (item.env === '')) ? 'bad' : 'muted')">{{ says_of(item) }}</span>
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
    data: function () {
        // removed: the row Remove took, where it was, and the REST rows that kept their
        // documents in it, for Undo; shown: the rows whose password is shown in full
        return {KIND_WORDS, items: items_read(this.app.name), removed: null, shown: [], copied: ''};
    },
    computed: {
        kind: function () {
            return app_kind_of(this.app);
        },
        // It has a program to read a variable: every kind but a page
        runs: function () {
            return (this.kind !== 'page');
        },
        has_rest: function () {
            return this.items.some(v => v.kind === 'rest');
        },
        mongos: function () {
            return this.items.filter(v => (v.kind === 'database') && (v.engine === 'mongodb'));
        },
        engines: function () {
            return app_data_engines;
        },
        // What becomes of every value, said once over the rows
        how: function () {
            if (this.runs === false) {
                return 'A page has no program to read a variable: it keeps its data through REST, at its own address.';
            }
            if (KINDS_STARTED.includes(this.kind)) {
                return 'Each row fills one variable of its env, at every start.';
            }
            return 'serviceman does not start it: copy each value into it yourself.';
        },
    },
    methods: {
        click_database: function () {
            const engine = app_data_engines[0];
            this.add({kind: 'database', engine: engine.value, version: engine.versions[0], env: engine.env, env_own: false, secret: secret_make()});
        },
        click_folder: function () {
            this.add({kind: 'folder', from: 'kept', path: '', env: 'FILES_DIR', env_own: false});
        },
        click_rest: function () {
            this.add({kind: 'rest', keep: 'serviceman', env: 'REST_URL', env_own: false});
        },
        click_remove: function (index) {
            const item = this.items[index];
            const rests = this.items.filter(v => (v.kind === 'rest') && (v.keep === item.id));
            for (const rest of rests) {
                rest.keep = 'serviceman';
            }
            this.items.splice(index, 1);
            this.removed = {item, index, rests};
            this.keep();
        },
        click_undo: function () {
            const {item, index, rests} = this.removed;
            this.items.splice(Math.min(index, this.items.length), 0, item);
            for (const rest of rests) {
                rest.keep = item.id;
            }
            this.removed = null;
            this.keep();
        },
        click_show_hide: function (item) {
            this.shown = this.shown.includes(item.id) ? this.shown.filter(v => v !== item.id) : this.shown.concat([item.id]);
        },
        click_copy: async function (item) {
            if (await to_clipboard(this.value_of(item, true))) {
                const self = this;
                this.copied = item.id;
                setTimeout(function () {
                    if (self.copied === item.id) {
                        self.copied = '';
                    }
                }, 1500);
            }
        },
        // Another kind takes that kind's own variable, MONGO_URL for MongoDB, unless the name
        // was typed
        change_engine: function (item, value) {
            const engine = app_data_engines.find(v => v.value === value);
            item.engine = engine.value;
            item.version = engine.versions[0];
            if (item.env_own === false) {
                item.env = app_data_env_free(this.items.filter(v => v !== item).map(v => v.env), engine.env);
            }
            this.keep();
        },
        // A variable's name as an env takes it: letters, digits and _, upper case
        input_env: function (item, event) {
            const value = event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
            event.target.value = value;
            item.env = value;
            item.env_own = true;
        },
        add: function (item) {
            const env = app_data_env_free(this.items.map(v => v.env), item.env);
            this.items.push(Object.assign(item, {id: id_make(), env}));
            this.removed = null;
            this.keep();
        },
        keep: function () {
            storage_set(storage_name(this.app.name), JSON.stringify(this.items));
        },
        engine_of: function (item) {
            return app_data_engines.find(v => v.value === item.engine) || {versions: [], adminer: false};
        },
        title_of: function (item) {
            if (item.kind === 'database') {
                return `${this.engine_of(item).label} ${item.version}`;
            }
            return (item.kind === 'folder') ? 'the folder' : 'REST';
        },
        value_of: function (item, shown) {
            return app_data_value(item, {name: this.app.name, kind: this.kind, host: this.host}, shown);
        },
        is_taken: function (item) {
            return this.items.some(v => (v !== item) && (v.env === item.env));
        },
        // What a row has to say of its own: a name left empty or given twice, in red; a folder
        // mounted into an image; nothing for the rest, as the line over the rows says it
        says_of: function (item) {
            if (this.runs && (item.env === '')) {
                return 'a variable needs a name';
            }
            if (this.runs && this.is_taken(item)) {
                return `another row fills ${item.env} too: one of them is lost`;
            }
            if ((item.kind === 'folder') && (this.kind === 'docker image')) {
                return 'mounted there, inside the image';
            }
            return '';
        },
    },
};

// The name the rows of an app are kept under in this browser
function storage_name(name)
{
    return `serviceman.app_data.${name}`;
}

// The rows this browser kept for an app; none when it kept nothing or something unreadable
function items_read(name)
{
    try {
        const kept = JSON.parse(storage_get(storage_name(name)));
        return Array.isArray(kept) ? kept : [];
    }
    catch {
        return [];
    }
}

function id_make()
{
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// A database's password, 20 letters and digits, made once with its row
function secret_make()
{
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(20)), v => abc[v % abc.length]).join('');
}

export default app_data_tab;
