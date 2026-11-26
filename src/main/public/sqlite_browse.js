import data_browser from 'data_browser/data_browser.js';
import format_bytes from './format_bytes.js';
import format_ms_ago from './format_ms_ago.js';
import state_pill from './state_pill.js';

const FILE_ICON = '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><ellipse cx="12" cy="12.5" rx="3.5" ry="1.3"/><path d="M8.5 12.5v4c0 .7 1.6 1.3 3.5 1.3s3.5-.6 3.5-1.3v-4"/>';
const FOLDER_ICON = '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>';

// One SQLite file of a machine, browsed: the Data browser module on it, as a database's page has
// it, headed with the file in place of a database: its machine, its path, its size. Its machine's
// agent reads it, read only; the module's API is <api>/<file>/browse, the path one word of it.
// The table open is kept in the address, so a reload or a link opens it again. module-host
// shows it too, on a file of its own computer.
//
// Props
//     place   {page: 'file', remote, path, collection}: the machine's name, the file's path
//     view    the machine as the status has it, {name, title, phase}; null while not known
//     api     where the host mounts files' data: serviceman's /api/v1/remotes/<name>/sqlite
//
// Emits: place(place), another table; remote(name), its machine; folder(path), its folder in
// the machine's Files
const sqlite_browse = {
    template: `
<div class="db-browse">
    <div class="item-card db-browse-head">
        <div class="item-top">
            <span class="item-tile"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="FILE_ICON"/></span>
            <div class="item-what">
                <div class="item-name">
                    <h1>{{ name }}</h1>
                    <state-pill v-if="offline" tone="idle" text="offline"/>
                </div>
                <div class="item-line">
                    <span v-if="(about !== null)" class="tag">SQLite</span>
                    <span>on <button type="button" class="link" @click="$emit('remote', place.remote)">{{ title }}</button></span>
                    <code class="sqb-path">{{ place.path }}</code>
                    <span v-if="(about !== null)">{{ size_text }}</span>
                    <span v-if="(about !== null)" class="muted">read only, by its agent</span>
                </div>
            </div>
            <div class="item-acts">
                <button type="button" title="The folder it is in, in the machine's Files" @click="click_its_folder"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="FOLDER_ICON"/>Its folder</button>
            </div>
        </div>
    </div>
    <article v-if="(refusal !== '')"><div class="card card-body" role="status"><span class="bad sqb-refusal">{{ refusal }}</span></div></article>
    <data-browser v-else-if="(read || offline)" :base="base" :offline="offline" :collection="(place.collection || '')" engine="sqlite" @collection="collection_keep"/>
</div>
`,
    components: {'data-browser': data_browser, 'state-pill': state_pill},
    emits: ['folder', 'place', 'remote'],
    props: {
        place: {type: Object, required: true},
        view: {type: Object, default: null},
        api: {type: String, default: ''},
    },
    data: function () {
        // about: GET <base> as last read, {size, mtime_ms, …}, null before; refusal: why the
        // file is not read at all, as that read said it; read: it was asked, and the module
        // waits for it, so a file that is none is never asked for its tables
        return {about: null, refusal: '', read: false, FILE_ICON, FOLDER_ICON};
    },
    computed: {
        base: function () {
            const api = (this.api === '') ? `/api/v1/remotes/${encodeURIComponent(this.place.remote)}/sqlite` : this.api;
            return `${api}/${encodeURIComponent(this.place.path)}/browse`;
        },
        name: function () {
            return this.place.path.slice(this.place.path.lastIndexOf('/') + 1) || this.place.path;
        },
        title: function () {
            return ((this.view === null) || !this.view.title) ? this.place.remote : this.view.title;
        },
        offline: function () {
            return (this.view !== null) && (this.view.phase !== 'online');
        },
        size_text: function () {
            const changed = (this.about.mtime_ms === null) ? '' : `, changed ${format_ms_ago(Date.now() - this.about.mtime_ms)}`;
            return `${format_bytes(this.about.size)}${changed}`;
        },
    },
    watch: {
        base: function () {
            this.refresh();
        },
        offline: function (now) {
            if (now === false) {
                this.refresh();
            }
        },
    },
    mounted: function () {
        this.refresh();
    },
    methods: {
        // The file as its machine says it now: there, and how big, or why it is not read
        refresh: async function () {
            if (this.offline) {
                return;
            }
            try {
                const answer = await fetch(this.base, {cache: 'no-store'});
                const body = await answer.json();
                // A file locked for a moment is no refusal: the module says it, and reads again
                if ((answer.ok === false) && (answer.status !== 409)) {
                    this.about = null;
                    this.refusal = body.error || `serviceman answered ${answer.status}`;
                    return;
                }
                this.about = answer.ok ? body : null;
                this.refusal = '';
            }
            catch {
                // Read again when its machine is back, or the page is opened again; the module
                // says what it meets meanwhile
            }
            finally {
                this.read = true;
            }
        },
        click_its_folder: function () {
            const at = this.place.path.lastIndexOf('/');
            this.$emit('folder', (at <= 0) ? '/' : this.place.path.slice(0, at));
        },
        collection_keep: function (name) {
            if (name !== (this.place.collection || '')) {
                this.$emit('place', Object.assign({}, this.place, {collection: name}));
            }
        },
    },
};

export default sqlite_browse;
