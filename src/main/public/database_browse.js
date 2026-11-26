import browsed_engines from './browsed_engines.js';
import data_browser from 'data_browser/data_browser.js';
import database_rows from './database_rows.js';
import database_state from './database_state.js';
import state_pill from './state_pill.js';

const DATABASE_ICON = '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>';
// How often the server is read again, for its machine going away and coming back
const VIEW_EVERY_MS = 10000;

// One database's data, browsed: its head as its page has it, then the Data browser module on
// it, whose API is /api/v1/databases/<server>/<database>/browse. What it reads is read as the
// database's own user, the head says which. The collection open is kept in the address, so a
// reload or a link opens it again.
//
// Props
//     place   {page: 'browse', server, database, collection}
//     state   the status, unused yet: the pages under Databases are given it
//
// Emits: place(place), the database's page or another collection; remote(name), its machine
const database_browse = {
    template: `
<div class="db-browse">
    <div class="item-card db-browse-head">
        <div class="item-top">
            <span class="item-tile"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/></span>
            <div class="item-what">
                <div class="item-name">
                    <h1>{{ place.database }}</h1>
                    <state-pill v-if="(server !== null)" :tone="pill.tone" :text="pill.text"/>
                </div>
                <div v-if="(server !== null)" class="item-line">
                    <span class="tag">{{ engine_text }}</span>
                    <span>in {{ server.name }} on <button type="button" class="link" @click="$emit('remote', server.remote)">{{ server.title }}</button></span>
                    <span v-if="(user !== '')" class="muted">read as <code>{{ user }}</code>, its own user</span>
                </div>
            </div>
            <div class="item-acts">
                <button type="button" title="Its page: who is given it, how an app reaches it, where it is reached from" @click="page_open"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="DATABASE_ICON"/>Its page</button>
            </div>
        </div>
    </div>
    <div v-if="(refusal !== '')" class="card" role="status"><p class="card-body muted">{{ refusal }}</p></div>
    <data-browser v-else-if="(server !== null)" :base="base" :offline="offline" :collection="(place.collection || '')" :engine="server.engine" @collection="collection_keep"/>
</div>
`,
    components: {'data-browser': data_browser, 'state-pill': state_pill},
    emits: ['place', 'remote'],
    props: {
        place: {type: Object, required: true},
        state: {type: Object, default: null},
    },
    data: function () {
        // view: GET /api/v1/databases as last read, null before; the module waits for it, so
        // nothing is asked of a machine already known to be away
        return {view: null, timer: null, DATABASE_ICON};
    },
    computed: {
        base: function () {
            return `/api/v1/databases/${encodeURIComponent(this.place.server)}/${encodeURIComponent(this.place.database)}/browse`;
        },
        server: function () {
            return (this.view === null) ? null : (this.view.servers.find(v => v.name === this.place.server) || null);
        },
        engine_text: function () {
            return database_rows.engine_text(this.server, this.view.engines);
        },
        pill: function () {
            const said = database_state(this.server);
            return {tone: {running: 'run', failed: 'bad', starting: 'busy', stopping: 'busy'}[said.dot] || 'idle', text: said.word};
        },
        user: function () {
            const database = (this.server === null) ? undefined : this.server.databases.find(v => v.name === this.place.database);
            return ((database === undefined) || (typeof database.user !== 'string')) ? '' : database.user;
        },
        offline: function () {
            return (this.server !== null) && ((this.server.online === false) || (this.server.phase !== 'up'));
        },
        // Why its data is not read here: an engine the page does not read
        refusal: function () {
            if ((this.server === null) || browsed_engines.includes(this.server.engine)) {
                return '';
            }
            return `${this.engine_text}'s data is not browsed here: a MongoDB's, a PostgreSQL's and a MySQL's are.`;
        },
    },
    mounted: function () {
        this.view_tick();
        this.timer = setInterval(this.view_tick, VIEW_EVERY_MS);
    },
    beforeUnmount: function () {
        clearInterval(this.timer);
    },
    methods: {
        view_tick: async function () {
            const answer = await fetch('/api/v1/databases?live=0', {cache: 'no-store'}).then(v => v.json()).catch(() => null);
            if ((answer !== null) && Array.isArray(answer.servers)) {
                this.view = answer;
            }
        },
        page_open: function () {
            this.$emit('place', {page: 'database', server: this.place.server, database: this.place.database});
        },
        collection_keep: function (name) {
            if (name !== (this.place.collection || '')) {
                this.$emit('place', Object.assign({}, this.place, {collection: name}));
            }
        },
    },
};

export default database_browse;
