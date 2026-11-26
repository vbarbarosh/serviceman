import format_bytes from '../../format_bytes.js';
import format_count from '../../format_count.js';
import mongo_cell_of from './mongo_cell_of.js';
import mongo_text_of from './mongo_text_of.js';

// One database's data, for a web page: its collections down the left, and the open one's
// documents as a table, a page at a time, found by a filter typed as the shell types it, in a
// sort, with the fields asked for. A click on a header sorts by it; a click on a row shows the
// document whole, as the shell writes it, with Copy. The host gives the API, a GET under one
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
        none: 'No collection in it yet: MongoDB makes one at an app\'s first write to it.',
    },
};
// A list longer than this gets a box to find a name in
const SEARCH_FROM = 10;
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
                <label class="dbr-field">
                    <span>Filter</span>
                    <input v-model="filter" class="dbr-code" type="text" :placeholder="words.filter" spellcheck="false" autocomplete="off" autocapitalize="off">
                </label>
                <div class="dbr-find-acts">
                    <button type="submit" class="primary" :disabled="offline">Find</button>
                    <button v-if="asked_any" type="button" @click="reset">Reset</button>
                    <button type="button" class="link" :aria-expanded="(options ? 'true' : 'false')" @click="options = !options">{{ options ? 'Hide sort and fields' : 'Sort and fields' }}</button>
                </div>
                <template v-if="options">
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
                <span class="dbr-pager">
                    <button type="button" :disabled="(busy || (page.skip === 0))" aria-label="The page before" @click="page_go(-1)">‹</button>
                    <button type="button" :disabled="(busy || (next_skip === null))" aria-label="The next page" @click="page_go(1)">›</button>
                </span>
            </div>
            <p v-else-if="busy" class="muted dbr-say"><span class="spin"/>reading…</p>
            <div v-if="((page !== null) && (page.items.length > 0))" class="dbr-room" :class="{dim: (busy || (error !== ''))}">
                <table class="dbr-table">
                    <thead>
                        <tr>
                            <th v-for="key of keys" :key="key" :aria-sort="sort_said(key)">
                                <button type="button" :title="('Sort by ' + key)" @click="sort_by(key)">{{ key }}<span class="dbr-arrow">{{ sort_arrow(key) }}</span></button>
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
        // filter, sort, fields: as typed; asked: as last found, for Reset and the pages
        // page: the documents found, {items, count, skip, limit, took_ms, cut}, null before
        // picked: the index on the page of the document shown whole, null for none
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
            asked: {filter: '', sort: '', fields: ''},
            page: null,
            busy: false,
            error: '',
            picked: null,
            copied: false,
            SEARCH_FROM,
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
            return (this.asked.filter !== '') || (this.asked.sort !== '') || (this.asked.fields !== '') || (this.filter !== '') || (this.sort !== '') || (this.fields !== '');
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
        count_text: function () {
            return (this.page.count === null) ? 'many' : this.page.count.toLocaleString('en-US');
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
            return ((this.page.count !== null) && (next >= this.page.count)) ? null : next;
        },
        empty_text: function () {
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
            this.asked = {filter: '', sort: '', fields: ''};
            this.page = null;
            this.picked = null;
            this.error = '';
            this.$emit('collection', name);
            if (name !== '') {
                this.documents_read(0);
            }
        },
        find: function () {
            this.asked = {filter: this.filter.trim(), sort: this.sort.trim(), fields: this.fields.trim()};
            this.documents_read(0);
        },
        reset: function () {
            this.filter = '';
            this.sort = '';
            this.fields = '';
            this.find();
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
        documents_read: async function (skip) {
            const name = this.open;
            const query = new URLSearchParams({collection: name, filter: this.asked.filter, sort: this.asked.sort, fields: this.asked.fields, skip: String(skip)});
            this.busy = true;
            this.error = '';
            try {
                const answer = await fetch(`${this.base}/documents?${query}`, {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok === false) {
                    throw new Error(body.error || `serviceman answered ${answer.status}`);
                }
                // Another collection opened meanwhile: this answer is not for it
                if (name === this.open) {
                    this.page = body;
                    this.picked = null;
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
