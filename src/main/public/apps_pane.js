import app_files_pick from './app_files_pick.js';
import app_settings from './app_settings.js';
import format_bytes from './format_bytes.js';
import zip_blob from './zip_blob.js';
import zip_entries from './zip_entries.js';

// A page of its own, given as one file: 2.html, notes.htm
const RE_PAGE = /\.html?$/i;

// What a cell says of its app's state, in a visitor's words
const STATE_WORDS = {running: 'running', starting: 'starting', stopping: 'stopping', failed: 'failed', lost: 'its machine went', stopped: 'asleep'};

// The small apps: the ones of files serviceman serves, and the ones that run from a folder of their
// own (bin/run), wherever that is; and a card to give it one more: a zip, a folder or one .html
// page dropped on it (or picked) goes to serviceman under the name of the file, and the card
// answers with the link that opens it. A name serviceman has already is that app's new version.
// Simple enough for anybody: drop, then click the link. Each app's cell opens it, takes a new
// version of it dropped on it or picked from it whatever the file is called (an app of its own
// folder takes a zip or a folder, and keeps its data/), and opens its settings in a small window
// over the page: its name and its public addresses.
const apps_pane = {
    template: `
<section class="apps-pane">
    <div class="list-head">
        <h1>Apps <span class="muted">{{ apps.length }}</span></h1>
    </div>
    <p class="muted">Small apps: a page serviceman serves, or an app that runs from its own folder. Drop a zip, a folder or one .html page here and it answers at an address of its own at once; dropped on an app's card, it is that app's new version.</p>
    <div class="app-drop" :class="{over: dragging, busy: sending}" role="button" tabindex="0" @click="pick_for(null)" @keyup.enter="pick_for(null)" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="dropped">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M11 5v2M11 9v2M11 13v2"/></svg>
        <b>Drop a .zip, a folder or an .html page here</b>
        <span class="muted">or click to pick a .zip or a page · a zip or a folder has its index.html at the top</span>
    </div>
    <!-- Outside the card: a click on it bubbles, and the card's own click would take the pick
         for a new app when an app's New version asked for it -->
    <input ref="zip" type="file" accept=".zip,application/zip,.html,.htm,text/html" hidden @change="picked">
    <div v-if="(sent !== null)" class="card app-sent" :class="{bad: (sent.error !== '')}">
        <p v-if="sent.busy" class="muted"><span class="spin"/>{{ sent.name }}: {{ (sent.doing ? sent.doing : 'sending ' + format_bytes(sent.bytes)) }}…</p>
        <p v-else-if="(sent.error !== '')" class="bad">{{ sent.error }}</p>
        <template v-else>
            <p class="app-sent-head"><span class="dot running"></span><b>{{ sent.name }}</b> {{ sent.made ? 'is ready' : 'has its new version' }}</p>
            <p class="app-sent-link"><a :href="sent.link" target="_blank" rel="noopener">{{ sent.link }}</a><a class="button primary" :href="sent.link" target="_blank" rel="noopener">Open</a></p>
            <p v-if="((sent.other !== '') && names_on)" class="muted">and on this computer: <a :href="sent.other" target="_blank" rel="noopener">{{ sent.other }}</a></p>
            <p v-else-if="(sent.other !== '')" class="muted">its name outside, once your tailnet or a machine's door answers it: <code>{{ sent.other }}</code></p>
        </template>
    </div>
    <ul v-if="(apps.length > 0)" class="app-cells">
        <li v-for="app of apps" :key="app.name" :class="{over: (over === app.name)}" @dragover.prevent="over = app.name" @dragleave="dragged_off($event, app)" @drop.prevent.stop="dropped_on($event, app)">
            <a class="app-cell" :href="link_of(app)" target="_blank" rel="noopener" :title="((app.title || app.name) + ' · ' + host_of(app))">
                <span class="app-tile" :style="{'--hue': hue_of(app.name)}">{{ letter_of(app) }}</span>
                <b>{{ app.title || app.name }}</b>
                <span class="muted app-host">{{ host_of(app) }}</span>
                <span class="muted"><span class="dot" :class="app.phase"></span>{{ STATE_WORDS[app.phase] || app.phase }}</span>
            </a>
            <div class="app-acts">
                <button type="button" :disabled="sending" :title="version_title(app)" @click="pick_for(app.name)">New version…</button>
                <button type="button" :title="('The name and the public address of ' + app.name)" @click="settings = app">Settings</button>
            </div>
        </li>
    </ul>
    <p v-else class="muted">No app yet: the first one dropped above lands here.</p>
    <app-settings v-if="(settings !== null)" :app="settings" :host="host_of(settings)" :remotes="state.remotes" :names="state.services.map(v => v.name)" @close="settings = null" @saved="$emit('saved')" @more="more"/>
</section>
`,
    components: {'app-settings': app_settings},
    emits: ['select', 'saved'],
    props: {
        state: {type: Object, required: true},
    },
    data: function () {
        // sent: the last zip given, {name, bytes, busy, error, made, link, other}; over: the
        // app a drop is over; target: the app a pick is for, null for a new one; settings: the
        // app whose settings window is open, as it was when it opened
        return {dragging: false, over: null, target: null, sent: null, settings: null, STATE_WORDS};
    },
    computed: {
        sending: function () {
            return (this.sent !== null) && this.sent.busy;
        },
        apps: function () {
            return this.state.services.filter(v => (v.type === 'files') || (v.app_folder !== null)).slice().sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
        },
        domain: function () {
            return ((this.state.apps === undefined) || (this.state.apps === null)) ? null : this.state.apps.domain;
        },
        // Whether serviceman answers the apps' names on the tailnet (apps.dns): their names under
        // the domain then open on every device of it, on serviceman's own port
        names_on: function () {
            return (this.domain !== null) && (this.state.apps.dns !== null) && (this.state.apps.dns !== undefined);
        },
    },
    methods: {
        format_bytes: function (bytes) {
            return format_bytes(bytes);
        },
        version_title: function (app) {
            if (app.app_folder !== null) {
                return `A new version of ${app.name}: pick its .zip, or drop its zip or its folder on this card; its data/ stays as it is`;
            }
            return `A new version of ${app.name}: pick its .zip or its .html page, or drop a zip, a folder or a page on this card`;
        },
        // Its service page, from the settings window's foot
        more: function (name) {
            this.settings = null;
            this.$emit('select', name);
        },
        // The name it opens on: its name under the apps domain where the tailnet answers it,
        // and otherwise the one on serviceman's own door here
        host_of: function (app) {
            const hosts = app.publish.hosts.map(v => v.split('/')[0]);
            const suffix = (this.domain === null) ? null : `.${this.domain}`;
            const found = hosts.find(v => (((suffix !== null) && v.endsWith(suffix)) === this.names_on));
            return found || hosts[0] || '';
        },
        link_of: function (app) {
            const port = this.state.listen.port;
            return `http://${this.host_of(app)}${(port === 80) ? '' : ':' + port}/`;
        },
        letter_of: function (app) {
            return Array.from(app.title || app.name)[0].toUpperCase();
        },
        hue_of: function (name) {
            let out = 0;
            for (const char of name) {
                out = ((out*31) + char.codePointAt(0)) % 360;
            }
            return out;
        },
        dropped: async function (event) {
            this.dragging = false;
            await this.give(await app_files_pick(event.dataTransfer), null);
        },
        // A drop on an app's cell is its new version, whatever the file is called
        dropped_on: async function (event, app) {
            this.over = null;
            if (this.sending) {
                return;
            }
            await this.give(await app_files_pick(event.dataTransfer), app.name);
        },
        // A drag that leaves the cell, not one that moves onto a part of it
        dragged_off: function (event, app) {
            if (event.currentTarget.contains(event.relatedTarget) === false) {
                this.over = (this.over === app.name) ? null : this.over;
            }
        },
        // The picker, for a new app (null) or for a new version of one
        pick_for: function (name) {
            const app = this.apps.find(v => v.name === name);
            this.target = name;
            this.$refs.zip.accept = ((app !== undefined) && (app.app_folder !== null)) ? '.zip,application/zip' : '.zip,application/zip,.html,.htm,text/html';
            this.$refs.zip.click();
        },
        picked: async function (event) {
            const given = await app_files_pick(event.target);
            event.target.value = '';
            await this.give(given, this.target);
        },
        // A zip goes as it is, once its list of files reads here; a folder is zipped here first,
        // and so is one page, as the index.html of an app of its own. Its name is the file's, made
        // one serviceman takes: notes.zip is notes, My Notes/ is my-notes, 2.html is 2. What is none
        // of them is said on the card with its own name, and nothing is sent. Given for an app
        // already here (fixed), it goes under that app's name whatever its own.
        give: async function (given, fixed) {
            if (given === null) {
                return;
            }
            if (given.several !== undefined) {
                this.sent = {name: '', bytes: 0, busy: false, error: `${given.several} things were dropped at once: drop one, a .zip, a folder or an .html page. Files that go together go as their folder.`, made: false, link: '', other: ''};
                return;
            }
            const folder = (given.folder !== undefined);
            const page = (folder === false) && RE_PAGE.test(given.file.name);
            const raw = folder ? ((given.folder.length === 0) ? '' : given.folder[0].path.split('/')[0]) : given.file.name.replace(page ? RE_PAGE : /\.zip$/i, '');
            const name = ((fixed === null) || (fixed === undefined)) ? name_of(raw) : fixed;
            const bytes = folder ? given.folder.reduce((sum, v) => sum + v.file.size, 0) : given.file.size;
            const own = this.apps.find(v => (v.name === name) && (v.app_folder !== null));
            if (own !== undefined) {
                await this.give_own(given, own, bytes, page);
                return;
            }
            this.sent = {name, bytes, busy: true, error: '', made: false, link: '', other: ''};
            try {
                if (folder && (given.folder.length === 0)) {
                    throw new Error('The folder is empty.');
                }
                const body = await body_of(given, page);
                const answer = await fetch(`/api/v1/apps/${encodeURIComponent(name)}`, {method: 'PUT', body});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                // Its tailnet name where serviceman answers it, on serviceman's port; the address
                // here otherwise, its name outside said beside it
                const outside = ((said.public === null) || (said.public === undefined)) ? '' : said.public;
                const port = this.state.listen.port;
                const tailnet = (this.names_on && (outside !== '')) ? `http://${outside}${(port === 80) ? '' : ':' + port}/` : '';
                this.sent = {name, bytes, busy: false, error: '', made: said.made, link: (tailnet === '') ? said.address : tailnet, other: (tailnet === '') ? outside : said.address};
            }
            catch (error) {
                this.sent = {name, bytes, busy: false, error: error.message, made: false, link: '', other: ''};
            }
        },
        // A new version of an app that runs from its own folder: its zip, or its folder zipped
        // here without its data/, goes to serviceman, which puts it in place on its machine,
        // keeps the data/ there, sets it up and starts it; the answer comes once it runs
        give_own: async function (given, app, bytes, page) {
            const name = app.name;
            this.sent = {name, bytes, busy: true, error: '', made: false, link: '', other: '', doing: `sending ${format_bytes(bytes)}, then putting it in place and starting it`};
            try {
                if (page) {
                    throw new Error(`${given.file.name}: ${name} runs from its own folder, so its new version is a .zip of that folder, or the folder itself.`);
                }
                if ((given.folder !== undefined) && (given.folder.length === 0)) {
                    throw new Error('The folder is empty.');
                }
                const body = (given.folder !== undefined) ? zip_blob(given.folder.filter(v => v.path.split('/')[1] !== 'data')) : await body_of(given, false);
                const answer = await fetch(`/api/v1/services/${encodeURIComponent(name)}/zip`, {method: 'PUT', body: await body});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                this.sent = {name, bytes, busy: false, error: '', made: false, link: this.link_of(app), other: '', doing: ''};
            }
            catch (error) {
                this.sent = {name, bytes, busy: false, error: error.message, made: false, link: '', other: '', doing: ''};
            }
        },
    },
};

// What goes to serviceman: a folder zipped, a page zipped as the index.html of an app of its own,
// and a zip as it is once its list of files reads; one that does not is said with its own name
async function body_of(given, page)
{
    if (given.folder !== undefined) {
        return zip_blob(given.folder);
    }
    if (page) {
        return zip_blob([{path: 'index.html', file: given.file}]);
    }
    try {
        await zip_entries(given.file);
    }
    catch (error) {
        throw new Error(`${given.file.name}: ${error.message}.`);
    }
    return given.file;
}

// A name serviceman takes for an app, from a file's or a folder's: lowercase letters, digits,
// - and _, starting with a letter or a digit; app when nothing of it is left
function name_of(raw)
{
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '');
    return (cleaned === '') ? 'app' : cleaned;
}

export default apps_pane;
