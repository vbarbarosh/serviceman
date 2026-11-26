import format_bytes from '../../format_bytes.js';
import format_count from '../../format_count.js';
import mongo_cell_of from './mongo_cell_of.js';
import mongo_text_of from './mongo_text_of.js';
import sql_cell_of from './sql_cell_of.js';
import sql_text_of from './sql_text_of.js';
import storage_get from '../../storage_get.js';
import storage_set from '../../storage_set.js';

// One database's data, for a web page: its collections down the left, and the open one's
// documents as a table or as JSON, a page at a time, found by a filter typed as the shell types
// it, in a sort, with the fields asked for, or made by a pipeline of stages. A click on a header
// sorts by it; a click on a row shows the document whole, as the shell writes it, with Copy. The
// last queries of each collection are kept in the browser, to run again. + Document adds one,
// typed as the shell types it; a document shown whole is edited or deleted from its window, a
// deletion asked before it is done. A view's documents and a pipeline's results are read alone.
// A SQL database (PostgreSQL, MySQL) is the same page in its own words: its tables and their
// rows, a condition after WHERE, an ORDER BY and the columns, and a SELECT of its own in Query;
// a row shown whole is its JSON, and its rows are read alone for now. The host gives the API, a
// GET under one base (data_browser_serve), the colours and its usual classes: card, card-head,
// primary, link, muted, bad, spin, dt-window, dt-whole, dt-whole-head.
//
// Props
//     base        the module's API, as the host mounts it
//     offline     the database's machine is away: nothing to read
//     collection  the collection open, as the address says it; '' for none
//     engine      the database's engine, when the host knows it, so the words are its own from
//                 the first paint; else the API's answer says it
//
// Emits: collection(name), each time one is opened, for the host to keep in its address

// An engine's words, where they differ from another's. A SQL engine's tables and rows stand for
// the collections and documents, a condition for the filter, a SELECT of its own for the
// pipeline; `quote` is how it quotes a name.
const SQL_WORDS = {
    sql: true,
    kinds: 'Tables',
    kind: 'table',
    item: 'row',
    Item: 'Row',
    items: 'rows',
    find_title: 'A condition, and the order and the columns under it',
    aggregate: 'Query',
    aggregate_title: 'A SELECT of your own: joins, GROUP BY, functions…',
    pipeline_word: 'query',
    Pipeline: 'Query',
    filter_label: 'Where',
    sort_label: 'Order by',
    fields_label: 'Columns',
    options: 'Order by and columns',
    filter: 'status = \'active\' AND joined > \'2025-06-01\'',
    sort: 'joined DESC',
    fields: 'name, email',
    sorts_own: 'A query sorts with its own ORDER BY',
    none: 'No table in it yet.',
};
const WORDS = {
    mongodb: {
        sql: false,
        kinds: 'Collections',
        kind: 'collection',
        item: 'document',
        Item: 'Document',
        items: 'documents',
        find_title: 'A filter, and a sort and the fields under it',
        aggregate: 'Aggregate',
        aggregate_title: 'A pipeline of stages: $match, $group, $sort, $lookup…',
        pipeline_word: 'pipeline',
        Pipeline: 'Pipeline',
        filter_label: 'Filter',
        sort_label: 'Sort',
        fields_label: 'Fields',
        options: 'Sort and fields',
        filter: '{status: \'active\', at: {$gt: ISODate(\'2026-01-01\')}}',
        sort: '{at: -1}',
        fields: '{name: 1, status: 1}',
        pipeline: '[{$match: {status: \'active\'}}, {$group: {_id: \'$city\', n: {$sum: 1}}}]',
        sorts_own: 'A pipeline sorts with its own $sort',
        none: 'No collection in it yet: MongoDB makes one at an app\'s first write to it.',
    },
    postgresql: Object.assign({quote: '"'}, SQL_WORDS),
    mysql: Object.assign({quote: '`'}, SQL_WORDS),
};
// A list longer than this gets a box to find a name in
const SEARCH_FROM = 10;
// How many a page shows, and how many queries are kept, in all and shown for one collection
const LIMITS = [20, 50, 100, 200];
const RECENT_KEPT = 50;
const RECENT_SHOWN = 10;
const RECENT_KEY = 'serviceman.data_browser.recent';
const RE_BARE_KEY = /^[A-Za-z_$][\w$]*$/;

