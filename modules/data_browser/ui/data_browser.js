import format_bytes from '../../format_bytes.js';
import format_count from '../../format_count.js';
import mongo_cell_of from './mongo_cell_of.js';
import mongo_text_of from './mongo_text_of.js';
import storage_get from '../../storage_get.js';
import storage_set from '../../storage_set.js';

// One database's data, for a web page: its collections down the left, and the open one's
// documents as a table or as JSON, a page at a time, found by a filter typed as the shell types
// it, in a sort, with the fields asked for, or made by a pipeline of stages. A click on a header
// sorts by it; a click on a row shows the document whole, as the shell writes it, with Copy. The
// last queries of each collection are kept in the browser, to run again. The host gives the API, a GET under one
// base (data_browser_serve), the colours and its usual classes: card, card-head, primary, link,
// muted, bad, spin, dt-window, dt-whole, dt-whole-head.
//
// Props
//     base        the module's API, as the host mounts it
//     offline     the database's machine is away: nothing to read
//     collection  the collection open, as the address says it; '' for none
//
// Emits: collection(name), each time one is opened, for the host to keep in its address

// An engine's words, where they differ from another's
const WORDS = {
    mongodb: {
        kinds: 'Collections',
        kind: 'collection',
        item: 'document',
        items: 'documents',
        filter: '{status: \'active\', at: {$gt: ISODate(\'2026-01-01\')}}',
        sort: '{at: -1}',
        fields: '{name: 1, status: 1}',
        pipeline: '[{$match: {status: \'active\'}}, {$group: {_id: \'$city\', n: {$sum: 1}}}]',
        none: 'No collection in it yet: MongoDB makes one at an app\'s first write to it.',
    },
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
            <h2>{{ words.kinds }}<span v-if="(collections !== null)" class="dbr-chip">{{ collections.length }}</span></h2>
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
                    <span v-else class="muted dbr-num">{{ (item.count === null) ? '' : format_count(item.count) }}</span>
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
                <h2 class="dbr-title">{{ open }}</h2>
                <span class="muted dbr-facts">{{ open_facts }}</span>
            </div>
            <form class="dbr-find" @submit.prevent="find">
                <div class="dbr-field">
                    <span class="dbr-modes" role="tablist" aria-label="How the documents are found">
                        <button type="button" role="tab" :aria-selected="((mode === 'find') ? 'true' : 'false')" :class="{on: (mode === 'find')}" title="A filter, and a sort and the fields under it" @click="mode = 'find'">Find</button>
                        <button type="button" role="tab" :aria-selected="((mode === 'aggregate') ? 'true' : 'false')" :class="{on: (mode === 'aggregate')}" title="A pipeline of stages: $match, $group, $sort, $lookup…" @click="mode = 'aggregate'">Aggregate</button>
                    </span>
                    <input v-if="(mode === 'find')" v-model="filter" class="dbr-code" type="text" :placeholder="words.filter" aria-label="Filter" spellcheck="false" autocomplete="off" autocapitalize="off">
                    <textarea v-else v-model="pipeline" class="dbr-code dbr-pipeline" rows="4" :placeholder="words.pipeline" aria-label="Pipeline" spellcheck="false" autocomplete="off" autocapitalize="off" @keydown.ctrl.enter.prevent="find" @keydown.meta.enter.prevent="find"/>
                </div>
                <div class="dbr-find-acts">
                    <button type="submit" class="primary" :disabled="offline" :title="((mode === 'find') ? '' : 'Ctrl+Enter in the pipeline runs it too')">{{ (mode === 'find') ? 'Find' : 'Run' }}</button>
                    <button v-if="asked_any" type="button" @click="reset">Reset</button>
                    <button v-if="(mode === 'find')" type="button" class="link" :aria-expanded="(options ? 'true' : 'false')" @click="options = !options">{{ options ? 'Hide sort and fields' : 'Sort and fields' }}</button>
                    <span v-if="(recent_shown.length > 0)" class="dbr-recent-wrap">
                        <button type="button" class="link" :aria-expanded="(recent_open ? 'true' : 'false')" @click="recent_open = (recent_open === false)">Recent ▾</button>
                        <span v-if="recent_open" class="dbr-recent" role="menu">
                            <button v-for="(item, index) of recent_shown" :key="index" type="button" role="menuitem" :title="recent_title(item)" @click="recent_run(item)"><span class="dbr-recent-mode">{{ (item.mode === 'find') ? 'find' : 'pipeline' }}</span><code>{{ recent_text(item) }}</code></button>
                        </span>
                    </span>
                </div>
                <template v-if="(options && (mode === 'find'))">
                    <label class="dbr-field">
                        <span>Sort</span>
                        <input v-model="sort" class="dbr-code" type="text" :placeholder="words.sort" spellcheck="false" autocomplete="off" autocapitalize="off">
                    </label>
                    <label class="dbr-field">
                        <span>Fields</span>
                        <input v-model="fields" class="dbr-code" type="text" :placeholder="words.fields" spellcheck="false" autocomplete="off" autocapitalize="off">
                    </label>
                </template>
            </form>
            <p v-if="(error !== '')" class="bad dbr-error" role="alert">{{ error }}</p>
            <div v-if="(page !== null)" class="dbr-bar">
                <span class="dbr-range"><span v-if="busy" class="spin"/>{{ range_text }}</span>
                <span v-if="page.cut" class="dbr-cut" title="A page carries 4 MB at most">the rest of this page is over 4 MB: Next shows it</span>
                <span class="muted dbr-took">{{ took_text }}</span>
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
                                <button type="button" :disabled="(asked.mode !== 'find')" :title="((asked.mode === 'find') ? ('Sort by ' + key) : 'A pipeline sorts with its own $sort')" @click="sort_by(key)">{{ key }}<span class="dbr-arrow">{{ sort_arrow(key) }}</span></button>
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
                    <button type="button" class="link" @click="picked = null">Close</button>
                </span>
            </div>
            <pre class="dbr-json">{{ picked_text }}</pre>
        </div>
    </div>
</article>
`,
    emits: ['collection'],
    props: {
        base: {type: String, required: true},
        offline: {type: Boolean, default: false},
        collection: {type: String, default: ''},
    },
    data: function () {
        // about: the database as the API heads it, {engine, database, …}, null until read
        // collections: its collections, null while they are read; open the one shown
        // mode: find or aggregate; filter, sort, fields, pipeline: as typed; asked: as last
        // found, for Reset and the pages
        // page: the documents found, {items, count, skip, limit, took_ms, cut} (a pipeline's
        // with more, whether a next page is there), null before; view: table or json
        // picked: the index on the page of the document shown whole, null for none
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
            SEARCH_FROM,
            LIMITS,
        };
    },
    computed: {
        words: function () {
            return WORDS[(this.about === null) ? 'mongodb' : this.about.engine] || WORDS.mongodb;
        },
        collections_shown: function () {
            const query = this.search.toLowerCase();
            return this.collections.filter(v => v.name.toLowerCase().includes(query));
        },
        open_item: function () {
            return (this.collections === null) ? null : (this.collections.find(v => v.name === this.open) || null);
        },
        // Its count, its size and its indexes, as MongoDB keeps them
        open_facts: function () {
            const item = this.open_item;
            if ((item === null) || (item.type === 'view')) {
                return (item === null) ? '' : 'a view';
            }
            const facts = [`${(item.count === null) ? 'many' : item.count.toLocaleString('en-US')} ${(item.count === 1) ? this.words.item : this.words.items}`];
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
            return mongo_text_of(this.page.items, true);
        },
        // The keys of the page's documents, as columns: _id first, then each in the order it
        // is first met
        keys: function () {
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
            return `found in ${this.page.took_ms} ms`;
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
                return `The pipeline makes no ${this.words.item} of ${this.open}.`;
            }
            if (this.asked.filter !== '') {
                return `No ${this.words.item} matches the filter.`;
            }
            return `${this.open} has no ${this.words.item} yet.`;
        },
        picked_item: function () {
            if ((this.picked === null) || (this.page === null)) {
                return null;
            }
            return (this.page.items[this.picked] === undefined) ? null : this.page.items[this.picked];
        },
        picked_name: function () {
            const id = this.picked_item._id;
            return (id === undefined) ? `A ${this.words.item}` : mongo_text_of(id, false);
        },
        picked_text: function () {
            return mongo_text_of(this.picked_item, true);
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
            if (index !== null) {
                this.$nextTick(function () {
                    if (this.$refs.picked_box !== undefined) {
                        this.$refs.picked_box.focus({preventScroll: true});
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
        format_count,
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
            const parts = [query.filter || '{}'].concat((query.sort === '') ? [] : [`sort ${query.sort}`], (query.fields === '') ? [] : [`fields ${query.fields}`]);
            return parts.join(' · ').replace(/\s+/g, ' ');
        },
        recent_title: function (query) {
            return (query.mode === 'aggregate') ? query.pipeline : [`filter ${query.filter || '{}'}`, `sort ${query.sort || 'as found'}`, `fields ${query.fields || 'all'}`].join('\n');
        },
        page_go: function (step) {
            const skip = (step < 0) ? Math.max(0, this.page.skip - this.page.limit) : this.next_skip;
            this.documents_read(skip);
        },
        // A header clicked: sorted by it, up; again, down; again, as found
        sort_by: function (key) {
            const name = RE_BARE_KEY.test(key) ? key : JSON.stringify(key);
            const direction = this.sort_direction(key);
            this.sort = '';
            if (direction === null) {
                this.sort = `{${name}: 1}`;
            }
            if (direction === 1) {
                this.sort = `{${name}: -1}`;
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
            const name = RE_BARE_KEY.test(key) ? key : JSON.stringify(key);
            if (this.asked.sort === `{${name}: 1}`) {
                return 1;
            }
            return (this.asked.sort === `{${name}: -1}`) ? -1 : null;
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
        cells_of: function (item) {
            return this.keys.map(v => Object.assign({key: v}, mongo_cell_of(item[v])));
        },
        collection_title: function (item) {
            if (item.type === 'view') {
                return `${item.name}: a view, its documents found by a pipeline`;
            }
            const count = (item.count === null) ? '' : `${item.count.toLocaleString('en-US')} ${(item.count === 1) ? this.words.item : this.words.items}`;
            return [item.name, count, (item.bytes === null) ? '' : format_bytes(item.bytes)].filter(v => v !== '').join(' · ');
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
