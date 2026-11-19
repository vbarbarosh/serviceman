import app_file_browser_add from './app_file_browser_add.js';
import app_files_pick from './app_files_pick.js';
import app_kind_of from './app_kind_of.js';
import app_php_add from './app_php_add.js';
import app_settings from './app_settings.js';
import app_socket_add from './app_socket_add.js';
import apps_search from './apps_search.js';
import format_bytes from './format_bytes.js';
import https_off_note from './https_off_note.js';
import to_clipboard from './to_clipboard.js';
import wall_select from './wall_select.js';
import walls_of from './walls_of.js';
import zip_blob from './zip_blob.js';
import zip_entries from './zip_entries.js';

// A page of its own, given as one file: 2.html, notes.htm
const RE_PAGE = /\.html?$/i;
// A PHP app, given as one file, run on a machine: adminer.php
const RE_PHP = /\.php$/i;

// What a cell says of its app's state, in a visitor's words
const STATE_WORDS = {running: 'running', starting: 'starting', stopping: 'stopping', failed: 'failed', lost: 'its machine went', stopped: 'asleep'};

// The small apps: the ones of files serviceman serves, the ones that run from a folder of their
// own (bin/run), wherever that is, and the ones whose program listens on a socket file, which
// serviceman passes their requests into; and a card to give it one more: a zip, a folder or one .html
// page dropped on it (or picked) goes to serviceman under the name of the file, and the card
// answers with the link that opens it. A name serviceman has already is that app's new version.
// Simple enough for anybody: drop, then click the link. Each app's cell opens it, takes a new
// version of it dropped on it or picked from it whatever the file is called (an app of its own
// folder takes a zip or a folder, and keeps its data/), and opens its settings in a small window
// over the page: its name, the wall it is behind, and its public addresses. One behind a wall has
// a lock before its address. On top, the address of the page of every app, to type in a browser
// here or on a phone of the tailnet, and one list that puts that page and every app, a new one
// too, behind a wall (apps.auth); its last option opens the Authwall page to make one.
const apps_pane = {
    template: `
<section class="apps-pane">
    <div class="list-head">
        <h1>Apps <span class="muted">{{ apps.length }}</span></h1>
    </div>
    <p class="muted">Every service, a card each that opens it: a page serviceman serves, an app folder, a program on a socket file, a docker image, a program, something already running. A page goes in here: drop its zip, its folder or one .html page, and it answers at an address of its own at once; one .php file runs on a machine you pick. An app folder is made with + New service; dropped on the card of a page or an app folder, a zip or a folder is its new version.</p>
    <div v-if="(page_links.length > 0)" class="app-page">
        <b>Every app on one page:</b>
        <span v-for="link of page_links" :key="link.href" class="app-page-link">
            <a :href="link.href" target="_blank" rel="noopener" :title="('Type it in a browser ' + link.where + ': a cell for every app, each opening it')">{{ link.text }}</a>
            <span class="muted">{{ link.where }}</span>
            <button type="button" @click="copy(link.href)">{{ (copied === link.href ? 'Copied' : 'Copy') }}</button>
        </span>
    </div>
    <https-off-note v-if="https_off_shown" :https_off="https_off"/>
    <div class="apps-wall">
        <label class="apps-wall-label" for="apps-wall-pick">This page and every app:</label>
        <wall-select id="apps-wall-pick" :model-value="wall" :walls="walls" none="open: each app as its own Settings say" label="The wall in front of this page and every app" :disabled="wall_busy" @update:model-value="change_wall_all" @create="$emit('walls')"/>
        <span class="muted">{{ ((wall === '') ? 'an app picks its own wall in its Settings' : 'every visitor signs in first, a new app too; a wall an app picks itself stays its own') }}</span>
    </div>
    <p v-if="(wall_error !== '')" class="bad apps-wall-says">{{ wall_error }}</p>
    <div class="apps-wall">
        <label class="apps-wall-label" for="apps-tailnet-pick">{{ (tailnet_name === null ? 'Each app at its own port:' : 'On the tailnet:') }}</label>
        <select id="apps-tailnet-pick" :value="(tailnet_on ? 'on' : 'off')" :disabled="tailnet_busy" aria-label="Whether every app has a port of its own on the tailnet" @change="change_tailnet($event.target.value === 'on')">
            <option value="on">on: each app at a port of its own</option>
            <option value="off">off: by localhost, through a machine's board</option>
        </select>
        <span class="muted">{{ (tailnet_on ? 'every device of the tailnet opens each app by serviceman’s name and its port' : 'no app answers on the tailnet; a machine opens the apps of a board published on it, on Boards') }}</span>
    </div>
    <p v-if="(tailnet_error !== '')" class="bad apps-wall-says">{{ tailnet_error }}</p>
    <div class="app-drop" :class="{over: dragging, busy: sending}" role="button" tabindex="0" @click="pick_for(null)" @keyup.enter="pick_for(null)" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="dropped">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M11 5v2M11 9v2M11 13v2"/></svg>
        <b>Drop a .zip, a folder, an .html page or a .php file here</b>
        <span class="muted">or click to pick one · a zip or a folder has its index.html at the top · a .php file runs on a machine of yours</span>
    </div>
    <div class="app-more">
        <button type="button" @click="socket_adding = true">+ An app on a socket</button>
        <span class="muted">its program listens on a socket file, in serviceman's {{ state_folder }}/ folder or on a machine of yours; serviceman gives it an address</span>
    </div>
    <div class="app-more">
        <button type="button" @click="browser_adding = true">+ A file browser</button>
        <span class="muted">serviceman's File Manager over one folder of a machine of yours, opened on it</span>
    </div>
    <!-- Outside the card: a click on it bubbles, and the card's own click would take the pick
         for a new app when an app's New version asked for it -->
    <input ref="zip" type="file" accept=".zip,application/zip,.html,.htm,text/html,.php" hidden @change="picked">
    <div v-if="(sent !== null)" class="card app-sent" :class="{bad: (sent.error !== '')}">
        <p v-if="sent.busy" class="muted"><span class="spin"/>{{ sent.name }}: {{ (sent.doing ? sent.doing : 'sending ' + format_bytes(sent.bytes)) }}…</p>
        <p v-else-if="(sent.error !== '')" class="bad">{{ sent.error }}</p>
        <template v-else>
            <p v-if="(sent.socket !== undefined)" class="app-sent-head"><span class="dot"></span><b>{{ sent.name }}</b> is added: it answers once your app listens on its socket</p>
            <p v-else class="app-sent-head"><span class="dot running"></span><b>{{ sent.name }}</b> {{ sent.made ? 'is ready' : 'has its new version' }}</p>
            <p class="app-sent-link"><a :href="sent.link" target="_blank" rel="noopener">{{ sent.link }}</a><a class="button primary" :href="sent.link" target="_blank" rel="noopener">Open</a></p>
            <p v-if="((sent.other !== '') && names_on)" class="muted">and on this computer: <a :href="sent.other" target="_blank" rel="noopener">{{ sent.other }}</a></p>
            <p v-else-if="(sent.other !== '')" class="muted">its name outside, once your tailnet or a machine's door answers it: <code>{{ sent.other }}</code></p>
            <p v-if="(tailnet_of(sent.name) !== '')" class="muted app-sent-tailnet">on every device of your tailnet: <a :href="tailnet_of(sent.name)" target="_blank" rel="noopener">{{ tailnet_of(sent.name) }}</a><span v-if="(https_off !== null)" class="app-http-why"> · http only: {{ https_off.why }}</span></p>
            <template v-if="(sent.socket !== undefined)">
                <p class="app-sent-socket">Set your app to listen on <code>{{ sent.socket }}</code>{{ (sent.remote ? ' on ' + sent.remote : '') }} <button type="button" @click="copy(sent.socket)">{{ (copied === sent.socket ? 'Copied' : 'Copy') }}</button></p>
                <p class="muted">Your app makes that file when it starts listening{{ ((sent.remote || (sent.socket.startsWith(state_folder + '/') === false)) ? '' : '; serviceman has made its folder, in the ' + state_folder + '/ beside its bin/run') }}. Until then the address answers 502.</p>
            </template>
        </template>
    </div>
    <div v-if="(apps.length > 0)" class="list-tools">
        <input ref="search" v-model="query" type="search" placeholder="find an app by its name, kind or address; Enter opens it" spellcheck="false" aria-label="Find an app; Enter opens the first" @input="current = 0">
    </div>
    <p v-if="((apps.length > 0) && (shown.length === 0))" class="muted">No app has {{ query.trim() }} in its name, kind or address.</p>
    <ul v-if="(shown.length > 0)" class="app-cells">
        <li v-for="(app, index) of shown" :key="app.name" :class="{over: (over === app.name), current: ((query.trim() !== '') && (index === current))}" @dragover="dragged_over($event, app)" @dragleave="dragged_off($event, app)" @drop="dropped_on($event, app)">
            <a class="app-cell" :href="link_of(app)" target="_blank" rel="noopener" :title="((app.title || app.name) + ' · ' + host_of(app))">
                <span class="app-tile" :style="{'--hue': hue_of(app.name)}">{{ letter_of(app) }}</span>
                <b>{{ app.title || app.name }}</b>
                <span class="muted app-host"><svg v-if="(app.auth !== null)" class="app-lock" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" role="img" :aria-label="('behind ' + app.auth)"><title>{{ ('Behind ' + app.auth + ': every visitor signs in first') }}</title><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>{{ host_of(app) }}</span>
                <span v-if="(app.socket !== null)" class="muted app-host" :title="socket_place(app)">{{ socket_place(app) }}</span>
                <span v-else class="muted"><span class="dot" :class="app.phase"></span>{{ STATE_WORDS[app.phase] || app.phase }}</span>
            </a>
            <a v-if="(tailnet_of(app.name) !== '')" class="app-tailnet" :class="{http: (https_off !== null)}" :href="tailnet_of(app.name)" target="_blank" rel="noopener" :title="tailnet_title(app.name)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>tailnet :{{ port_of(app.name).port }}<template v-if="(https_off !== null)"> · http</template></a>
            <span v-else-if="((port_of(app.name) !== null) && (port_of(app.name).error !== null))" class="app-tailnet bad" :title="('Port ' + port_of(app.name).port + ' does not listen: ' + port_of(app.name).error + '. Tried again every minute.')">tailnet :{{ port_of(app.name).port }} {{ (/EADDRINUSE/.test(port_of(app.name).error) ? 'taken' : 'closed') }}</span>
            <div class="app-acts">
                <button v-if="(app.socket !== null)" type="button" :title="('Copy ' + app.socket_said + ', the file its app listens on')" @click="copy(app.socket_said)">{{ (copied === app.socket_said ? 'Copied' : 'Copy socket') }}</button>
                <button v-else-if="takes_version(app)" type="button" :disabled="sending" :title="version_title(app)" @click="pick_for(app.name)">New version…</button>
                <button type="button" :title="('The name, the sign-in, the public address and the data of ' + app.name)" @click="settings = app">Settings</button>
            </div>
        </li>
    </ul>
    <p v-else class="muted">No app yet: the first one dropped above lands here.</p>
    <app-socket-add v-if="socket_adding" :remotes="state.remotes" :names="state.services.map(v => v.name)" :suffix="suffix" :folder="state_folder" @close="socket_adding = false" @made="socket_made"/>
    <app-file-browser-add v-if="browser_adding" :remotes="state.remotes" :names="state.services.map(v => v.name)" :suffix="suffix" @close="browser_adding = false" @made="browser_made"/>
    <app-php-add v-if="(php_adding !== null)" :file="php_adding.file" :named="php_adding.name" :remotes="state.remotes" :names="state.services.map(v => v.name)" :suffix="suffix" @close="php_adding = null" @made="php_made"/>
    <app-settings v-if="(settings !== null)" :folder="state_folder" :app="settings" :host="host_of(settings)" :tailnet="tailnet_of(settings.name)" :https_off="https_off" :remotes="state.remotes" :names="state.services.map(v => v.name)" :walls="walls" @close="settings = null" @saved="$emit('saved')" @more="more" @new_database="$emit('new_database', $event)" @walls="$emit('walls')"/>
</section>
`,
    components: {'app-file-browser-add': app_file_browser_add, 'app-php-add': app_php_add, 'app-settings': app_settings, 'app-socket-add': app_socket_add, 'https-off-note': https_off_note, 'wall-select': wall_select},
    emits: ['new_database', 'select', 'saved', 'walls'],
    props: {
        state: {type: Object, required: true},
        // The app whose Settings window opens at once (Addresses' "set in"), null for none
        open: {type: String, default: null},
    },
    data: function () {
        // sent: the last zip given, {name, bytes, busy, error, made, link, other}; over: the
        // app a drop is over; target: the app a pick is for, null for a new one; settings: the
        // app whose settings window is open, as it was when it opened
        // socket_adding: the window for a new app on a socket is open; copied: the text the last
        // Copy put on the clipboard
        // wall_busy: the list on top is being saved; wall_error: why its last save was refused;
        // tailnet_busy and tailnet_error the same for the switch under it
        // query: the search box's text; current: the cell among those shown that Enter opens
        return {dragging: false, over: null, target: null, sent: null, settings: null, socket_adding: false, php_adding: null, browser_adding: false, copied: null, wall_busy: false, wall_error: '', tailnet_busy: false, tailnet_error: '', query: '', current: 0, STATE_WORDS};
    },
    computed: {
        sending: function () {
            return (this.sent !== null) && this.sent.busy;
        },
        // Why the apps' tailnet links are http, {why, fix, link}, as Health says it; null
        // while they are https or nothing is known
        https_off: function () {
            const tailnet = this.state.tailnet;
            return ((tailnet === undefined) || (tailnet === null) || (tailnet.https_off === undefined)) ? null : tailnet.https_off;
        },
        // Said on top while any app has a tailnet link that opens over http
        https_off_shown: function () {
            return (this.https_off !== null) && this.state.services.some(v => (this.tailnet_of(v.name) !== ''));
        },
        // Every service: to whoever opens it, an app is an app whatever runs it
        apps: function () {
            return this.state.services.slice().sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
        },
        // What the search box finds, as navplace's does (apps_search): `found` the cells shown,
        // `tops` the first app of every word, which Enter opens with the current one
        searched: function () {
            const items = this.apps.map(v => ({name: v.title || v.name, words: words_of(v), address: this.host_of(v), app: v}));
            const answer = apps_search(items, this.query);
            return {found: answer.found.map(v => v.app), tops: answer.tops.map(v => v.app)};
        },
        shown: function () {
            return this.searched.found;
        },
        // What an app's own name has after it, beside serviceman's own name in its config, as
        // serviceman names a new app (app_files_hosts): localhost for serviceman.localhost,
        // wherever this page was opened from
        suffix: function () {
            const control = this.state.control;
            const host = ((control === undefined) || (control === null) || (typeof control.host !== 'string')) ? 'localhost' : control.host;
            const at = host.indexOf('.');
            return (at === -1) ? host : host.slice(at + 1);
        },
        // The folder serviceman keeps its own things in, as its owner sees it: data/ under bin/run
        state_folder: function () {
            return (typeof this.state.state_dir !== 'string') ? 'data' : this.state.state_dir.replace(/\/+$/, '').split('/').pop();
        },
        domain: function () {
            return ((this.state.apps === undefined) || (this.state.apps === null)) ? null : this.state.apps.domain;
        },
        // The wall Apps puts in front of its page and every app, '' for none
        wall: function () {
            const apps = this.state.apps;
            return ((apps !== undefined) && (apps !== null) && (typeof apps.auth === 'string')) ? apps.auth : '';
        },
        walls: function () {
            return walls_of(this.state);
        },
        // The page of every app, at each name a browser reaches it by (apps_page_of on the
        // server): apps.localhost on this computer, serviceman's own tailnet name on every device
        // of the tailnet, the apps domain where the tailnet answers its names. A name a service
        // has is that service's, and gives no link here.
        // [{href, text, where}]
        // Whether each app has a port of its own on the tailnet: off with "apps": {"ports": null}
        tailnet_on: function () {
            return (this.state.apps.ports !== null);
        },
        tailnet_name: function () {
            return ((this.state.tailnet === undefined) || (this.state.tailnet === null)) ? null : this.state.tailnet.name;
        },
        page_links: function () {
            const port = this.state.listen.port;
            const at = (port === 80) ? '' : `:${port}`;
            const taken = new Set(this.state.services.flatMap(v => v.publish.hosts.map(vv => vv.split('/')[0].toLowerCase())));
            // Off the tailnet, the apps have no page there either (apps_page_of)
            const tailnet = this.tailnet_on ? this.tailnet_name : null;
            const out = [];
            const names = [[`apps.${this.suffix}`, 'on this computer'], [tailnet, 'on every device of your tailnet']];
            if (this.names_on) {
                names.push([this.domain, 'on your tailnet, by its name']);
            }
            for (const [name, where] of names) {
                if ((name !== null) && (taken.has(name.toLowerCase()) === false)) {
                    out.push({href: `http://${name}${at}/`, text: `${name}${at}`, where});
                }
            }
            return out;
        },
        // Whether serviceman answers the apps' names on the tailnet (apps.dns): their names under
        // the domain then open on every device of it, on serviceman's own port
        names_on: function () {
            return (this.domain !== null) && (this.state.apps.dns !== null) && (this.state.apps.dns !== undefined);
        },
    },
    methods: {
        // A page and an app folder take a new version, a zip or a folder dropped on their card
        takes_version: function (app) {
            return (app.type === 'files') || (app.app_folder !== null);
        },
        dragged_over: function (event, app) {
            if (this.takes_version(app)) {
                event.preventDefault();
                this.over = app.name;
            }
        },
        // The keys the search box takes as navplace's does: a letter typed with no field focused
        // goes to it, and while it finds something ↑ and ↓ move among the cells and Enter opens.
        // A window over the page, another field, a focused button or link keep their own keys
        keydown_page: function (event) {
            const search = this.$refs.search;
            if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || (search === undefined) || (search === null)) {
                return;
            }
            if ((this.settings !== null) || this.socket_adding || (this.php_adding !== null) || this.browser_adding) {
                return;
            }
            const focused = document.activeElement;
            const elsewhere = (focused !== search) && (focused !== null) && (focused !== document.body);
            if (elsewhere && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(focused.tagName) || focused.isContentEditable)) {
                return;
            }
            if ((this.query.trim() !== '') && (this.shown.length > 0)) {
                if ((event.key === 'ArrowDown') || (event.key === 'ArrowUp')) {
                    event.preventDefault();
                    this.current = Math.max(0, Math.min(this.shown.length - 1, this.current + ((event.key === 'ArrowDown') ? 1 : -1)));
                    return;
                }
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.open_found();
                    return;
                }
            }
            // / is the page's own, for its find palette (serviceman.js)
            if ((event.key.length === 1) && (event.key !== '/') && (focused !== search)) {
                search.focus({preventScroll: true});
            }
        },
        // What one Enter opens, each as a click on its cell does: the first app of every word
        // before the last, then the current cell; an app found twice opens once
        open_found: function () {
            const picked = this.shown[Math.min(this.current, this.shown.length - 1)];
            const apps = [...this.searched.tops.slice(0, -1), picked];
            for (const app of new Map(apps.map(v => [v.name, v])).values()) {
                window.open(this.link_of(app), '_blank', 'noopener');
            }
        },
        format_bytes: function (bytes) {
            return format_bytes(bytes);
        },
        version_title: function (app) {
            if (app.app_folder !== null) {
                return `A new version of ${app.name}: pick its .zip, or drop its zip or its folder on this card; its data/ stays as it is`;
            }
            return `A new version of ${app.name}: pick its .zip or its .html page, or drop a zip, a folder or a page on this card`;
        },
        // An app's socket in the words the ready card says it in: data/sockets/va.sock on
        // serviceman's own side, ~/va.sock on laptop on a machine
        socket_place: function (app) {
            return (app.remotes.length === 0) ? app.socket_said : `${app.socket_said} on ${app.remotes[0]}`;
        },
        copy: async function (text) {
            if (await to_clipboard(text)) {
                this.copied = text;
            }
        },
        // The list on top, saved as it is picked: the page of apps and every app behind a wall, or
        // each app back to its own pick
        // The apps on the tailnet or off it: off, none has a port of its own there, and a machine
        // opens them by localhost through a board published on it
        change_tailnet: async function (on) {
            this.tailnet_busy = true;
            this.tailnet_error = '';
            try {
                const answer = await fetch('/api/v1/apps', {method: 'PUT', body: JSON.stringify({tailnet: on})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                this.$emit('saved');
            }
            catch (error) {
                this.tailnet_error = error.message;
            }
            finally {
                this.tailnet_busy = false;
            }
        },
        change_wall_all: async function (wall) {
            this.wall_busy = true;
            this.wall_error = '';
            try {
                const answer = await fetch('/api/v1/apps', {method: 'PUT', body: JSON.stringify({auth: (wall === '') ? null : wall})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                this.$emit('saved');
            }
            catch (error) {
                this.wall_error = error.message;
            }
            finally {
                this.wall_busy = false;
            }
        },
        // A new app on a socket: the card says where it answers, and the file to set its app to
        socket_made: function (said) {
            const outside = ((said.public === null) || (said.public === undefined)) ? '' : said.public;
            const port = this.state.listen.port;
            const tailnet = (this.names_on && (outside !== '')) ? `http://${outside}${(port === 80) ? '' : ':' + port}/` : '';
            this.socket_adding = false;
            this.sent = {name: said.name, bytes: 0, busy: false, error: '', made: true, link: (tailnet === '') ? said.address : tailnet, other: (tailnet === '') ? outside : said.address, socket: said.service.socket_said, remote: said.remote};
            this.$emit('saved');
        },
        // A new file browser: the card says where it answers, as for every app
        browser_made: function (said) {
            this.browser_adding = false;
            this.php_made(said);
        },
        // A new PHP app: the card says where it answers, as for every app
        php_made: function (said) {
            const outside = ((said.public === null) || (said.public === undefined)) ? '' : said.public;
            const port = this.state.listen.port;
            const tailnet = (this.names_on && (outside !== '')) ? `http://${outside}${(port === 80) ? '' : ':' + port}/` : '';
            this.php_adding = null;
            this.sent = {name: said.name, bytes: 0, busy: false, error: '', made: true, link: (tailnet === '') ? said.address : tailnet, other: (tailnet === '') ? outside : said.address};
            this.$emit('saved');
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
        // An app's own port as serviceman says it (app_ports_here): {port, error}, or null
        port_of: function (name) {
            const ports = this.state.app_ports;
            return ((ports === undefined) || (ports === null) || (ports[name] === undefined)) ? null : ports[name];
        },
        // Its own port on serviceman's tailnet name: every device of the tailnet opens it there,
        // with no name or DNS set up, over https once the port answers it on the tailnet's
        // certificate; '' while it does not listen or the name is not known
        tailnet_of: function (name) {
            const found = this.port_of(name);
            const tailnet = ((this.state.tailnet === undefined) || (this.state.tailnet === null)) ? null : this.state.tailnet.name;
            if ((found === null) || (found.error !== null) || (tailnet === null)) {
                return '';
            }
            return `${(this.state.tailnet.https === true) ? 'https' : 'http'}://${tailnet}:${found.port}/`;
        },
        // The tailnet link's title: where it opens, and why over http where it does
        tailnet_title: function (name) {
            const where = `On every device of your tailnet, nothing to set up: ${this.tailnet_of(name)}`;
            return (this.https_off === null) ? where : `${where}\nhttp only: ${this.https_off.why}. ${this.https_off.fix}`;
        },
        link_of: function (app) {
            const port = this.state.listen.port;
            const host = this.host_of(app);
            const full = app.publish.hosts.find(v => v.split('/')[0] === host) || host;
            const path = full.slice(host.length);
            return `http://${host}${(port === 80) ? '' : ':' + port}${(path === '') ? '/' : path}`;
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
            // A card of a kind that takes no new version leaves the drop to the page around it
            if (this.takes_version(app) === false) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
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
            this.$refs.zip.accept = ((app !== undefined) && (app.app_folder !== null)) ? '.zip,application/zip' : '.zip,application/zip,.html,.htm,text/html,.php';
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
            // A PHP file is an app run on a machine: its window asks which one
            if ((folder === false) && RE_PHP.test(given.file.name) && ((fixed === null) || (fixed === undefined))) {
                this.php_adding = {file: given.file, name: name_of(given.file.name.replace(RE_PHP, ''))};
                return;
            }
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
    mounted: function () {
        document.addEventListener('keydown', this.keydown_page);
        if (this.$refs.search && (this.open === null)) {
            this.$refs.search.focus({preventScroll: true});
        }
    },
    created: function () {
        if (this.open !== null) {
            const found = this.apps.find(v => v.name === this.open);
            this.settings = (found === undefined) ? null : found;
        }
    },
    unmounted: function () {
        document.removeEventListener('keydown', this.keydown_page);
    },
};

// The words an app is found by besides its name: its kind, and the machine it is on
function words_of(app)
{
    return [app_kind_of(app), app.name, ...app.remotes];
}

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