const data_browser = {
    template: `
<article class="dbr">
    <aside class="card dbr-side">
        <div class="card-head">
            <h2><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>{{ words.kinds }}<span v-if="(collections !== null)" class="dbr-chip">{{ collections.length }}</span></h2>
            <button type="button" class="link" :disabled="(offline || (collections === null))" title="Read the list again" @click="collections_read">Refresh</button>
        </div>
        <input v-if="((collections !== null) && (collections.length > SEARCH_FROM))" v-model.trim="search" class="dbr-search" type="search" :placeholder="('Find a ' + words.kind)" spellcheck="false" :aria-label="('Find a ' + words.kind)">
        <p v-if="offline" class="muted dbr-say">Its machine is offline: the data is read again when it is back.</p>
        <p v-else-if="(collections_error !== '')" class="bad dbr-say">{{ collections_error }}</p>
        <p v-else-if="(collections === null)" class="muted dbr-say"><span class="spin"/>reading…</p>
        <p v-else-if="(collections.length === 0)" class="muted dbr-say">{{ words.none }}</p>
        <ul v-else class="dbr-list">
            <li v-for="item of collections_shown" :key="item.name">
                <button type="button" :class="{on: (item.name === open)}" :aria-current="((item.name === open) ? 'true' : null)" :title="collection_title(item)" @click="collection_open(item.name)">
                    <span class="dbr-name">{{ item.name }}</span>
                    <span v-if="(item.type === 'view')" class="tag">view</span>
                    <span v-else class="muted dbr-num">{{ count_short(item) }}</span>
                </button>
            </li>
        </ul>
    </aside>
    <section class="card dbr-main">
        <div v-if="(open === '')" class="dbr-pick muted">
            <template v-if="offline">Nothing is read while its machine is away.</template>
            <template v-else-if="((collections !== null) && (collections.length > 0))">Pick a {{ words.kind }} to see its {{ words.items }}.</template>
            <template v-else-if="(collections !== null)">No {{ words.kind }} to open.</template>
        </div>
        <template v-else>
            <div class="card-head">
                <h2 class="dbr-title"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>{{ open }}</h2>
                <span class="muted dbr-facts">{{ open_facts }}</span>
                <button v-if="changeable" type="button" class="dbr-add" :disabled="offline" :title="('Add a ' + words.item + ' to ' + open)" @click="add_open"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>{{ words.Item }}</button>
                <span v-else-if="(words.sql && (open_item !== null) && (open_item.type !== 'view'))" class="tag dbr-readonly" title="Its rows are added, edited and deleted here in a later step">read only for now</span>
            </div>
            <form class="dbr-find" @submit.prevent="find">
                <div class="dbr-field">
                    <span class="dbr-modes" role="tablist" :aria-label="('How the ' + words.items + ' are found')">
                        <button type="button" role="tab" :aria-selected="((mode === 'find') ? 'true' : 'false')" :class="{on: (mode === 'find')}" :title="words.find_title" @click="mode = 'find'">Find</button>
                        <button type="button" role="tab" :aria-selected="((mode === 'aggregate') ? 'true' : 'false')" :class="{on: (mode === 'aggregate')}" :title="words.aggregate_title" @click="mode = 'aggregate'">{{ words.aggregate }}</button>
                    </span>
                    <span v-if="(mode === 'find')" class="dbr-line">
                        <code v-if="words.sql" class="dbr-keyword" aria-hidden="true">WHERE</code>
                        <input v-model="filter" class="dbr-code" type="text" :placeholder="words.filter" :aria-label="words.filter_label" spellcheck="false" autocomplete="off" autocapitalize="off">
                    </span>
                    <textarea v-else v-model="pipeline" class="dbr-code dbr-pipeline" rows="4" :placeholder="pipeline_placeholder" :aria-label="words.Pipeline" spellcheck="false" autocomplete="off" autocapitalize="off" @keydown.ctrl.enter.prevent="find" @keydown.meta.enter.prevent="find"/>
                </div>
                <div class="dbr-find-acts">
                    <button type="submit" class="primary" :disabled="offline" :title="((mode === 'find') ? '' : ('Ctrl+Enter in the ' + words.pipeline_word + ' runs it too'))">{{ (mode === 'find') ? 'Find' : 'Run' }}</button>
                    <button v-if="asked_any" type="button" @click="reset">Reset</button>
                    <button v-if="(mode === 'find')" type="button" class="link" :aria-expanded="(options ? 'true' : 'false')" @click="options = !options">{{ options ? ('Hide ' + words.options.toLowerCase()) : words.options }}</button>
                    <span v-if="(recent_shown.length > 0)" class="dbr-recent-wrap">
                        <button type="button" class="link" :aria-expanded="(recent_open ? 'true' : 'false')" @click="recent_open = (recent_open === false)">Recent ▾</button>
                        <span v-if="recent_open" class="dbr-recent" role="menu">
                            <button v-for="(item, index) of recent_shown" :key="index" type="button" role="menuitem" :title="recent_title(item)" @click="recent_run(item)"><span class="dbr-recent-mode">{{ (item.mode === 'find') ? 'find' : words.pipeline_word }}</span><code>{{ recent_text(item) }}</code></button>
                        </span>
                    </span>
                </div>
                <template v-if="(options && (mode === 'find'))">
                    <label class="dbr-field">
                        <span>{{ words.sort_label }}</span>
                        <input v-model="sort" class="dbr-code" type="text" :placeholder="words.sort" spellcheck="false" autocomplete="off" autocapitalize="off">
                    </label>
                    <label class="dbr-field">
                        <span>{{ words.fields_label }}</span>
                        <input v-model="fields" class="dbr-code" type="text" :placeholder="words.fields" spellcheck="false" autocomplete="off" autocapitalize="off">
                    </label>
                </template>
            </form>
            <p v-if="(error !== '')" class="bad dbr-error" role="alert">{{ error }}</p>
            <div v-if="(page !== null)" class="dbr-bar">
                <span class="dbr-range"><span v-if="busy" class="spin"/>{{ range_text }}</span>
                <span v-if="page.cut" class="dbr-cut" title="A page carries 4 MB at most">the rest of this page is over 4 MB: Next shows it</span>
                <span class="muted dbr-took">{{ took_text }}</span>
                <span v-if="(said !== '')" class="dbr-said" role="status">{{ said }}</span>
                <span class="seg dbr-view" role="group" aria-label="Shown as">
                    <button type="button" :class="{on: (view === 'table')}" @click="view = 'table'">Table</button>
                    <button type="button" :class="{on: (view === 'json')}" @click="view = 'json'">JSON</button>
                </span>
                <select v-model.number="limit" class="dbr-limit" aria-label="How many a page shows" @change="documents_read(0)">
                    <option v-for="value of LIMITS" :key="value" :value="value">{{ value }} a page</option>
                </select>
                <span class="dbr-pager">
                    <button type="button" :disabled="(busy || (page.skip === 0))" aria-label="The page before" @click="page_go(-1)">‹</button>
                    <button type="button" :disabled="(busy || (next_skip === null))" aria-label="The next page" @click="page_go(1)">›</button>
                </span>
            </div>
            <p v-else-if="busy" class="muted dbr-say"><span class="spin"/>reading…</p>
            <pre v-if="((page !== null) && (page.items.length > 0) && (view === 'json'))" class="dbr-json dbr-page-json" :class="{dim: (busy || (error !== ''))}">{{ page_text }}</pre>
            <div v-else-if="((page !== null) && (page.items.length > 0))" class="dbr-room" :class="{dim: (busy || (error !== ''))}">
                <table class="dbr-table">
                    <thead>
                        <tr>
                            <th v-for="key of keys" :key="key" :aria-sort="sort_said(key)">
                                <button type="button" :disabled="(asked.mode !== 'find')" :title="((asked.mode === 'find') ? ('Sort by ' + key) : words.sorts_own)" @click="sort_by(key)">{{ key }}<span class="dbr-arrow">{{ sort_arrow(key) }}</span></button>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(item, index) of page.items" :key="index" tabindex="0" @click="picked = index" @keydown.enter.prevent="picked = index">
                            <td v-for="cell of cells_of(item)" :key="cell.key" :class="('dbr-' + cell.kind)" :title="cell.title"><span>{{ cell.text }}</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-else-if="((page !== null) && (page.skip === 0))" class="muted dbr-empty">{{ empty_text }}</p>
        </template>
    </section>
    <div v-if="(picked_item !== null)" class="dt-window" @click.self="picked = null">
        <div ref="picked_box" class="dt-whole dbr-doc" role="dialog" aria-modal="true" tabindex="-1" @keydown.esc="picked = null">
            <div class="dt-whole-head">
                <b class="dbr-doc-name">{{ picked_name }}</b>
                <span class="muted">{{ open }} · {{ (page.skip + picked + 1).toLocaleString('en-US') }} of {{ count_text }}</span>
                <span class="dbr-doc-acts">
                    <button type="button" :disabled="(picked === 0)" aria-label="The document before" @click="picked--">‹</button>
                    <button type="button" :disabled="(picked === (page.items.length - 1))" aria-label="The next document" @click="picked++">›</button>
                    <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
                    <button v-if="picked_changeable" type="button" :disabled="offline" @click="edit_open">Edit</button>
                    <button v-if="picked_changeable" type="button" :disabled="(offline || (deleting !== null))" @click="deleting = {busy: false, error: ''}">Delete</button>
                    <button type="button" class="link" @click="picked = null">Close</button>
                </span>
            </div>
            <div v-if="(deleting !== null)" class="dbr-confirm" role="alert">
                <span>Delete this {{ words.item }} from {{ open }}? It goes for good.</span>
                <span v-if="(deleting.error !== '')" class="bad">{{ deleting.error }}</span>
                <span class="dbr-confirm-acts">
                    <button type="button" :disabled="deleting.busy" @click="deleting = null">Cancel</button>
                    <button type="button" class="danger" :disabled="deleting.busy" @click="delete_save">Delete</button>
                </span>
            </div>
            <pre ref="picked_json" class="dbr-json" tabindex="0">{{ picked_text }}</pre>
        </div>
    </div>
    <!-- A document added or edited: the head and the foot stay, the text between them scrolls -->
    <div v-if="(editing !== null)" class="dt-window" @click.self="edit_close">
        <div class="dt-whole dbr-edit" role="dialog" aria-modal="true" :aria-label="edit_title" @keydown.esc="edit_close">
            <div class="dt-whole-head">
                <b class="dbr-doc-name">{{ edit_title }}</b>
                <span class="muted">{{ open }}</span>
                <button type="button" class="link" @click="edit_close">Close</button>
            </div>
            <textarea ref="edit_text" v-model="editing.text" class="dbr-code dbr-edit-text" wrap="off" :aria-label="edit_title" spellcheck="false" autocomplete="off" autocapitalize="off" :disabled="editing.busy" @keydown.ctrl.enter.prevent="edit_save" @keydown.meta.enter.prevent="edit_save"/>
            <p v-if="(editing.error !== '')" class="bad dbr-error" role="alert">{{ editing.error }}</p>
            <div class="dbr-edit-foot">
                <span class="muted">Typed as the shell types it: ObjectId('…'), ISODate('…'), NumberLong('…'). Ctrl+Enter {{ (editing.id === undefined) ? 'adds' : 'saves' }}.</span>
                <button type="button" :disabled="editing.busy" @click="edit_close">Cancel</button>
                <button type="button" class="primary" :disabled="(editing.busy || offline)" @click="edit_save">{{ (editing.id === undefined) ? 'Add' : 'Save' }}</button>
            </div>
        </div>
    </div>
</article>
`,
    emits: ['collection'],
    props: {
        base: {type: String, required: true},
        offline: {type: Boolean, default: false},
        collection: {type: String, default: ''},
        engine: {type: String, default: ''},
    },
    data: function () {
        // about: the database as the API heads it, {engine, database, …}, null until read
        // collections: its collections, null while they are read; open the one shown
        // mode: find or aggregate; filter, sort, fields, pipeline: as typed; asked: as last
        // found, for Reset and the pages
        // page: the documents found, {items, count, skip, limit, took_ms, cut} (a pipeline's
        // with more, whether a next page is there), null before; view: table or json
        // picked: the index on the page of the document shown whole, null for none
        // editing: a document added or edited, {id, text, busy, error}, id undefined when
        // added; deleting: the one shown whole asked to be deleted, {busy, error}; said: what
        // the last change did, under the page until the next query
        // recent: the last queries, of every collection, newest first, as kept in the browser
        return {
            about: null,
            collections: null,
            collections_error: '',
            search: '',
            open: '',
            filter: '',
            sort: '',
            fields: '',
            options: false,
            mode: 'find',
            pipeline: '',
            asked: {mode: 'find', filter: '', sort: '', fields: '', pipeline: ''},
            view: 'table',
            limit: 50,
            recent: [],
            recent_open: false,
            page: null,
            busy: false,
            error: '',
            picked: null,
            copied: false,
            editing: null,
            deleting: null,
            said: '',
            SEARCH_FROM,
            LIMITS,
        };
    },
    computed: {
        words: function () {
            const engine = (this.engine !== '') ? this.engine : ((this.about === null) ? 'mongodb' : this.about.engine);
            return WORDS[engine] || WORDS.mongodb;
        },
        // A SQL query box left empty reads the open table: it says so
        pipeline_placeholder: function () {
            return this.words.sql ? `SELECT * FROM ${this.name_quoted(this.open)}` : this.words.pipeline;
        },
        collections_shown: function () {
            const query = this.search.toLowerCase();
            return this.collections.filter(v => v.name.toLowerCase().includes(query));
        },
        open_item: function () {
            return (this.collections === null) ? null : (this.collections.find(v => v.name === this.open) || null);
        },
        // Its count, its size and its indexes, as its engine keeps them; a count it estimates
        // said so; a view has none, but a materialized one's
        open_facts: function () {
            const item = this.open_item;
            if ((item === null) || ((item.type === 'view') && (item.count === null))) {
                return (item === null) ? '' : 'a view';
            }
            const facts = [`${(item.type === 'view') ? 'a view · ' : ''}${this.count_long(item)} ${(item.count === 1) ? this.words.item : this.words.items}`];
            if (item.bytes !== null) {
                facts.push(format_bytes(item.bytes));
            }
            if (item.indexes !== null) {
                facts.push(`${item.indexes} ${(item.indexes === 1) ? 'index' : 'indexes'}`);
            }
            return facts.join(' · ');
        },
        asked_any: function () {
            const typed = [this.filter, this.sort, this.fields, this.pipeline];
            const found = [this.asked.filter, this.asked.sort, this.asked.fields, this.asked.pipeline];
            return typed.concat(found).some(v => v !== '');
        },
        // This collection's last queries, newest first
        recent_shown: function () {
            return this.recent.filter(v => (v.base === this.base) && (v.collection === this.open)).slice(0, RECENT_SHOWN);
        },
        page_text: function () {
            return this.words.sql ? sql_text_of(this.page.items.map(v => this.row_ordered(v)), true) : mongo_text_of(this.page.items, true);
        },
        // The keys of the page's documents, as columns: _id first, then each in the order it
        // is first met; a SQL page's columns, as its engine gave them
        keys: function () {
            if (Array.isArray(this.page.columns)) {
                return this.page.columns;
            }
            const met = [];
            for (const item of this.page.items) {
                for (const key of Object.keys(item)) {
                    if (met.includes(key) === false) {
                        met.push(key);
                    }
                }
            }
            return met.includes('_id') ? ['_id'].concat(met.filter(v => v !== '_id')) : met;
        },
        // How many there are in all: counted, or, for a pipeline's last page, as far as it goes
        count_text: function () {
            if (this.page.count !== null) {
                return this.page.count.toLocaleString('en-US');
            }
            return (this.page.more === false) ? (this.page.skip + this.page.items.length).toLocaleString('en-US') : 'many';
        },
        range_text: function () {
            if (this.page.items.length === 0) {
                return (this.page.skip === 0) ? `0 ${this.words.items}` : `none past ${this.page.skip.toLocaleString('en-US')}`;
            }
            return `${(this.page.skip + 1).toLocaleString('en-US')}–${(this.page.skip + this.page.items.length).toLocaleString('en-US')} of ${this.count_text}`;
        },
        took_text: function () {
            return (typeof this.page.took_ms === 'number') ? `found in ${this.page.took_ms} ms` : '';
        },
        // Where the next page begins; null when this one is the last
        next_skip: function () {
            const next = this.page.skip + this.page.items.length;
            if ((this.page.items.length === 0) || ((this.page.cut === false) && (this.page.items.length < this.page.limit))) {
                return null;
            }
            if (this.page.more !== undefined) {
                return this.page.more ? next : null;
            }
            return ((this.page.count !== null) && (next >= this.page.count)) ? null : next;
        },
        empty_text: function () {
            if (this.asked.mode === 'aggregate') {
                return this.words.sql ? 'The query gives no row.' : `The pipeline makes no ${this.words.item} of ${this.open}.`;
            }
            if (this.asked.filter !== '') {
                return `No ${this.words.item} matches the ${this.words.sql ? 'condition' : 'filter'}.`;
            }
            return `${this.open} has no ${this.words.item} yet.`;
        },
        picked_item: function () {
            if ((this.picked === null) || (this.page === null)) {
                return null;
            }
            return (this.page.items[this.picked] === undefined) ? null : this.page.items[this.picked];
        },
        // Its documents can be changed: a collection, not a view; a SQL table's rows are read
        // alone for now
        changeable: function () {
            return (this.words.sql === false) && (this.open_item !== null) && (this.open_item.type !== 'view');
        },
        // The document shown whole can be edited and deleted: one of the collection as found,
        // never a pipeline's result, which is no document of it
        picked_changeable: function () {
            return this.changeable && (this.asked.mode === 'find') && (this.picked_item !== null) && (this.picked_item._id !== undefined);
        },
        edit_title: function () {
            return (this.editing.id === undefined) ? `Add a ${this.words.item}` : `Edit ${mongo_text_of(this.editing.id, false)}`;
        },
        picked_name: function () {
            const id = this.picked_item._id;
            return ((id === undefined) || this.words.sql) ? `A ${this.words.item}` : mongo_text_of(id, false);
        },
        // The document as the shell writes it; a row as its JSON, its columns in order
        picked_text: function () {
            return this.words.sql ? sql_text_of(this.row_ordered(this.picked_item), true) : mongo_text_of(this.picked_item, true);
        },
    },
    watch: {
        base: function () {
            this.load();
        },
        offline: function (now) {
            if (now === false) {
                this.load();
            }
        },
        // The address went back to another collection
        collection: function (name) {
            if (name !== this.open) {
                this.collection_open(name);
            }
        },
        // A document shown whole is where the keys go: Esc puts it away
        picked: function (index) {
            this.copied = false;
            this.deleting = null;
            // The document takes the keys, so Page Down scrolls it; Esc reaches the window
            if (index !== null) {
                this.$nextTick(function () {
                    if (this.$refs.picked_json !== undefined) {
                        this.$refs.picked_json.focus({preventScroll: true});
                    }
                });
            }
        },
    },
    mounted: function () {
        this.recent_read();
        this.load();
    },
    methods: {
        load: function () {
            if (this.offline) {
                return;
            }
            this.about_read();
            this.collections_read();
            if (this.collection !== '') {
                this.collection_open(this.collection);
            }
        },
        about_read: async function () {
            const answer = await fetch(this.base, {cache: 'no-store'}).then(v => v.json()).catch(() => null);
            this.about = ((answer === null) || (answer.engine === undefined)) ? null : answer;
        },
        collections_read: async function () {
            this.collections_error = '';
            try {
                const answer = await fetch(`${this.base}/collections`, {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok === false) {
                    throw new Error(body.error || `serviceman answered ${answer.status}`);
                }
                this.collections = body.items;
            }
            catch (error) {
                this.collections = [];
                this.collections_error = error.message;
            }
        },
        collection_open: function (name) {
            this.open = name;
            this.filter = '';
            this.sort = '';
            this.fields = '';
            this.pipeline = '';
            this.asked = {mode: this.mode, filter: '', sort: '', fields: '', pipeline: ''};
            this.recent_open = false;
            this.page = null;
            this.picked = null;
            this.error = '';
            this.$emit('collection', name);
            if (name !== '') {
                this.documents_read(0);
            }
        },
        find: function () {
            this.said = '';
            this.asked = {mode: this.mode, filter: this.filter.trim(), sort: this.sort.trim(), fields: this.fields.trim(), pipeline: this.pipeline.trim()};
            this.documents_read(0);
        },
        reset: function () {
            this.filter = '';
            this.sort = '';
            this.fields = '';
            this.pipeline = '';
            this.find();
        },
        // The query that found a page, kept first among the last ones; one run again moves up,
        // one refused and an empty one are not kept
        recent_keep: function () {
            const asked = this.asked;
            const texts = (asked.mode === 'find') ? [asked.filter, asked.sort, asked.fields] : [asked.pipeline];
            if (texts.every(v => v === '')) {
                return;
            }
            const query = Object.assign({base: this.base, collection: this.open}, asked);
            const same = JSON.stringify(query);
            this.recent = [query].concat(this.recent.filter(v => JSON.stringify(v) !== same)).slice(0, RECENT_KEPT);
            storage_set(RECENT_KEY, JSON.stringify(this.recent));
        },
        recent_read: function () {
            try {
                const kept = JSON.parse(storage_get(RECENT_KEY) || '[]');
                this.recent = Array.isArray(kept) ? kept.filter(v => (v !== null) && (typeof v === 'object') && (typeof v.mode === 'string')) : [];
            }
            catch {
                this.recent = [];
            }
        },
        recent_run: function (query) {
            this.mode = query.mode;
            this.filter = query.filter || '';
            this.sort = query.sort || '';
            this.fields = query.fields || '';
            this.pipeline = query.pipeline || '';
            this.options = (this.sort !== '') || (this.fields !== '');
            this.recent_open = false;
            this.find();
        },
        // A query on one line, for the list of the last ones
        recent_text: function (query) {
            if (query.mode === 'aggregate') {
                return query.pipeline.replace(/\s+/g, ' ');
            }
            const words = this.words;
            const filter = words.sql ? ((query.filter === '') ? 'all rows' : `WHERE ${query.filter}`) : (query.filter || '{}');
            const parts = [filter].concat((query.sort === '') ? [] : [`${words.sort_label.toLowerCase()} ${query.sort}`], (query.fields === '') ? [] : [`${words.fields_label.toLowerCase()} ${query.fields}`]);
            return parts.join(' · ').replace(/\s+/g, ' ');
        },
        recent_title: function (query) {
            const words = this.words;
            if (query.mode === 'aggregate') {
                return query.pipeline;
            }
            const filter = words.sql ? ((query.filter === '') ? 'all rows' : `WHERE ${query.filter}`) : `filter ${query.filter || '{}'}`;
            return [filter, `${words.sort_label.toLowerCase()} ${query.sort || 'as found'}`, `${words.fields_label.toLowerCase()} ${query.fields || 'all'}`].join('\n');
        },
        page_go: function (step) {
            const skip = (step < 0) ? Math.max(0, this.page.skip - this.page.limit) : this.next_skip;
            this.documents_read(skip);
        },
        // A header clicked: sorted by it, up; again, down; again, as found
        sort_by: function (key) {
            const texts = this.sort_texts(key);
            const direction = this.sort_direction(key);
            this.sort = '';
            if (direction === null) {
                this.sort = texts.up;
            }
            if (direction === 1) {
                this.sort = texts.down;
            }
            this.find();
        },
        sort_arrow: function (key) {
            const direction = this.sort_direction(key);
            if (direction === null) {
                return '';
            }
            return (direction === 1) ? ' ↑' : ' ↓';
        },
        sort_said: function (key) {
            const direction = this.sort_direction(key);
            if (direction === null) {
                return null;
            }
            return (direction === 1) ? 'ascending' : 'descending';
        },
        // 1 or -1 when the documents are sorted by this key alone, as a header click sorts
        sort_direction: function (key) {
            const texts = this.sort_texts(key);
            if (this.asked.sort === texts.up) {
                return 1;
            }
            return (this.asked.sort === texts.down) ? -1 : null;
        },
        // The sorts a header click types, up and down: `{name: 1}`, or a SQL engine's ORDER BY
        // of the column, its name quoted
        sort_texts: function (key) {
            if (this.words.sql) {
                const name = this.name_quoted(key);
                return {up: `${name} ASC`, down: `${name} DESC`};
            }
            const name = RE_BARE_KEY.test(key) ? key : JSON.stringify(key);
            return {up: `{${name}: 1}`, down: `{${name}: -1}`};
        },
        // A page of the open collection, found as last asked: a find's filter, sort and fields,
        // or a pipeline
        documents_read: async function (skip) {
            const name = this.open;
            const asked = this.asked;
            const texts = (asked.mode === 'aggregate') ? {pipeline: asked.pipeline} : {filter: asked.filter, sort: asked.sort, fields: asked.fields};
            const query = new URLSearchParams(Object.assign({collection: name}, texts, {skip: String(skip), limit: String(this.limit)}));
            const door = (asked.mode === 'aggregate') ? 'aggregate' : 'documents';
            this.busy = true;
            this.error = '';
            try {
                const answer = await fetch(`${this.base}/${door}?${query}`, {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok === false) {
                    throw new Error(body.error || `serviceman answered ${answer.status}`);
                }
                // Another collection opened meanwhile: this answer is not for it
                if (name === this.open) {
                    this.page = body;
                    this.picked = null;
                    if (skip === 0) {
                        this.recent_keep();
                    }
                }
            }
            catch (error) {
                if (name === this.open) {
                    this.error = error.message;
                }
            }
            finally {
                this.busy = false;
            }
        },
        add_open: function () {
            this.editing = {id: undefined, text: '{\n    \n}', busy: false, error: ''};
            this.edit_focus();
        },
        // Edit: the document read again whole by its _id, since a page may show some of its
        // fields alone, and saving those would drop the rest
        edit_open: async function () {
            const id = this.picked_item._id;
            this.picked = null;
            this.editing = {id, text: '', busy: true, error: ''};
            const query = new URLSearchParams({collection: this.open, filter: `{_id: ${mongo_text_of(id, false)}}`, limit: '1'});
            try {
                const body = await this.api('GET', `documents?${query}`);
                if (body.items.length === 0) {
                    throw new Error('it is not there any more: deleted since the page was read');
                }
                this.editing.text = mongo_text_of(body.items[0], true);
            }
            catch (error) {
                this.editing.error = error.message;
            }
            this.editing.busy = false;
            this.edit_focus();
        },
        edit_focus: function () {
            this.$nextTick(function () {
                if (this.$refs.edit_text !== undefined) {
                    this.$refs.edit_text.focus({preventScroll: true});
                }
            });
        },
        edit_close: function () {
            if ((this.editing !== null) && (this.editing.busy === false)) {
                this.editing = null;
            }
        },
        edit_save: async function () {
            const editing = this.editing;
            const added = (editing.id === undefined);
            editing.busy = true;
            editing.error = '';
            try {
                const body = added ? {collection: this.open, document: editing.text} : {collection: this.open, id: editing.id, document: editing.text};
                const done = await this.api('POST', added ? 'documents' : 'documents/replace', body);
                this.editing = null;
                this.changed(added ? `Added ${mongo_text_of(done.id, false)}` : `Saved ${mongo_text_of(done.id, false)}`);
            }
            catch (error) {
                editing.busy = false;
                editing.error = error.message;
            }
        },
        delete_save: async function () {
            const deleting = this.deleting;
            deleting.busy = true;
            deleting.error = '';
            try {
                const done = await this.api('POST', 'documents/delete', {collection: this.open, id: this.picked_item._id});
                this.picked = null;
                this.changed(`Deleted ${mongo_text_of(done.id, false)}`);
            }
            catch (error) {
                deleting.busy = false;
                deleting.error = error.message;
            }
        },
        // A change made: said under the page, the page and the counts read again
        changed: function (said) {
            this.said = said;
            this.collections_read();
            this.documents_read((this.page === null) ? 0 : this.page.skip);
        },
        // The module's API: its answer, or what it refused, thrown
        api: async function (method, door, body) {
            const answer = await fetch(`${this.base}/${door}`, {method, cache: 'no-store', body: (body === undefined) ? undefined : JSON.stringify(body)});
            const out = await answer.json().catch(() => ({}));
            if (answer.ok === false) {
                throw new Error(out.error || `serviceman answered ${answer.status}`);
            }
            return out;
        },
        cells_of: function (item) {
            const cell_of = this.words.sql ? sql_cell_of : mongo_cell_of;
            return this.keys.map(v => Object.assign({key: v}, cell_of(item[v])));
        },
        // A row with its columns in their order, which its object does not keep for a name
        // that is a number
        row_ordered: function (item) {
            return new Map(this.keys.map(v => [v, item[v]]));
        },
        // A name as the SQL engine quotes it; a PostgreSQL table of another schema than public
        // named schema.table, each quoted
        name_quoted: function (name) {
            const quote = this.words.quote;
            const parts = ((quote === '"') && name.includes('.')) ? [name.slice(0, name.indexOf('.')), name.slice(name.indexOf('.') + 1)] : [name];
            return parts.map(v => `${quote}${v.split(quote).join(quote + quote)}${quote}`).join('.');
        },
        // A collection's count at a glance, ~ before one its engine estimates
        count_short: function (item) {
            if (item.count === null) {
                return '';
            }
            return `${item.estimated ? '~' : ''}${format_count(item.count)}`;
        },
        count_long: function (item) {
            if (item.count === null) {
                return 'many';
            }
            return `${item.estimated ? 'about ' : ''}${item.count.toLocaleString('en-US')}`;
        },
        collection_title: function (item) {
            if ((item.type === 'view') && (item.count === null)) {
                return this.words.sql ? `${item.name}: a view, its rows found by a query` : `${item.name}: a view, its documents found by a pipeline`;
            }
            const count = (item.count === null) ? '' : `${this.count_long(item)} ${(item.count === 1) ? this.words.item : this.words.items}${item.estimated ? ', as its engine estimates them' : ''}`;
            return [item.name, (item.type === 'view') ? 'a view' : '', count, (item.bytes === null) ? '' : format_bytes(item.bytes)].filter(v => v !== '').join(' · ');
        },
        copy: async function () {
            try {
                await navigator.clipboard.writeText(this.picked_text);
                this.copied = true;
            }
            catch {
                this.copied = false;
            }
        },
    },
};

export default data_browser;
