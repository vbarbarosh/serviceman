import app_entries_read from './app_entries_read.js';
import app_files_pick from './app_files_pick.js';
import app_files_send from './app_files_send.js';
import app_folder_read from './app_folder_read.js';
import app_setup_line from './app_setup_line.js';
import app_setup_text from './app_setup_text.js';
import app_zip_read from './app_zip_read.js';
import brought_from_forwards from './brought_from_forwards.js';
import brought_said from './brought_said.js';
import copy_progress from 'file_manager/copy_progress.js';
import docker_run_parse from './docker_run_parse.js';
import format_bytes from './format_bytes.js';
import forwards_from_brought from './forwards_from_brought.js';
import machine_card from './machine_card.js';
import machine_tile from './machine_tile.js';
import secret_name_said from './secret_name_said.js';
import secret_rows_write from './secret_rows_write.js';
import service_from_form from './service_from_form.js';
import service_kind from './service_kind.js';
import settled from './settled.js';
import snippet from './snippet.js';
import state_read from './state_read.js';
import step_frame from './step_frame.js';
import wall_select from './wall_select.js';

// What a service can be, in the order the question is worth asking
const KINDS = ['docker', 'shell', 'external', 'files'];

const KIND_WORDS = {
    docker: 'an agent runs it and stops it on the machine you name',
    shell: 'a command line kept alive on a machine of yours',
    external: 'serviceman only gives it an address, and never starts it',
    files: 'a page or an app with no server: serviceman serves its folder itself',
};

const KIND_NAMES = {
    docker: 'A docker image',
    shell: 'A program',
    external: 'Something already running',
    files: 'A folder of files',
};

// What the short form makes: an image, an app folder, a program of one shape, or a proxy into
// a socket file. bin/run serves it on PORT; bin/configure, then bin/build, for those it has, set
// it up once before the first run. A proxy's app listens on a socket file serviceman passes every
// request into; serviceman never starts or stops it.
const SHORT_KINDS = ['docker', 'shell', 'external'];

const SHORT_NAMES = {
    docker: 'A docker image',
    shell: 'An app folder',
    external: 'A proxy',
};

const SHORT_WORDS = {
    docker: 'an agent runs it and stops it on the machine you name',
    shell: 'its folder or a .zip of it, with bin/run, from this computer',
    external: 'its app listens on a socket file, in serviceman\'s own folder or on a machine; serviceman passes requests into it',
};

// What a new service can be, the first step's tiles: each the kind of service it makes (type), and
// for a database the Databases page, where one is brought up. `like` is a service of that kind,
// for its icon (service_kind); a database has its own.
const WHAT = [
    {key: 'docker', type: 'docker', name: 'Docker image', says: 'an image from a registry', like: {type: 'docker'}},
    {key: 'app', type: 'shell', name: 'App folder', says: 'a folder with bin/run', like: {type: 'shell', app_folder: {}}},
    {key: 'program', type: 'shell', name: 'Program', says: 'a command kept alive', like: {type: 'shell', app_folder: null}},
    {key: 'files', type: 'files', name: 'Folder of files', says: 'pages, no server', like: {type: 'files'}},
    {key: 'database', type: null, name: 'Database', says: 'PostgreSQL, MySQL…', like: null, icon: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>'},
    {key: 'socket', type: 'external', name: 'App on a socket', says: 'it listens on a file', like: {type: 'external', socket: 'x'}},
    {key: 'external', type: 'external', name: 'Already running', says: 'only an address', like: {type: 'external', socket: null}},
];

// The second step of each, as its bar names it and asks it
const SOURCE_STEP = {
    docker: {name: 'Image', question: 'Which image?', says: 'Its name on Docker Hub or a registry of yours.'},
    app: {name: 'Folder', question: 'Which app folder?', says: 'Its folder on this computer with bin/run in it, or a .zip of it: serviceman copies it to its machine.'},
    program: {name: 'Command', question: 'What runs it?', says: 'The line it is started with, kept alive on its machine.'},
    files: {name: 'Folder', question: 'Which folder does it serve?', says: 'A folder of serviceman\'s own machine: serviceman serves its files itself, nothing runs.'},
    socket: {name: 'Socket', question: 'Which socket does it listen on?', says: 'The file its app listens on; serviceman passes every request into it.'},
    external: {name: 'Answers at', question: 'Where does it answer already?', says: 'Where it answers now; serviceman only gives it an address and passes requests on.'},
};

// What the machine step says when there is no machine yet, for each kind that runs on one
const NO_MACHINE_SAYS = {
    docker: 'A docker image runs on a machine of yours.',
    app: 'An app folder runs on a machine of yours.',
    program: 'A program runs on a machine of yours.',
};

// The icons of a machine, of a tag of machines and of a wall, the inside of a 24x24 stroked svg
const MACHINE_ICON = '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>';
const TAG_ICON = '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>';
const SHIELD_ICON = '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>';
const GLOBE_ICON = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>';
// The icons of the rest at their defaults: its data, when it runs, its copies
const REST_ICONS = {
    keep: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/>',
    policy: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    scale: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/>',
};

// Which step each thing that can be wrong is fixed in
const STEP_PROBLEMS = {source: ['name', 'port', 'cwd', 'command', 'upstream', 'socket'], machine: ['places'], address: ['hosts']};

// The ports an app folder is given, the first one free from here: well away from serviceman's
// own and from what most dev servers take
const APP_PORT_FIRST = 8080;

// The answers to "sleep after" that are worth one click
const IDLE_STEPS = ['2m', '10m', '1h'];

// A service is read top to bottom in these cards, on its page and while it is made. `must` is
// what a new one cannot do without; the rest open closed, on serviceman's defaults.
const SECTIONS = [
    {id: 'name', title: 'Name', kinds: ['docker', 'shell', 'external', 'files'], must: true},
    {id: 'runs', title: 'What runs', kinds: ['docker', 'shell', 'external', 'files'], must: true},
    {id: 'where', title: 'Where it runs', kinds: ['docker', 'shell', 'external'], must: true},
    {id: 'address', title: 'Addresses', kinds: ['docker', 'shell', 'external', 'files'], must: true},
    {id: 'ports', title: 'Its port on another machine', kinds: ['shell'], must: false},
    {id: 'keep', title: 'Storage and secrets', kinds: ['docker', 'shell'], must: false},
    {id: 'policy', title: 'When it runs', kinds: ['docker', 'shell'], must: false},
    {id: 'scale', title: 'Copies', kinds: ['docker'], must: false},
];

// What each card changes in the model: an open card is marked changed while any of them differs
// from what is saved, and Cancel puts it back
const SECTION_FIELDS = {
    name: ['name', 'title', 'type'],
    runs: ['image', 'port', 'network', 'init', 'prepull', 'env', 'command', 'user', 'cwd', 'install', 'update', 'stop', 'uninstall', 'upstream', 'socket', 'folder'],
    where: ['places'],
    address: ['hosts', 'strip_prefix', 'redirect', 'auth'],
    ports: ['brought'],
    keep: ['volumes', 'secrets'],
    policy: ['start', 'restart', 'stop_after_idle', 'never_stop', 'start_timeout', 'stop_timeout', 'request_timeout', 'never_request_timeout', 'start_tries'],
    scale: ['min', 'max', 'concurrency', 'warmup_queue', 'warmup_wait', 'scale_down_after', 'prepull', 'autoscale', 'busy_up', 'up_for', 'busy_down', 'down_for', 'cool_down'],
};

// Which card each thing that can be wrong is in
const SECTION_PROBLEMS = {
    name: ['name'],
    runs: ['port', 'command', 'upstream', 'socket'],
    where: ['places'],
    address: ['hosts'],
    ports: ['brought'],
    keep: ['secrets'],
};

const RE_DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;

// "10m" -> {n: "10", unit: "m"}. A bare number is seconds, the way the file reads it. An empty
// box takes its unit from the default it stands in for; anything that is not a length of time
// at all comes back null, and keeps a plain box to be typed in.
function duration_parts(text, fallback)
{
    if ((text === '') || (text === undefined) || (text === null)) {
        const found = RE_DURATION.exec(fallback || '');
        return {n: '', unit: (found === null) ? 's' : found[2] || 's'};
    }
    const found = RE_DURATION.exec(String(text).trim());
    return (found === null) ? null : {n: found[1], unit: found[2] || 's'};
}

// 0.7 <-> 70: the file keeps a share, the form asks for a percentage. Rounded on the way out,
// because a hundred times a tenth is not always the tenth back again.
function share_percent(text)
{
    const share = Number(text);
    return ((text === '') || (Number.isFinite(share) === false)) ? text : String(Math.round(share*100));
}

function percent_share(text)
{
    const percent = Number(text);
    return ((String(text).trim() === '') || (Number.isFinite(percent) === false)) ? text : String(percent/100);
}

// A length of time as a number and a unit, so nobody has to remember how the file spells one
const duration = {
    template: `
<span class="dur">
    <input v-if="(parts === null)" :value="modelValue" :placeholder="placeholder" spellcheck="false" @input="$emit('update:modelValue', $event.target.value)">
    <template v-else>
        <input v-model.trim="n" :placeholder="fallback.n" class="tiny" spellcheck="false">
        <select v-model="unit">
            <option value="ms">milliseconds</option>
            <option value="s">seconds</option>
            <option value="m">minutes</option>
            <option value="h">hours</option>
            <option value="d">days</option>
        </select>
    </template>
</span>
`,
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    computed: {
        parts: function () {
            return duration_parts(this.modelValue, this.placeholder);
        },
        // An empty box still has a unit to show, and it is the one the default is written in
        fallback: function () {
            return duration_parts('', this.placeholder);
        },
        n: {
            get: function () {
                return (this.parts === null) ? '' : this.parts.n;
            },
            set: function (text) {
                this.write(text, this.unit);
            },
        },
        unit: {
            get: function () {
                return (this.parts === null) ? this.fallback.unit : this.parts.unit;
            },
            set: function (text) {
                this.write(this.n, text);
            },
        },
    },
    methods: {
        write: function (n, unit) {
            this.$emit('update:modelValue', (String(n).trim() === '') ? '' : `${n}${unit}`);
        },
    },
};

// One service as a column of cards, each a part of it: a line that says how it stands, and a
// form in place of the line when it is opened. The same cards make a new service — the ones
// it cannot do without open, the rest closed on serviceman's defaults — and look after one
// that exists, where a card is opened, changed and saved by itself.
const service_form = {
    template: `
<article id="detail" class="list form svc">
    <!-- What the page holding this puts above the cards: the state of a service that exists -->
    <slot/>
    <!-- A new service in the step frame: one question a screen, or all of them on one page; All
         settings, from Check, is the whole form -->
    <step-frame v-if="(creating && simple)" :title="heading" :steps="steps" :step="step" :mode="mode" :can_next="next_ok.ok" :next_title="next_ok.why" :busy="busy" :create_label="create_label" @step="step_go" @mode="mode = $event" @cancel="$emit('close')" @create="create">
        <template #what>
            <div class="kind-tiles" role="radiogroup" aria-label="What it runs">
                <button v-for="item of what_items" :key="item.key" type="button" role="radio" class="kind-tile" :class="{on: (item.key === what)}" :title="item.says" :aria-checked="(item.key === what)" @click="what_pick(item.key)">
                    <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/></span>
                    <b>{{ item.name }}</b>
                    <span class="muted">{{ item.says }}</span>
                </button>
            </div>
        </template>
        <template #source>
            <div class="sf-fields" :class="{dropping: drop_over}" @dragover.prevent="drop_over = (what === 'app')" @dragleave="drop_over = false" @drop.prevent="app_dropped">
                <div v-if="(what === 'docker')" class="sf-field">
                    <label for="sf-image">Image</label>
                    <input id="sf-image" ref="image" v-model.trim="m.image" class="sf-mono" placeholder="grafana/grafana:latest" spellcheck="false" @input="image_input" @change="image_change">
                    <p v-if="(detected_port !== null)" class="sf-hint ok">✓ It listens on port {{ detected_port }}, as the image says</p>
                </div>
                <div v-else-if="(what === 'app')" class="sf-field">
                    <span class="sf-label">Its folder</span>
                    <div class="line">
                        <button ref="pick" type="button" :class="{wrong: problems.cwd}" @click="$refs.folder.click()">A folder…</button>
                        <button type="button" :class="{wrong: problems.cwd}" @click="$refs.zip.click()">A .zip…</button>
                        <input ref="folder" type="file" webkitdirectory hidden @change="app_picked">
                        <input ref="zip" type="file" accept=".zip,application/zip" hidden @change="app_picked">
                    </div>
                    <p v-if="(app_files !== null)"><code>{{ app_files.label }}</code> <span v-if="(app_files.files > 0)" class="muted">— {{ app_files.files === 1 ? 'one file' : app_files.files + ' files' }}, {{ size_text(app_files.size) }}</span></p>
                    <p v-if="problems.cwd" class="sf-hint bad">{{ problems.cwd }}</p>
                    <p v-else-if="(app_files === null)" class="sf-hint">Picked, or dropped here.</p>
                    <p v-else class="sf-hint">{{ app_steps }}, on port {{ app_port }} as <code>PORT</code>.</p>
                </div>
                <div v-else-if="(what === 'program')" class="sf-field">
                    <label for="sf-command">Command</label>
                    <input id="sf-command" ref="command" v-model="m.command" class="sf-mono" placeholder="node server.js" :class="{wrong: problems.command}" spellcheck="false">
                    <p v-if="problems.command" class="sf-hint bad">{{ problems.command }}</p>
                    <p v-else class="sf-hint">It reads <code>PORT</code> for the port inside.</p>
                </div>
                <div v-else-if="(what === 'files')" class="sf-field">
                    <label for="sf-folder">Folder</label>
                    <input id="sf-folder" ref="folder_path" v-model.trim="m.folder" class="sf-mono" placeholder="sites/docs" spellcheck="false">
                    <p class="sf-hint">from the config's folder, or from <code>/</code></p>
                </div>
                <template v-else-if="(what === 'socket')">
                    <div class="sf-field">
                        <label for="sf-socket-place">It is on</label>
                        <select id="sf-socket-place" v-model="m.places[0].text" :class="{wrong: problems.places}" @change="place_change">
                            <option value="">serviceman's own {{ state_folder }}/ folder</option>
                            <option v-for="item of places" :key="item.value" :value="item.value">{{ item.label }}</option>
                        </select>
                    </div>
                    <div class="sf-field">
                        <label for="sf-socket">Socket</label>
                        <input id="sf-socket" v-model.trim="m.socket" class="sf-mono" :placeholder="socket_default" :class="{wrong: problems.socket}" spellcheck="false">
                        <p v-if="problems.socket" class="sf-hint bad">{{ problems.socket }}</p>
                        <p v-else class="sf-hint">serviceman never starts or stops it</p>
                    </div>
                </template>
                <div v-else class="sf-field">
                    <label for="sf-upstream">Answers at</label>
                    <input id="sf-upstream" ref="upstream" v-model.trim="m.upstream" class="sf-mono" placeholder="127.0.0.1:8081" :class="{wrong: problems.upstream}" spellcheck="false">
                    <p v-if="problems.upstream" class="sf-hint bad">{{ problems.upstream }}</p>
                    <p v-else class="sf-hint">host:port</p>
                </div>
                <div :class="(((what === 'docker') || (what === 'program')) ? 'sf-row' : 'sf-fields')">
                    <div class="sf-field">
                        <label for="sf-name">Name</label>
                        <input id="sf-name" ref="short_name" v-model.trim="m.name" class="sf-mono" :placeholder="((easy_name === '') ? 'grafana' : easy_name)" :class="{wrong: problems.name}" spellcheck="false">
                        <p v-if="problems.name" class="sf-hint bad">{{ problems.name }}</p>
                        <p v-else-if="((m.name === '') && (easy_name !== ''))" class="sf-hint">Left empty, it is <code>{{ easy_name }}</code>; its address and folder are named after it.</p>
                        <p v-else class="sf-hint">its address and folder are named after it</p>
                    </div>
                    <div v-if="((what === 'docker') || (what === 'program'))" class="sf-field">
                        <label for="sf-port">Port inside</label>
                        <input id="sf-port" v-model.trim="m.port" :placeholder="((what === 'program') ? String(app_port) : ((detected_port === null) ? '80' : String(detected_port)))" :class="{wrong: problems.port}" spellcheck="false">
                        <p v-if="problems.port" class="sf-hint bad">{{ problems.port }}</p>
                        <p v-else-if="((what === 'docker') && (detected_port !== null) && (m.port === String(detected_port)))" class="sf-hint">read from the image</p>
                    </div>
                </div>
                <p v-if="(what === 'docker')" class="sf-info"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>Or paste a whole <code>docker run …</code> line into Image: its ports, folders and variables are filled from it.</span></p>
            </div>
        </template>
        <template #machine>
            <div class="machine-cards" role="radiogroup" aria-label="The machine it runs on">
                <machine-tile v-for="item of machine_cards" :key="item.value" :item="item" :on="(item.value === m.places[0].text)" :disabled="item.disabled" :title="item.why" @click="machine_pick(item.value)"/>
                <button type="button" class="machine-card mc-add" :class="{alone: (machine_cards.length === 0)}" @click="machine_add">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                    <b>Add a machine</b>
                    <span class="muted">{{ (machine_cards.length === 0) ? 'Its agent is one line to run there; it dials in, and you come back here with it picked' : 'its agent dials in; you come back here with it picked' }}</span>
                </button>
            </div>
            <p v-if="problems.places" class="sf-hint bad">{{ problems.places }}</p>
            <p v-if="(machine_cards.length === 0)" class="sf-info"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>No machine yet. A <b>folder of files</b> or an address that <b>already runs</b> needs none: <button type="button" class="link" @click="step_to('what')">change what it runs</button>.</span></p>
        </template>
        <template #address>
            <div class="sf-fields">
                <div class="sf-field">
                    <label :for="('sf-host-' + m.hosts[0].key)">Address</label>
                    <div v-for="(row, index) of m.hosts" :key="row.key" class="line">
                        <input :id="('sf-host-' + row.key)" v-model.trim="row.text" class="sf-mono" :placeholder="((index === 0) ? (easy_host || 'grafana.example.com') : 'another.example.com')" :aria-label="('Address ' + (index + 1))" :class="{wrong: problems.hosts}" spellcheck="false">
                        <button v-if="(index > 0)" type="button" class="link" @click="m.hosts.splice(index, 1)">Remove</button>
                    </div>
                    <p v-if="problems.hosts" class="sf-hint bad">{{ problems.hosts }}</p>
                    <p v-else-if="((easy_host !== '') && m.hosts.every(v => (v.text === '')))" class="sf-hint">Left empty, it is <code>{{ easy_host }}</code>, from its name.</p>
                </div>
                <button type="button" class="link sf-more" @click="m.hosts.push({key: Math.random(), text: ''})">+ another address</button>
                <h3 class="sf-sub">Who may open it?</h3>
                <div class="kind-tiles two" role="radiogroup" aria-label="Who may open it">
                    <button type="button" role="radio" class="kind-tile" :class="{on: (m.auth === '')}" :aria-checked="(m.auth === '')" @click="m.auth = ''">
                        <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg></span>
                        <b>Anyone</b><span class="muted">no sign-in; anyone who has the address</span>
                    </button>
                    <button type="button" role="radio" class="kind-tile" :class="{on: (m.auth !== '')}" :aria-checked="(m.auth !== '')" :disabled="(walls_here.length === 0)" @click="signed_in_pick">
                        <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><circle cx="12" cy="10.5" r="2"/><path d="M12 12.5v3.5"/></svg></span>
                        <b>Signed in</b><span class="muted">{{ (walls_here.length === 0) ? 'no wall yet' : ('behind ' + ((m.auth === '') ? walls_here[0].name : m.auth) + ': only who signs in') }}</span>
                    </button>
                </div>
                <wall-select v-if="((m.auth !== '') && (walls_here.length > 1))" v-model="m.auth" :walls="walls_here" none="anyone: no sign-in" :self="m.name" @create="$emit('walls')"/>
                <p v-if="(walls_here.length === 0)" class="sf-hint">A sign-in needs a wall: <button type="button" class="link" @click="$emit('walls')">Authwall</button> sets one up.</p>
            </div>
        </template>
        <template #check>
            <p v-if="refused !== ''" class="sf-failed" role="alert"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4L2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg><span><b>Not created: {{ refused }}</b><span>Nothing was written. Change what it says, and create again.</span></span></p>
            <div class="check-rows">
                <div v-for="row of check_rows" :key="row.key" class="check-row">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/>
                    <span class="cr-text"><span :class="{mono: row.mono}">{{ row.text }}</span><span v-if="(row.sub !== '')" class="muted">{{ row.sub }}</span></span>
                    <button type="button" class="link" @click="step_to(row.step)">Change</button>
                </div>
            </div>
            <template v-if="(rest_cards.length > 0)">
                <h3 class="rest-title">The rest at their defaults <span class="muted">· change any, or leave it</span></h3>
                <div class="rest-cards">
                    <div v-for="card of rest_cards" :key="card.id" class="rest-card">
                        <span class="muted"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="card.icon"/>{{ card.title }}</span>
                        <b>{{ card.text }}</b>
                        <button type="button" class="link" @click="rest_change(card.id)">Change</button>
                    </div>
                </div>
            </template>
        </template>
        <template #summary>
            <p v-for="row of check_rows" :key="row.key" class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/><span :class="{mono: row.mono}">{{ row.text }}</span></p>
            <p v-for="card of rest_cards" :key="card.id" class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="card.icon"/><span>{{ card.text }}</span></p>
        </template>
        <template #json>
            <button type="button" class="link" @click="json_toggle">{{ json_open ? 'Hide' : 'Show' }} serviceman.json</button>
        </template>
        <template #note>
            <span v-if="((problem_count > 0) && tried)" class="bad">{{ problem_count === 1 ? 'One thing to fix' : problem_count + ' things to fix' }}</span>
            <span v-if="(refused === '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-if="(creating && simple === false)">
        <div class="list-head">
            <h1>{{ heading }}</h1>
        </div>
        <p v-if="(source_secret_count > 0)" class="muted">The {{ source_secret_count === 1 ? 'secret' : 'secrets' }} of {{ source.name }} stay its own and are not copied — this copy gets secrets of its own.</p>
        <div class="kinds">
            <button v-for="type of KINDS" :key="type" type="button" class="kind" :class="{on: (type === model.type)}" @click="model.type = type">
                <span class="name">{{ KIND_NAMES[type] }}</span>
                <span class="muted">{{ KIND_WORDS[type] }}</span>
            </button>
        </div>
    </template>
    <!-- A service's cards stand in a grid at rest, the one open across it on top; while one is
         made they are a column -->
    <div class="svc-cards" :class="{grid: (creating === false)}">
    <div v-for="section of (simple ? [] : sections)" :key="section.id" class="card svc-sec" :class="{open: section.open, wrong: section.wrong, changed: section.changed, dim: ((creating === false) && (editing !== '') && (section.open === false))}" :id="('svc-' + section.id)">
        <div class="svc-head">
            <b>{{ section.title }}</b>
            <span v-if="section.changed" class="tag svc-changed">changed</span>
            <span v-if="(section.open === false)" class="svc-sum">
                <span v-for="line of section.summary.lines" :key="line">{{ line }}</span>
                <span v-if="section.changed" class="muted">was {{ section.was }}</span>
                <span v-if="(section.summary.warn !== '')" class="svc-warn">{{ section.summary.warn }}</span>
            </span>
            <span class="list-right">
                <button v-if="(section.open === false && section.summary.fix !== null && creating === false)" type="button" :disabled="(editing !== '')" @click="fix(section.summary.fix)">{{ section.summary.fix.label }}</button>
                <button v-if="(section.open === false)" type="button" :disabled="(creating === false && editing !== '')" @click="section_open(section.id)">{{ creating ? 'Change' : 'Edit' }}</button>
                <button v-else-if="(creating && section.must === false)" type="button" @click="section_close(section.id)">Use the defaults</button>
            </span>
        </div>
        <div v-if="section.open" class="grid svc-body">
            <template v-if="(section.id === 'name')">
                <label>Name</label>
                <div>
                    <input v-model.trim="m.name" :placeholder="(easy_name === '' ? 'grafana' : easy_name)" :class="{wrong: problems.name}" spellcheck="false">
                    <p v-if="problems.name" class="bad">{{ problems.name }}</p>
                    <p v-else-if="(creating && m.name === '' && easy_name !== '')" class="muted">Left empty, it is named <code>{{ easy_name }}</code> after its image.</p>
                    <p v-else-if="(m.type === 'files')" class="muted">Lowercase letters, digits, <code>-</code> and <code>_</code>. The addresses made of it go with a new name{{ (m.folder === '' || m.folder === null || m.folder === undefined) ? ', and so does its folder in apps/' : '' }}.</p>
                    <p v-else class="muted">Lowercase letters, digits, <code>-</code> and <code>_</code>. It names the container and the folder.</p>
                </div>
                <label>Title</label>
                <div><input v-model.trim="m.title" placeholder="shown on this page — optional" spellcheck="false"></div>
                <template v-if="(creating === false)">
                    <label>Kind</label>
                    <div>
                        <select v-model="m.type">
                            <option v-for="item of kind_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                        </select>
                        <p v-if="(m.type !== model.type)" class="bad">A new kind keeps the name and the addresses. What runs and where are asked below, and Save takes them all together.</p>
                    </div>
                </template>
            </template>
            <template v-if="(section.id === 'runs' && m.type === 'docker')">
                <label>Image</label>
                <div>
                    <input v-model.trim="m.image" placeholder="grafana/grafana:latest — or paste a whole docker run line" spellcheck="false" @input="image_input" @change="image_change">
                    <label class="check wide"><input type="checkbox" v-model="m.prepull"> fetch it before the first visit, on every machine it may run on</label>
                </div>
                <label>Port inside</label>
                <div>
                    <div class="line">
                        <input v-model.trim="m.port" :placeholder="(detected_port === null ? '80' : String(detected_port))" class="short" :class="{wrong: problems.port}" spellcheck="false">
                        <button v-if="(detected_port !== null && m.port !== String(detected_port))" type="button" class="tab" @click="m.port = String(detected_port)">use {{ detected_port }}, from the image</button>
                    </div>
                    <p v-if="problems.port" class="bad">{{ problems.port }}</p>
                    <p v-else-if="(creating && m.port === '')" class="muted">Left empty, it is {{ detected_port === null ? '80' : detected_port + ', the one the image names' }}.</p>
                    <p v-else class="muted">The port the program listens on inside the container.</p>
                </div>
                <label>Environment</label>
                <div>
                    <div v-for="row of m.env" :key="row.key" class="line pair">
                        <input v-model.trim="row.name" placeholder="NAME" class="name-field" spellcheck="false">
                        <input v-model.trim="row.value" placeholder="value" spellcheck="false">
                        <button type="button" title="Take this variable away" aria-label="Take this variable away" @click="row_drop(m.env, row)">×</button>
                    </div>
                    <button type="button" @click="row_add(m.env, {name: '', value: ''})">+ variable</button>
                </div>
                <label>Network</label>
                <div><input v-model.trim="m.network" placeholder="a docker network — optional" spellcheck="false"></div>
                <label>Init</label>
                <div>
                    <label class="check wide"><input type="checkbox" v-model="m.init"> docker's init as pid 1, so a stop takes a moment rather than the whole timeout</label>
                    <p class="muted">Off for an image that must be pid 1 itself — one built on s6-overlay.</p>
                </div>
            </template>
            <template v-if="(section.id === 'runs' && m.type === 'shell')">
                <label>Command</label>
                <div>
                    <input v-model.trim="m.command" placeholder="node server.js" :class="{wrong: problems.command}" spellcheck="false">
                    <p v-if="problems.command" class="bad">{{ problems.command }}</p>
                    <p v-else class="muted">Run through <code>/bin/sh -c</code>, so pipes and redirections work.</p>
                </div>
                <label>Port</label>
                <div>
                    <input v-model.trim="m.port" placeholder="only when it serves HTTP" class="short" spellcheck="false">
                    <p class="muted">Empty for a program that serves a socket, a tunnel or nothing; it then starts with serviceman and stays up.</p>
                </div>
                <label>Folder</label>
                <div><input v-model.trim="m.cwd" placeholder="a folder of serviceman's own — optional" spellcheck="false"></div>
                <label>Image</label>
                <div>
                    <input v-model.trim="m.image" placeholder="node:26-alpine — optional" spellcheck="false">
                    <p class="muted">Where its lines run, with the folder at <code>/app</code>. Empty runs them on the machine itself.</p>
                </div>
                <template v-if="(m.image !== '')">
                    <label>User</label>
                    <div><input v-model.trim="m.user" placeholder="node:node — optional" spellcheck="false"></div>
                </template>
                <label>Install</label>
                <div>
                    <input v-model.trim="m.install" placeholder="git clone https://github.com/you/app . && npm install — optional" spellcheck="false">
                    <p class="muted">Run once in the folder, before the first start.</p>
                </div>
                <label>Update</label>
                <div><input v-model.trim="m.update" placeholder="git pull && npm install — optional" spellcheck="false"></div>
                <label>Before stop</label>
                <div><input v-model.trim="m.stop" placeholder="bin/flush — optional" spellcheck="false"></div>
                <label>Uninstall</label>
                <div><input v-model.trim="m.uninstall" placeholder="dropdb my_app — optional" spellcheck="false"></div>
                <label>Environment</label>
                <div>
                    <div v-for="row of m.env" :key="row.key" class="line pair">
                        <input v-model.trim="row.name" placeholder="NAME" class="name-field" spellcheck="false">
                        <input v-model.trim="row.value" placeholder="value" spellcheck="false">
                        <button type="button" title="Take this variable away" aria-label="Take this variable away" @click="row_drop(m.env, row)">×</button>
                    </div>
                    <button type="button" @click="row_add(m.env, {name: '', value: ''})">+ variable</button>
                </div>
            </template>
            <template v-if="(section.id === 'runs' && m.type === 'external')">
                <label>Socket</label>
                <div>
                    <input v-model.trim="m.socket" placeholder="~/agency.sock" :class="{wrong: problems.socket}" spellcheck="false">
                    <p v-if="problems.socket" class="bad">{{ problems.socket }}</p>
                    <p v-else class="muted">The socket file its app listens on, in place of an address: serviceman passes every request into it. On a machine from <code>/</code> or <code>~/</code>; on serviceman's own side a path in its <code>{{ state_folder }}/</code> too. Left empty, it answers at the address below.</p>
                </div>
                <label v-if="(m.socket === '')">Answers at</label>
                <div v-if="(m.socket === '')">
                    <input v-model.trim="m.upstream" placeholder="127.0.0.1:7000" :class="{wrong: problems.upstream}" spellcheck="false">
                    <p v-if="problems.upstream" class="bad">{{ problems.upstream }}</p>
                    <p v-else-if="(m.places[0].text !== '')" class="muted">An address <b>on {{ m.places[0].text }}</b>, as <code>host:port</code> — <code>127.0.0.1</code> is that machine's own loopback. serviceman passes requests on and never starts or stops it.</p>
                    <p v-else class="muted">Where it already answers, as <code>host:port</code>. serviceman passes requests on and never starts or stops it.</p>
                </div>
            </template>
            <template v-if="(section.id === 'runs' && m.type === 'files')">
                <label>Folder</label>
                <div>
                    <input v-model.trim="m.folder" :placeholder="('apps/' + (m.name || 'its-name') + ', kept by serviceman')" spellcheck="false">
                    <p class="muted">Its files, served as they are: <code>index.html</code> for any page the app asks for that is no file. Left empty, serviceman keeps them itself, where an app sent to it goes; a folder written here is read from the config's own folder.</p>
                </div>
            </template>
            <template v-if="(section.id === 'where' && m.type === 'external')">
                <label>Machine</label>
                <div>
                    <select v-model="m.places[0].text">
                        <option value="">this host — where serviceman runs</option>
                        <option v-for="item of remote_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>
                    <p class="muted">Where it already runs. A machine of yours is reached through its link: nothing is opened on it, and a port on its own loopback is enough.</p>
                </div>
            </template>
            <template v-if="(section.id === 'where' && m.type !== 'external')">
                <label>Machines</label>
                <div>
                    <div v-for="(row, i) of m.places" :key="row.key" class="line">
                        <span class="muted step">{{ i === 0 ? 'first' : 'then' }}</span>
                        <select v-model="row.text" :class="{wrong: problems.places}" @change="image_change">
                            <option v-for="item of places" :key="item.value" :value="item.value">{{ item.label }}</option>
                        </select>
                        <button v-if="(m.places.length > 1)" type="button" title="Take this machine away" aria-label="Take this machine away" @click="row_drop(m.places, row)">×</button>
                    </div>
                    <button v-if="(places.length > 0)" type="button" @click="row_add(m.places, {text: places[0].value})">+ a machine to fall back on</button>
                    <p v-if="(places.length === 0)" class="bad">No machine yet. It runs where an agent is — add a remote first.</p>
                    <p v-else-if="problems.places" class="bad">{{ problems.places }}</p>
                    <p v-else class="muted">The first one that is online runs it. A <code>#tag</code> is every machine carrying it.</p>
                </div>
            </template>
            <template v-if="(section.id === 'address')">
                <label>Addresses</label>
                <div>
                    <div v-for="row of m.hosts" :key="row.key" class="line">
                        <input v-model.trim="row.text" placeholder="app.example.com or tools.example.com/pdf" :class="{wrong: problems.hosts}" spellcheck="false">
                        <button v-if="(m.hosts.length > 1)" type="button" title="Take this address away" aria-label="Take this address away" @click="row_drop(m.hosts, row)">×</button>
                    </div>
                    <button type="button" @click="row_add(m.hosts, {text: ''})">+ address</button>
                    <p v-if="problems.hosts" class="bad">{{ problems.hosts }}</p>
                    <p v-else-if="(creating && easy_host !== '' && m.hosts.every(v => v.text === ''))" class="muted">Left empty, it is <code>{{ easy_host }}</code>, after its name.</p>
                    <p v-else-if="(m.type === 'shell')" class="muted">Only a program that listens on a port has one. <code>*.example.com</code> is every name under it.</p>
                    <p v-else class="muted">A hostname, with a path if it shares one: <code>tools.example.com/pdf</code>. <code>*.example.com</code> is every name under it.</p>
                </div>
                <template v-if="prefix_on">
                    <label>The path</label>
                    <div>
                        <label class="check wide"><input type="checkbox" :checked="m.strip_prefix" @change="strip_set($event.target.checked)"> taken off before the request arrives — <code>{{ prefix_example.asked }}</code> arrives as <code>{{ prefix_example.seen }}</code></label>
                        <p v-if="(m.strip_prefix === false)" class="svc-warn">The service sees <code>{{ prefix_example.asked }}</code> as it is. Most apps expect to live at <code>/</code> and answer 404 to that.</p>
                    </div>
                </template>
                <label>Sign-in</label>
                <div>
                    <wall-select v-model="m.auth" :walls="(walls || [])" none="open: no sign-in" :self="m.name" @create="$emit('walls')"/>
                    <p class="muted">Behind a wall, every visitor signs in first, at every address it has.</p>
                </div>
                <template v-if="((m.type === 'docker') || (m.type === 'shell'))">
                    <label>Hands over to</label>
                    <div>
                        <input v-model.trim="m.redirect" placeholder="http://localhost:8090 — optional" spellcheck="false">
                        <p class="muted">Once it answers, visitors are sent there — for an app whose cookie or OAuth callback belongs to an address of its own.</p>
                    </div>
                </template>
                <template v-if="(creating === false && redir !== null && redir !== undefined)">
                    <label>Callback address</label>
                    <div>
                        <snip :text="('http://localhost:' + port + redir + '/')"/>
                        <p class="muted">Kept by serviceman for this service, for the rules that accept <code>localhost</code> and nothing else.</p>
                    </div>
                </template>
            </template>
            <template v-if="(section.id === 'ports')">
                <label>Its port</label>
                <div>
                    <input v-model.trim="m.brought.port" :placeholder="brought_says.port.placeholder" class="short" :class="{wrong: brought_says.port.bad}" spellcheck="false" aria-label="The port it listens on">
                    <p :class="(brought_says.port.bad ? 'bad' : 'muted')">{{ brought_says.port.text }}</p>
                </div>
                <label>Brought to</label>
                <div>
                    <div v-for="(row, i) of m.brought.targets" :key="row.key" class="svc-fwd">
                        <div class="line">
                            <select v-model="row.remote" :class="{wrong: (brought_says.targets[i].bad && row.remote === '')}" aria-label="The machine it is brought to">
                                <option value="">a machine…</option>
                                <option v-for="item of target_options" :key="(item.value === null ? 'here' : ('remote-' + item.value))" :value="item.value">{{ item.label }}</option>
                            </select>
                            <span class="svc-fwd-kind">
                                <button type="button" class="tab" :class="{on: (row.kind === 'socket')}" @click="row.kind = 'socket'">a socket file</button>
                                <button type="button" class="tab" :class="{on: (row.kind === 'port')}" @click="row.kind = 'port'">a port</button>
                            </span>
                            <input v-if="(row.kind === 'socket')" v-model.trim="row.socket" :placeholder="brought_says.targets[i].socket" :class="{wrong: (brought_says.targets[i].bad && row.remote !== '')}" spellcheck="false" aria-label="The socket file there">
                            <input v-else v-model.trim="row.port" :placeholder="brought_says.targets[i].port" class="short" :class="{wrong: (brought_says.targets[i].bad && row.remote !== '')}" spellcheck="false" aria-label="The port there">
                            <button type="button" title="Bring it to this machine no more" aria-label="Bring it to this machine no more" @click="row_drop(m.brought.targets, row)">×</button>
                        </div>
                        <p :class="(brought_says.targets[i].bad ? 'bad' : 'muted')">{{ brought_says.targets[i].text }}</p>
                        <p v-if="(brought_says.targets[i].away !== '')" class="svc-warn">{{ brought_says.targets[i].away }}</p>
                    </div>
                    <button type="button" @click="click_another_machine">{{ (m.brought.targets.length === 0 ? '+ a machine' : '+ another machine') }}</button>
                    <p v-for="item of m.brought.kept" :key="item.label" class="muted">Also <code>{{ item.label }}</code>, written by hand: it stays as it is, and is changed on Forwards.</p>
                    <p v-if="(m.brought.targets.length === 0 && m.brought.kept.length === 0)" class="muted">It is reached on its machine alone. On a machine picked here its port shows up as a socket file, or a port on that machine's loopback, the way <code>ssh -L</code> brings one, with no ssh: the agents carry it. This host, where serviceman runs, needs no agent.</p>
                    <p v-if="brought_sleeps" class="svc-warn">It starts at the first request to its address and sleeps when idle, and a connection to its port over there does not wake it: under When it runs, start it with serviceman.</p>
                </div>
            </template>
            <template v-if="(section.id === 'keep')">
                <label>Kept paths</label>
                <div>
                    <div v-for="row of m.volumes" :key="row.key" class="line">
                        <input v-model.trim="row.target" placeholder="/app/data" spellcheck="false">
                        <span v-if="(row.source !== '')" class="muted step">{{ row.source }}{{ (row.readonly ? ' · read only' : '') }}</span>
                        <button type="button" title="Take this path away" aria-label="Take this path away" @click="row_drop(m.volumes, row)">×</button>
                    </div>
                    <button type="button" @click="row_add(m.volumes, {source: '', target: '', readonly: false})">+ path</button>
                    <p class="muted">These survive a restart; everything else it writes goes with it. What is kept stays on its machine, so a service that keeps something runs on one machine.</p>
                </div>
                <template v-if="(m.type === 'shell')">
                    <label>Secrets</label>
                    <div>
                        <div v-for="row of m.secrets" :key="row.key" class="line pair">
                            <input v-model.trim="row.name" placeholder="credentials" class="name-field" :class="{wrong: (secret_said(row).name !== '')}" spellcheck="false">
                            <input v-model="row.value" :placeholder="(row.kept ? row.length + ' characters kept — type to replace' : 'the value the program reads')" :class="{wrong: (secret_said(row).value !== '')}" spellcheck="false">
                            <select v-if="(library.length > 0)" v-model="row.copy_from">
                                <option value="">or copy from…</option>
                                <option v-for="item of library_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                            </select>
                            <button type="button" title="Take this secret away" aria-label="Take this secret away" @click="row_drop(m.secrets, row)">×</button>
                        </div>
                        <button type="button" @click="row_add(m.secrets, {name: '', value: '', copy_from: '', kept: false, length: 0})">+ secret</button>
                        <p v-if="problems.secrets" class="bad">{{ problems.secrets }}</p>
                        <p v-else class="muted">The program reads one with <code>secrets &lt;name&gt;</code>. They are this service's own and never in the config.</p>
                    </div>
                </template>
            </template>
            <template v-if="(section.id === 'policy')">
                <label>Start</label>
                <div class="line">
                    <button type="button" class="tab" :class="{on: (m.start === 'on_demand')}" @click="m.start = 'on_demand'">at the first request</button>
                    <button type="button" class="tab" :class="{on: (m.start === 'always')}" @click="m.start = 'always'">with serviceman, and stay up</button>
                </div>
                <template v-if="(m.start !== 'always' && (m.type !== 'shell' || m.port !== ''))">
                    <label>Sleep after</label>
                    <div class="line">
                        <duration v-if="(m.never_stop === false)" v-model="m.stop_after_idle" placeholder="10m"/>
                        <span v-else class="muted">it stays up until it is stopped</span>
                        <button v-for="text of IDLE_STEPS" :key="text" type="button" class="tab" :class="{on: (m.never_stop === false && m.stop_after_idle === text)}" @click="idle_set(text)">{{ text }}</button>
                        <button type="button" class="tab" :class="{on: m.never_stop}" @click="m.never_stop = true">never</button>
                    </div>
                </template>
                <label>Restart</label>
                <div>
                    <select v-model="m.restart">
                        <option value="on_failure">when it stops badly</option>
                        <option value="always">whenever it stops</option>
                        <option value="never">never — leave it stopped</option>
                    </select>
                </div>
                <label>Tries</label>
                <div>
                    <input v-model.trim="m.start_tries" placeholder="2" class="short" spellcheck="false">
                    <p class="muted">Failed starts in a row before serviceman stops trying.</p>
                </div>
                <label>Start timeout</label>
                <div><duration v-model="m.start_timeout" placeholder="120s"/></div>
                <label>Stop timeout</label>
                <div><duration v-model="m.stop_timeout" :placeholder="(m.type === 'shell' && m.image === '' ? '5s' : '10s')"/></div>
                <label>Request timeout</label>
                <div class="line">
                    <duration v-if="(m.never_request_timeout === false)" v-model="m.request_timeout" placeholder="60s"/>
                    <span v-else class="muted">it waits for as long as the answer takes</span>
                    <button type="button" class="tab" :class="{on: m.never_request_timeout}" @click="m.never_request_timeout = !m.never_request_timeout">wait forever</button>
                </div>
            </template>
            <template v-if="(section.id === 'scale')">
                <label>Copies</label>
                <div>
                    <label class="check"><input type="checkbox" :checked="scaling_on" @change="pool_set($event.target.checked)"> run more than one copy</label>
                    <div v-if="scaling_on" class="line">
                        <span class="muted">between</span>
                        <input v-model.trim="m.min" placeholder="0" class="tiny" spellcheck="false">
                        <span class="muted">and</span>
                        <input v-model.trim="m.max" placeholder="1" class="tiny" spellcheck="false">
                    </div>
                </div>
                <label>Each takes</label>
                <div>
                    <div class="line"><input v-model.trim="m.concurrency" placeholder="unlimited" class="tiny" spellcheck="false"> <span class="muted">requests at once</span></div>
                    <p class="muted">{{ pool_words }}</p>
                </div>
                <template v-if="scaling_on">
                    <label>Warm up when</label>
                    <div class="line">
                        <input v-model.trim="m.warmup_queue" placeholder="1" class="tiny" spellcheck="false"> <span class="muted">wait, or one waits</span>
                        <duration v-model="m.warmup_wait" placeholder="2s"/>
                    </div>
                    <label>Shrink after</label>
                    <div><duration v-model="m.scale_down_after" placeholder="2m"/></div>
                    <label>Follow the load</label>
                    <div>
                        <label class="check wide"><input type="checkbox" v-model="m.autoscale" :disabled="(m.concurrency === '')"> grow and shrink the pool with how busy it is</label>
                        <p v-if="(m.concurrency === '')" class="muted">Needs a number above: busy is the work over what the copies take at once.</p>
                    </div>
                    <template v-if="m.autoscale">
                        <label>Another copy</label>
                        <div class="line">
                            <span class="muted">over</span> <input v-model.trim="busy_up_percent" placeholder="70" class="tiny" spellcheck="false"> <span class="muted">% busy for</span> <duration v-model="m.up_for" placeholder="10s"/>
                        </div>
                        <label>One fewer</label>
                        <div class="line">
                            <span class="muted">under</span> <input v-model.trim="busy_down_percent" placeholder="20" class="tiny" spellcheck="false"> <span class="muted">% busy for</span> <duration v-model="m.down_for" placeholder="2m"/>
                        </div>
                        <label>Then wait</label>
                        <div><duration v-model="m.cool_down" placeholder="1m"/></div>
                    </template>
                </template>
            </template>
        </div>
        <div v-if="(section.open && section.last && creating === false)" class="svc-foot">
            <button type="button" class="primary" :disabled="busy" @click="section_save_one"><span v-if="busy" class="spin"/>{{ busy ? 'saving…' : 'Save' }}</button>
            <button type="button" :disabled="busy" @click="section_cancel">Cancel</button>
            <span :class="(bad ? 'bad' : 'muted')">{{ foot_says }}</span>
        </div>
    </div>
    </div>
    <div v-if="(creating === false)" class="card svc-sec svc-remove" :class="{dim: (editing !== '')}">
        <div class="svc-head">
            <b>Remove</b>
            <span v-if="(removing === false)" class="svc-sum"><span>Takes {{ model.name }} out of the config{{ forwards_gone }}. Anything running keeps running.</span></span>
            <span v-else class="svc-sum"><span class="svc-warn">Forget {{ model.name }}{{ forwards_gone }}? Anything running keeps running; nothing will start it again.</span></span>
            <span class="list-right">
                <button v-if="(removing === false)" type="button" class="danger" :disabled="(editing !== '')" @click="removing = true">Remove…</button>
                <template v-else>
                    <button type="button" class="danger" :disabled="busy" @click="remove">Forget it</button>
                    <button type="button" @click="removing = false">Keep it</button>
                </template>
            </span>
        </div>
    </div>
    <copy-progress v-if="(creating && (files_copy !== null))" :copy="files_copy"/>
    <div v-if="(creating && (simple === false))" class="svc-create">
        <button type="button" class="primary" :disabled="busy" @click="create"><span v-if="busy" class="spin"/>{{ busy ? 'creating…' : 'Create service' }}</button>
        <button type="button" @click="$emit('close')">Cancel</button>
        <span v-if="(problem_count > 0)" class="bad">{{ problem_count === 1 ? 'One thing to fix' : problem_count + ' things to fix' }}</span>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
    <div v-if="(((creating && simple) === false) || json_open)" ref="json" class="svc-json" :class="{framed: (creating && simple)}">
        <button v-if="((creating && simple) === false)" type="button" class="link" @click="json_toggle">{{ json_open ? 'Hide' : 'Show' }} what {{ creating ? 'Create' : 'Save' }} writes to serviceman.json</button>
        <pre v-if="json_open" class="tail">{{ config_text }}</pre>
    </div>
</article>
`,
    components: {'copy-progress': copy_progress, duration, 'machine-tile': machine_tile, snip: snippet, 'step-frame': step_frame, 'wall-select': wall_select},
    // folder: the one serviceman keeps its own things in, as its owner sees it (data); walls:
    // walls_of(state), for the Sign-in list
    // tied: the config file's forwards that are part of the service, as the file has them;
    // forward_labels: the label of every forward of the config, for a new one's to be its own
    // restore: what a new service's form held when Add a machine left it, {model, what, step,
    // mode, app_files}, taken up again with the machine made
    // kinds: how the Canvas draws each machine, by its name; counts: how many services each runs
    props: ['remotes', 'names', 'walls', 'original', 'source', 'remote', 'control', 'port', 'redir', 'ports_taken', 'folder', 'tied', 'forward_labels', 'restore', 'kinds', 'counts'],
    emits: ['close', 'databases', 'machine', 'saved', 'walls'],
    data: function () {
        const source = (this.source === undefined) ? null : this.source;
        const model = form_from_service((this.original === null) ? source : this.original);
        // A clone brings no forward over: its own would listen where the original's do
        model.brought = brought_from_forwards(((this.original === null) || (this.tied === undefined)) ? [] : this.tied);
        // A clone is a new service with the settings carried over; the name and the address must be its own
        if ((this.original === null) && (source !== null)) {
            model.name = name_free(source.name, this.names || []);
            model.hosts = [{key: Math.random(), text: ''}];
        }
        const restore = ((this.restore === undefined) || (this.restore === null)) ? null : this.restore;
        if (restore !== null) {
            Object.assign(model, restore.model);
        }
        // A new one is asked its address in a row of its own, filled from its name when left empty
        if ((this.original === null) && (model.hosts.length === 0)) {
            model.hosts.push({key: Math.random(), text: ''});
        }
        return {
            // The tile picked on the first step, step by step or on one page, the step open,
            // and how the form is shown
            what: (restore === null) ? 'docker' : restore.what,
            step: (restore === null) ? 0 : restore.step,
            mode: (restore === null) ? 'steps' : restore.mode,
            // The machine this form picked by itself for a new service, so a change of kind can
            // take it back again
            place_given: null,
            // A new service starts as the short form; a clone carries settings worth seeing
            simple: (this.original === null) && (source === null),
            IDLE_STEPS,
            KINDS,
            KIND_NAMES,
            KIND_WORDS,
            SHORT_KINDS,
            SHORT_NAMES,
            SHORT_WORDS,
            model,
            // The copy a card edits on a service that exists; the page keeps showing the saved
            // one until Save lands
            draft: null,
            // The card open on a service that exists, one at a time
            editing: '',
            // What waited for Save when that card was opened, for its Cancel to put back
            snapshot: null,
            // The optional cards opened while making one
            opened: {},
            // Whether the path checkbox was touched: until it is, an address with a path takes
            // the path off, because that is what almost every app expects
            strip_touched: false,
            json_open: false,
            // The library on the rail, to copy a value from without ever seeing it here
            library: [],
            // Rows taken away here are removed on the machine when the card is saved
            secrets_gone: [],
            // A save that landed while a secret of it did not: the cards are then older than
            // what serviceman has
            half: false,
            detected_port: null,
            // What serviceman said when it refused Create; nothing was written
            refused: '',
            // The app, a folder or a zip of this computer, read here and sent to its machine
            // as its files on Create (app_entries_read), and the name it gives the app
            app_files: (restore === null) ? null : restore.app_files,
            // The app's files on their way to its machine, as every copy is shown
            files_copy: null,
            drop_over: false,
            // The ports its machine listens on now, so the one an app is given is free there
            ports_busy: [],
            note: '',
            bad: false,
            busy: false,
            source_secret_count: 0,
            // Set by the first Save. Until then the form says nothing about what is merely empty.
            tried: false,
            removing: false,
        };
    },
    computed: {
        creating: function () {
            return this.original === null;
        },
        kind_options: function () {
            return KINDS.map(v => ({value: v, label: KIND_NAMES[v]}));
        },
        remote_options: function () {
            return this.remotes.map(v => ({value: v.name, label: this.remote_text(v)}));
        },
        // The machines a program's port may be brought to: this host, where serviceman runs (null,
        // `to.here`), and any machine, its own too, to its own loopback
        target_options: function () {
            const machine = machine_of(this.m);
            const machines = this.remotes.map(v => ({value: v.name, label: (v.name === machine) ? `${this.remote_text(v)} — where it runs` : this.remote_text(v)}));
            return [{value: null, label: 'this host — where serviceman runs'}].concat(machines);
        },
        // Whether the card that brings a program's port over is open, and its Save or Create
        // writes the forwards that are part of it
        brought_open: function () {
            return (this.m.type === 'shell') && (this.creating ? (this.opened.ports === true) : (this.editing === 'ports'));
        },
        brought_says: function () {
            return brought_said(this.m.brought, this.program_of(this.m));
        },
        // A program that sleeps when idle, its port brought over: a connection there wakes nothing
        brought_sleeps: function () {
            return (this.m.brought.targets.length > 0) && (this.m.port !== '') && (this.m.start !== 'always');
        },
        // The forwards a removal takes along, said before it, as a clause
        forwards_gone: function () {
            const count = this.model.brought.targets.length + this.model.brought.kept.length;
            if (count === 0) {
                return '';
            }
            return (count === 1) ? ', with the forward that brings its port over' : `, with the ${count} forwards that bring its port over`;
        },
        library_options: function () {
            return this.library.map(v => ({value: v, label: v}));
        },
        // The model the fields are bound to: the draft of the open card, or the new service
        m: function () {
            return (this.draft === null) ? this.model : this.draft;
        },
        what_items: function () {
            return WHAT.map(v => Object.assign({}, v, {icon: (v.like === null) ? v.icon : service_kind(v.like).icon}));
        },
        what_item: function () {
            return this.what_items.find(v => v.key === this.what);
        },
        // The steps of what was picked: what it is, where it comes from, the machine it runs on
        // for what runs on one, its address, then Check; each with its answer so far
        steps: function () {
            const now = this.model_now();
            const source = SOURCE_STEP[this.what] || SOURCE_STEP.docker;
            const out = [{key: 'what', name: 'What', question: 'What will it run?', says: 'Pick one; the next steps ask only what it needs.', answer: this.what_item.name}];
            out.push({key: 'source', name: source.name, question: source.question, says: source.says, answer: this.source_answer(now)});
            if (['docker', 'app', 'program'].includes(this.what)) {
                const says = (this.machine_cards.length === 0) ? NO_MACHINE_SAYS[this.what] : 'A machine whose agent is online; the free memory is now.';
                out.push({key: 'machine', name: 'Machine', question: 'Where will it run?', says, answer: (now.places[0].text === '') ? '' : now.places[0].text});
            }
            const host = now.hosts.find(v => v.text !== '');
            out.push({key: 'address', name: 'Address', question: 'Where will people open it?', says: 'A name a request arrives on; serviceman routes it to this service.', answer: (host === undefined) ? '' : host.text});
            out.push({key: 'check', name: 'Check', question: 'Check, then create', says: 'What Create writes, one row an answer.', answer: ''});
            return out;
        },
        // Whether the step open has what it needs to go on, and why not
        next_ok: function () {
            const key = this.steps[Math.min(this.step, this.steps.length - 1)].key;
            const problems = this.problems;
            const bad = (STEP_PROBLEMS[key] || []).find(v => problems[v] !== undefined);
            if (bad !== undefined) {
                return {ok: false, why: problems[bad]};
            }
            const now = this.model_now();
            const missing = {
                source: {docker: (now.image === '') ? 'Which image, first' : '', app: (this.app_files === null) ? 'Pick the app first' : '', program: (now.command === '') ? 'The line that runs it, first' : '', files: (now.folder === '') ? 'Which folder, first' : '', socket: '', external: (now.upstream === '') ? 'Where it answers, first' : ''}[this.what],
                machine: (now.places[0].text === '') ? 'Pick a machine first' : '',
            }[key] || '';
            if ((missing === '') && (key === 'source') && (now.name === '')) {
                return {ok: false, why: 'A name first'};
            }
            return {ok: (missing === ''), why: missing};
        },
        // A card for each machine, and for each tag, any machine with it: online or since when
        // it is away, its system and its free memory
        machine_cards: function () {
            const kinds = this.kinds || {};
            const counts = this.counts || {};
            const out = this.remotes.map(v => Object.assign(machine_card(v, kinds[v.name], counts[v.name] || 0), {disabled: false, why: ''}));
            for (const item of this.places.filter(v => v.value.startsWith('#'))) {
                const one = (this.what === 'app');
                out.push({value: item.value, title: item.value, icon: TAG_ICON, dot: '', away: false, lines: ['any machine with the tag'], meter: null, disabled: one, why: one ? 'An app folder is on one machine: pick that one' : ''});
            }
            return out;
        },
        walls_here: function () {
            return ((this.walls === undefined) || (this.walls === null)) ? [] : this.walls;
        },
        // What Create makes, a row each, every one with the step that changes it
        check_rows: function () {
            const now = this.model_now();
            const answer = this.source_answer(now);
            const out = [{key: 'source', step: 'source', icon: this.what_item.icon, text: (answer === '') ? this.what_item.name : answer, mono: (answer !== ''), sub: this.source_sub(now)}];
            if (this.steps.some(v => v.key === 'machine')) {
                const place = now.places[0].text;
                const card = this.machine_cards.find(v => v.value === place);
                const room = ((card === undefined) || (card.meter === null)) ? '' : card.lines[card.lines.length - 1];
                out.push({key: 'machine', step: 'machine', icon: (card === undefined) ? MACHINE_ICON : card.icon, text: (place === '') ? 'No machine yet' : `Runs on ${place}${((card === undefined) || (card.dot !== 'off')) ? '' : ' (offline)'}`, mono: false, sub: room});
            }
            const hosts = now.hosts.map(v => v.text).filter(v => v !== '');
            out.push({key: 'address', step: 'address', icon: GLOBE_ICON, text: (hosts.length === 0) ? 'No address yet' : hosts.join(', '), mono: (hosts.length > 0), sub: ''});
            out.push({key: 'who', step: 'address', icon: SHIELD_ICON, text: (now.auth === '') ? 'Anyone' : 'Signed in only', mono: false, sub: (now.auth === '') ? 'no sign-in' : `behind ${now.auth}`});
            return out;
        },
        // What a new one has at serviceman's defaults, each a card that opens its part of the
        // whole form: its data, when it runs, its copies, for the kinds that have them
        rest_cards: function () {
            const now = this.model_now();
            const cards = [{id: 'keep', title: 'Its data'}, {id: 'policy', title: 'When it runs'}, {id: 'scale', title: 'Copies'}];
            return cards.filter(v => SECTIONS.find(vv => vv.id === v.id).kinds.includes(now.type)).map(v => Object.assign({}, v, {icon: REST_ICONS[v.id], text: this.summary_of(v.id, now).lines[0]}));
        },
        // Create, or Create again once serviceman refused it
        create_label: function () {
            return (this.refused === '') ? 'Create service' : 'Create again';
        },
        heading: function () {
            if ((this.source !== undefined) && (this.source !== null)) {
                return `Clone of ${this.source.title || this.source.name}`;
            }
            return 'New service';
        },
        sections: function () {
            const out = [];
            for (const item of SECTIONS) {
                if (item.kinds.includes(this.m.type) === false) {
                    continue;
                }
                const open = this.creating ? (item.must || (this.opened[item.id] === true)) : ((this.editing === item.id) || (this.kind_changing && item.must));
                const wrong = (SECTION_PROBLEMS[item.id] || []).some(v => this.problems[v] !== undefined);
                // A folder of files has nothing that runs: its card says what it serves
                const title = ((item.id === 'runs') && (this.m.type === 'files')) ? 'What it serves' : item.title;
                const changed = (this.creating === false) && this.changed_ids.includes(item.id);
                const was = changed ? this.summary_of(item.id, this.model).lines[0] : '';
                out.push({id: item.id, title, must: item.must, open, wrong, last: false, changed, was, summary: this.summary_of(item.id, this.m)});
            }
            // Save and Cancel go under the last card open: a new kind opens several at once
            const opened = out.filter(v => v.open);
            if (opened.length > 0) {
                opened[opened.length - 1].last = true;
            }
            return out;
        },
        // The cards whose fields differ from what is saved, while changes wait for Save
        changed_ids: function () {
            if ((this.creating === true) || (this.draft === null)) {
                return [];
            }
            const draft = this.draft;
            const model = this.model;
            const out = Object.keys(SECTION_FIELDS).filter(v => SECTION_FIELDS[v].some(vv => JSON.stringify(draft[vv]) !== JSON.stringify(model[vv])));
            if ((this.secrets_gone.length > 0) && (out.includes('keep') === false)) {
                out.push('keep');
            }
            return out;
        },
        // What Save does, in a line: the card written at once, and the service taking it at its
        // next start, never started by the save; on another machine, what it kept stays where it was
        save_says: function () {
            const name = this.model.name;
            if (this.changed_ids.includes('where') && (this.model.volumes.length > 0)) {
                return `Save writes it now. ${name} runs on ${this.place_text(this.draft.places[0].text)} from its next start; what it kept stays on ${this.place_text(this.model.places[0].text)}.`;
            }
            if (this.changed_ids.includes('where')) {
                return `Save writes it now. ${name} runs on ${this.place_text(this.draft.places[0].text)} from its next start.`;
            }
            return `Save writes it now; ${name} takes it at its next start.`;
        },
        // Under the open card's Save: what to put right, what went wrong, or what Save does
        foot_says: function () {
            if (this.tried && (this.problems_here().length > 0)) {
                return 'Something here is to be put right first';
            }
            if (this.note !== '') {
                return this.note;
            }
            return this.save_says;
        },
        // The kind is being changed in the Name card: what the new kind needs is asked in the
        // same save, since a kind with nothing said about what runs is not a service at all
        kind_changing: function () {
            return (this.creating === false) && (this.editing === 'name') && (this.m.type !== this.model.type);
        },
        // Whether the form was opened from a machine's page, for a new service on that machine
        from_machine: function () {
            return this.places.some(v => v.value === this.remote);
        },
        // The machine a new service is given: the one it was added from, or the first there is
        place_default: function () {
            const found = this.places.find(v => v.value === this.remote);
            return (found === undefined) ? this.places[0].value : found.value;
        },
        places: function () {
            const out = [];
            const tags = [];
            for (const item of this.remotes) {
                out.push({value: item.name, label: this.remote_text(item)});
                for (const tag of item.tags) {
                    if (tags.includes(tag) === false) {
                        tags.push(tag);
                    }
                }
            }
            for (const tag of tags.sort()) {
                out.push({value: `#${tag}`, label: `#${tag} — any machine with the tag`});
            }
            return out;
        },
        scaling_on: function () {
            return parseInt(this.m.max, 10) > 1;
        },
        // What the two numbers come to, said as a sentence, because nobody multiplies copies by
        // concurrency in their head while filling in a form
        pool_words: function () {
            const each = parseInt(this.m.concurrency, 10);
            if ((Number.isFinite(each) === false) || (each < 1)) {
                return 'Empty takes everything that arrives, so nothing ever waits in line.';
            }
            const copies = this.scaling_on ? (parseInt(this.m.max, 10) || 1) : 1;
            return `${(copies === 1) ? 'One copy takes' : `${copies} copies take`} ${copies*each} at once; the next one waits in line.`;
        },
        // The address a new docker service answers on when none is given: its name, under the
        // control page's own domain — serviceman.localhost gives grafana.localhost
        easy_host: function () {
            const name = this.model_now().name;
            if ((this.creating === false) || ((this.made_short === false) && (this.simple === false)) || (/^[a-z0-9][a-z0-9_-]*$/.test(name) === false)) {
                return '';
            }
            return this.host_from_name(name);
        },
        // A proxy's socket unless another is typed: named after it, in its agent's home, or in
        // serviceman's own folder on its side
        socket_default: function () {
            const name = (this.m.name === '') ? this.easy_name : this.m.name;
            const file = `${(name === '') ? 'agency' : name}.sock`;
            return (this.m.places[0].text === '') ? `${this.state_folder}/sockets/${file}` : `~/${file}`;
        },
        state_folder: function () {
            return ((this.folder === undefined) || (this.folder === null) || (this.folder === '')) ? 'data' : this.folder;
        },
        easy_name: function () {
            if ((this.m.type === 'shell') && this.made_short && (this.app_files !== null)) {
                return name_free(this.app_files.name, this.names || []);
            }
            if ((this.m.type === 'files') && this.simple && (this.m.folder !== '')) {
                return name_free(name_from_folder(this.m.folder), this.names || []);
            }
            if ((this.m.type !== 'docker') || (this.m.image === '')) {
                return '';
            }
            return name_free(name_from_image(this.m.image), this.names || []);
        },
        // Where the machine's agent keeps everything it installs, null while it has not said
        app_home: function () {
            const found = this.remotes.find(v => v.name === this.m.places[0].text);
            return ((found === undefined) || (found.machine === null) || (found.machine.services === null)) ? null : found.machine.services.replace(/\/+$/, '');
        },
        // The app's folder on its machine: serviceman's choice, a folder of its own named after it
        app_dir: function () {
            const name = (this.m.name === '') ? this.easy_name : this.m.name;
            return ((this.app_home === null) || (name === '')) ? '' : `${this.app_home}/${name}`;
        },
        // What runs in the app folder picked, in order: bin/configure and bin/build once, for
        // those it has, then bin/run
        app_steps: function () {
            const setup = (this.app_files === null) ? '' : app_setup_text(this.app_files);
            return (setup === '') ? 'bin/run, with nothing to configure or build first' : `${setup} once, then bin/run`;
        },
        // Whether what is made fills itself in from the short form: an image always does, an
        // app folder while it is made there
        made_short: function () {
            return (this.m.type === 'docker') || (this.simple && ((this.what === 'app') || (this.what === 'socket')));
        },
        // The port an app folder is given: the first one no program of serviceman's is given
        // and its machine does not listen on now
        app_port: function () {
            const taken = (this.ports_taken || []).concat(this.ports_busy);
            let out = APP_PORT_FIRST;
            while (taken.includes(out)) {
                out++;
            }
            return out;
        },
        // The entry, and the forwards that are part of it when this save writes them
        config_text: function () {
            const model = this.model_now();
            const entry = JSON.stringify(this.entry_of(model), null, 4);
            const forwards = this.forwards_written(model);
            return (forwards === null) ? entry : `${entry}\n\n"forwards", the ones that are part of it:\n${JSON.stringify(forwards, null, 4)}`;
        },
        // A folder of files is served from its path down whatever this says: its files are at
        // the root of its folder
        prefix_on: function () {
            return (this.m.type !== 'files') && this.m.hosts.some(v => v.text.includes('/'));
        },
        // Whether the service as saved already answers on a path; its choice about the path
        // is then its own, and a new path does not overrule it
        saved_has_path: function () {
            return this.model.hosts.some(v => v.text.includes('/'));
        },
        prefix_example: function () {
            const host = this.m.hosts.find(v => v.text.includes('/'));
            const prefix = (host === undefined) ? '' : host.text.slice(host.text.indexOf('/')).replace(/\/+$/, '');
            return {asked: `${prefix}/x`, seen: '/x'};
        },
        busy_up_percent: {
            get: function () {
                return share_percent(this.m.busy_up);
            },
            set: function (text) {
                this.m.busy_up = percent_share(text);
            },
        },
        busy_down_percent: {
            get: function () {
                return share_percent(this.m.busy_down);
            },
            set: function (text) {
                this.m.busy_down = percent_share(text);
            },
        },
        // What is wrong as the fields stand, by the field it is wrong in. Something typed that
        // cannot work is said at once; a field nobody has filled in yet waits for Save.
        problems: function () {
            const out = {};
            const model = this.m;
            for (const row of model.hosts) {
                if (/^[a-z][a-z0-9+.-]*:\/\//i.test(row.text)) {
                    out.hosts = 'An address is a hostname, not a URL: leave the scheme off.';
                }
                else if (/\s/.test(row.text)) {
                    out.hosts = 'An address has no spaces in it.';
                }
                else if (/^[^/]*:\d+/.test(row.text)) {
                    out.hosts = 'An address has no port: serviceman answers it on its own port. Leave the :port off.';
                }
            }
            if ((model.type === 'external') && /^[a-z][a-z0-9+.-]*:\/\//i.test(model.upstream)) {
                out.upstream = 'host:port, not a URL: leave the scheme off — 127.0.0.1:8081.';
            }
            if (model.type === 'docker') {
                const port = this.model_now().port;
                if (port === '') {
                    if (this.tried) {
                        out.port = 'A port is needed — the one it listens on inside.';
                    }
                }
                else if (/^\d+$/.test(port) === false) {
                    out.port = 'A port is a whole number — the one it listens on inside.';
                }
            }
            const places = model.places.map(v => v.text).filter(v => v !== '');
            if (model.volumes.some(v => v.target !== '') && ((places.length > 1) || places.some(v => v.startsWith('#')))) {
                out.places = 'It keeps something, and what it keeps stays on one machine — name one, not a list and not a tag.';
            }
            if (this.tried && ((model.type === 'docker') || (model.type === 'shell')) && (places.length === 0) && (this.places.length > 0)) {
                out.places = 'It runs on a machine with an agent — pick one.';
            }
            if (this.tried && (model.type === 'shell') && (this.model_now().command === '')) {
                out.command = 'A program needs the line that runs it.';
            }
            if ((model.type === 'shell') && this.simple && this.creating && (this.what === 'app')) {
                if (this.tried && (this.app_files === null)) {
                    out.cwd = 'Pick the app: its folder, or a .zip of it.';
                }
                else if ((this.app_files !== null) && (this.app_files.problem !== null)) {
                    out.cwd = this.app_files.problem;
                }
                else if ((this.app_files !== null) && (this.app_home === null) && (places.length > 0) && (places[0].startsWith('#') === false)) {
                    out.cwd = `${this.place_text(places[0])} has not said where its agent keeps what it installs: it has not dialled in since its agent was updated. Once it has, the app goes there.`;
                }
                if ((places.length > 0) && places[0].startsWith('#')) {
                    out.places = 'An app folder is on one machine: pick that one, not a tag.';
                }
            }
            if (this.tried && (model.type === 'external') && (model.upstream === '') && (this.model_now().socket === '')) {
                out.upstream = 'Where it already answers is needed, as host:port, or the socket file it listens on.';
            }
            if ((model.type === 'external') && (places.length > 0) && places[0].startsWith('#')) {
                out.places = 'It runs on one machine: pick that one, not a tag.';
            }
            if ((model.type === 'external') && (places.length > 0) && (model.socket !== '') && (model.socket.startsWith('/') === false) && (model.socket.startsWith('~/') === false)) {
                out.socket = 'On a machine, the path of the socket file from / or from ~/: ~/agency.sock.';
            }
            // An app not picked yet is said once, where it is picked: the name comes from it
            const unpicked = (model.type === 'shell') && this.simple && this.creating && (this.what === 'app') && (this.app_files === null);
            if (this.tried && (this.model_now().name === '') && (unpicked === false)) {
                out.name = 'A service needs a name.';
            }
            else if ((model.name !== '') && (/^[a-z0-9][a-z0-9_-]*$/.test(model.name) === false)) {
                out.name = 'Lowercase letters, digits, - and _ only, starting with a letter or a digit.';
            }
            const secret = (model.type === 'shell') ? model.secrets.map(v => this.secret_said(v)).find(v => (v.name !== '') || (v.value !== '')) : undefined;
            if (secret !== undefined) {
                out.secrets = secret.name || secret.value;
            }
            if (this.brought_open && (this.brought_says.problem !== null)) {
                out.brought = this.brought_says.problem;
            }
            return out;
        },
        problem_count: function () {
            return Object.keys(this.problems).length;
        },
    },
    watch: {
        // While a new one is made, the machine given by default follows the kind: something
        // already running starts on this host, a proxy (the short form's) in serviceman's own
        // data/ folder unless the form was opened from a machine's page, a container or a
        // program on the default machine
        'model.type': function (type) {
            if (this.creating === false) {
                return;
            }
            const place = this.model.places[0];
            if ((type === 'external') && this.simple && this.from_machine) {
                return;
            }
            if ((type === 'external') && (place.text === this.place_given)) {
                place.text = '';
            }
            else if ((type !== 'external') && (place.text === '') && (this.places.length > 0)) {
                place.text = this.place_default;
                this.place_given = place.text;
            }
        },
        // A path typed into a new address takes the path off, unless somebody has said otherwise
        prefix_on: function (on) {
            if (on && (this.strip_touched === false) && (this.creating || (this.saved_has_path === false))) {
                this.m.strip_prefix = true;
            }
        },
    },
    methods: {
        host_from_name: function (name) {
            const host = ((this.control === undefined) || (this.control === null) || (typeof this.control.host !== 'string')) ? 'localhost' : this.control.host;
            const at = host.indexOf('.');
            // A hostname has no _ in it: speedtest_laptop answers on speedtest-laptop
            return `${name.replace(/_/g, '-')}.${(at === -1) ? host : host.slice(at + 1)}`;
        },
        // The model Save sends. A new docker service left without a name is named after its
        // image, one left without a port takes the one its image names, or 80, and one left
        // without an address answers on its name — what the empty boxes say they stand for.
        model_now: function () {
            const model = this.m;
            if ((this.creating === false) || ((this.made_short === false) && (this.simple === false))) {
                return model;
            }
            const name = (model.name === '') ? this.easy_name : model.name;
            const out = Object.assign({}, model, {name});
            if (model.type === 'docker') {
                out.port = (model.port === '') ? String((this.detected_port === null) ? 80 : this.detected_port) : model.port;
            }
            else if ((model.type === 'external') && (this.what === 'socket')) {
                // A proxy's socket is named after it unless another is typed
                out.socket = (model.socket === '') ? this.socket_default : model.socket;
                out.upstream = '';
            }
            else if (model.type === 'external') {
                out.socket = '';
            }
            else if ((model.type === 'shell') && (this.what === 'program')) {
                // A program on its machine, on the first port free there unless another is typed
                out.port = (model.port === '') ? String(this.app_port) : model.port;
            }
            else if (model.type === 'shell') {
                // An app folder is one shape of program: bin/run on its port, bin/configure and
                // bin/build first when the folder has them, in the folder serviceman gives it
                const files = this.app_files;
                const setup = (files !== null) && (files.configure || files.build);
                Object.assign(out, {command: 'bin/run', install: setup ? app_setup_line : '', port: String(this.app_port), image: '', cwd: this.app_dir});
            }
            if ((name !== '') && model.hosts.every(v => v.text === '')) {
                out.hosts = [{key: 'easy', text: this.host_from_name(name)}];
            }
            return out;
        },
        // What Save writes for a model, and what the page shows it will: the entry the config
        // file has, changed where the cards changed it (service_from_form), so what no card
        // shows stays in the file. A clone starts from the entry it copies; a new service is
        // its fields alone.
        entry_of: function (model) {
            const written = json_from_service(model);
            const entry = (this.original !== null) ? this.original : ((this.source === undefined) ? null : this.source);
            return (entry === null) ? written : service_from_form(entry, json_from_service(form_from_service(entry)), written);
        },
        // The line a closed card shows: what is there, and what is worth a look
        summary_of: function (id, model) {
            const lines = [];
            let warn = '';
            let fix = null;
            if (id === 'name') {
                lines.push((model.title === '') ? (model.name || 'no name yet') : `${model.title} · ${model.name}`);
                lines.push(KIND_NAMES[model.type].toLowerCase());
            }
            if ((id === 'runs') && (model.type === 'docker')) {
                lines.push((model.image === '') ? 'no image yet' : model.image);
                lines.push((model.port === '') ? 'no port yet' : `port ${model.port} inside`);
                if (model.env.length > 0) {
                    lines.push(plural_words(model.env.length, 'variable', 'variables'));
                }
                if (model.network !== '') {
                    lines.push(`network ${model.network}`);
                }
            }
            if ((id === 'runs') && (model.type === 'shell')) {
                lines.push((model.command === '') ? 'no command yet' : model.command);
                if (model.port !== '') {
                    lines.push(`port ${model.port}`);
                }
                if (model.image !== '') {
                    lines.push(`in ${model.image}`);
                }
                if (model.install !== '') {
                    lines.push('installs itself');
                }
            }
            if ((id === 'runs') && (model.type === 'external')) {
                lines.push((model.socket !== '') ? `listens on ${model.socket}` : ((model.upstream === '') ? 'nowhere yet' : `already answers at ${model.upstream}`));
            }
            if ((id === 'runs') && (model.type === 'files')) {
                lines.push((model.folder === '') ? 'kept by serviceman' : `the files in ${model.folder}`);
            }
            if ((id === 'where') && (model.type === 'external')) {
                lines.push((model.places[0].text === '') ? 'this host, where serviceman runs' : `${this.place_text(model.places[0].text)}, through its link`);
            }
            if ((id === 'where') && (model.type !== 'external')) {
                const names = model.places.map(v => v.text).filter(v => v !== '').map(v => this.place_text(v));
                if (names.length === 0) {
                    warn = 'no machine picked';
                }
                else {
                    lines.push(names.join(', then '));
                }
            }
            if (id === 'address') {
                const hosts = model.hosts.map(v => v.text).filter(v => v !== '');
                if (hosts.length === 0) {
                    lines.push('none — it only runs');
                }
                for (const host of hosts) {
                    lines.push(host);
                }
                if (model.auth !== '') {
                    lines.push(`behind ${model.auth}, at every address`);
                }
                if (hosts.some(v => v.includes('/'))) {
                    if (model.strip_prefix) {
                        lines.push('the path is taken off');
                    }
                    else {
                        warn = 'it sees the path as it is — most apps answer 404 to that';
                        fix = {label: 'Take the path off', section: 'address', field: 'strip_prefix', value: true};
                    }
                }
                if (model.redirect !== '') {
                    lines.push(`hands over to ${model.redirect}`);
                }
            }
            if (id === 'ports') {
                const said = brought_said(model.brought, this.program_of(model));
                if ((model.brought.targets.length === 0) && (model.brought.kept.length === 0)) {
                    lines.push('none — it is reached on its machine alone');
                }
                for (let i = 0, end = model.brought.targets.length; i < end; ++i) {
                    const target = model.brought.targets[i];
                    const there = (target.kind === 'socket') ? said.targets[i].value : `port ${said.targets[i].value}`;
                    lines.push(`${said.port.value} → ${(target.remote === null) ? 'this host' : this.place_text(target.remote)} · ${there}`);
                }
                for (const item of model.brought.kept) {
                    lines.push(`${item.label}, written by hand`);
                }
                if ((model.brought.targets.length > 0) && (model.port !== '') && (model.start !== 'always')) {
                    warn = 'it sleeps when idle, and a connection to its port over there does not wake it';
                    fix = {label: 'Keep it up', section: 'policy', field: 'start', value: 'always'};
                }
            }
            if (id === 'keep') {
                const kept = model.volumes.filter(v => v.target !== '').map(v => v.target);
                // An app folder is its own storage: it stays, its data/ outlives a new version, and
                // what it writes to data/logs/ is sent to Logline where its machine sends any
                const app_folder = (model.type === 'shell') && (model.command === 'bin/run') && model.cwd.startsWith('/');
                if (app_folder) {
                    lines.push(`keeps ${model.cwd}/data/ through a new version`);
                    lines.push(this.app_logs_text(model.places[0].text));
                }
                if (kept.length > 0) {
                    lines.push(`keeps ${kept.join(', ')}`);
                }
                else if (app_folder === false) {
                    lines.push('nothing kept — it all goes with a restart');
                }
                if ((model.type === 'shell') && (model.secrets.length > 0)) {
                    lines.push(plural_words(model.secrets.length, 'secret', 'secrets'));
                }
            }
            if (id === 'policy') {
                if ((model.start === 'always') || ((model.type === 'shell') && (model.port === ''))) {
                    lines.push('starts with serviceman and stays up');
                }
                else if (model.never_stop) {
                    lines.push('starts at the first request, never sleeps');
                }
                else {
                    lines.push(`starts at the first request, sleeps after ${(model.stop_after_idle === '') ? 'the default 10m' : model.stop_after_idle} idle`);
                }
                lines.push({on_failure: 'restarts when it stops badly', always: 'restarts whenever it stops', never: 'never restarted'}[model.restart]);
                if (model.never_request_timeout) {
                    lines.push('requests wait forever');
                }
                else if (model.request_timeout !== '') {
                    lines.push(`requests wait ${model.request_timeout}`);
                }
            }
            if (id === 'scale') {
                const max = parseInt(model.max, 10);
                lines.push((max > 1) ? `${model.min || '0'} to ${max} copies` : 'one copy');
                lines.push((model.concurrency === '') ? 'each takes every request' : `${model.concurrency} requests each`);
                if (model.autoscale && (model.concurrency !== '')) {
                    lines.push('follows the load');
                }
            }
            return {lines, warn, fix};
        },
        // Where an app's data/logs/ goes: Logline, when its machine sends its lines there
        app_logs_text: function (place) {
            const found = this.remotes.find(v => v.name === place);
            if ((found === undefined) || (found.logline.endpoint === null)) {
                return 'data/logs/ stays on the machine: no Logline is set';
            }
            return (found.logline.logs === 'all') ? 'data/logs/ goes to Logline' : `data/logs/ would go to Logline: ${this.place_text(place)} sends nothing there now`;
        },
        place_text: function (value) {
            const found = this.remotes.find(v => v.name === value);
            return (found === undefined) ? value : this.remote_text(found);
        },
        // Which machine, as the rail names it: a remote by its title
        remote_text: function (view) {
            return `${view.title || view.name}${(view.phase === 'online') ? '' : ' (offline)'}`;
        },
        section_open: function (id) {
            this.note = '';
            this.bad = false;
            if (this.creating) {
                this.opened[id] = true;
            }
            else {
                this.tried = false;
                if (this.draft === null) {
                    this.draft = model_copy(this.model);
                    this.secrets_gone = [];
                }
                this.snapshot = {draft: model_copy(this.draft), secrets_gone: this.secrets_gone.slice()};
                this.editing = id;
                this.strip_touched = false;
                this.image_change();
            }
            // Opened to bring its port over, it offers the first machine at once
            if ((id === 'ports') && (this.m.brought.targets.length === 0) && (this.m.brought.kept.length === 0)) {
                this.target_add();
            }
        },
        // A closed optional card goes back to serviceman's defaults, so what it says is true
        section_close: function (id) {
            const blank = form_from_service(null);
            const fields = {
                keep: ['volumes', 'secrets'],
                policy: ['start', 'restart', 'stop_after_idle', 'never_stop', 'start_timeout', 'stop_timeout', 'request_timeout', 'never_request_timeout', 'start_tries'],
                scale: ['min', 'max', 'concurrency', 'warmup_queue', 'warmup_wait', 'scale_down_after', 'autoscale', 'busy_up', 'up_for', 'busy_down', 'down_for', 'cool_down'],
                ports: ['brought'],
            }[id] || [];
            for (const name of fields) {
                this.model[name] = blank[name];
            }
            this.opened[id] = false;
        },
        // Cancel puts the open card back as it was when it was opened; what other cards kept waits
        section_cancel: function () {
            if (this.snapshot !== null) {
                this.draft = this.snapshot.draft;
                this.secrets_gone = this.snapshot.secrets_gone;
            }
            this.snapshot = null;
            this.draft_settle();
            this.editing = '';
            this.tried = false;
            this.note = '';
            this.bad = false;
            // What a save left half-way did change is read again, so the cards say what is so
            if (this.half) {
                this.$emit('saved', this.original.name);
            }
        },
        // The one-press answer a card offers for what it warns about: its card opened with the
        // change made, for Save to confirm
        fix: function (fix) {
            this.section_open(fix.section);
            this.draft[fix.field] = fix.value;
            this.strip_touched = true;
        },
        strip_set: function (on) {
            this.m.strip_prefix = on;
            this.strip_touched = true;
        },
        // A pasted docker run line is not an image name — it is most of the card. What it
        // carries is put where it belongs, and what it filled in is said.
        docker_run_take: function (line) {
            const said = [];
            const model = this.m;
            model.image = line.image;
            if ((line.name !== '') && (model.name === '')) {
                model.name = line.name;
                said.push(`named ${line.name}`);
            }
            if (line.port !== '') {
                model.port = line.port;
                said.push(`port ${line.port}`);
            }
            if (line.network !== '') {
                model.network = line.network;
                said.push(`network ${line.network}`);
            }
            for (const row of line.env) {
                this.row_add(model.env, row);
            }
            for (const row of line.volumes) {
                this.row_add(model.volumes, row);
            }
            if (line.env.length > 0) {
                said.push(plural_words(line.env.length, 'variable', 'variables'));
            }
            if (line.volumes.length > 0) {
                said.push(plural_words(line.volumes.length, 'path', 'paths'));
                if (this.creating) {
                    this.opened.keep = true;
                }
            }
            this.report(`read from the line: ${said.join(', ')}`, false);
        },
        // A line pasted or dropped into the box is read at once, from the input event that put it
        // there, as the box holds it
        image_input: function (event) {
            if ((event.inputType === 'insertFromPaste') || (event.inputType === 'insertFromDrop')) {
                this.m.image = event.target.value.trim();
                this.image_change();
            }
        },
        // The short form's two kinds: what the other one needs is asked of its machine now
        short_kind: function (type) {
            this.m.type = type;
            this.$nextTick(function () {
                const field = ({docker: this.$refs.image, shell: this.$refs.pick, external: this.$refs.short_name})[type];
                if (field !== undefined) {
                    field.focus();
                }
            });
            if (type === 'shell') {
                this.ports_read();
            }
        },
        // A tile of the first step: its kind, and the machine it needs. A database is made on
        // the Databases page.
        what_pick: function (key) {
            const item = WHAT.find(v => v.key === key);
            if (item.type === null) {
                this.$emit('databases');
                return;
            }
            this.what = key;
            this.m.type = item.type;
            if (item.type === 'shell') {
                this.ports_read();
            }
        },
        // Back to any step, and on to the next one when this one has what it needs
        step_go: function (index) {
            if ((index > this.step) && (this.next_ok.ok === false)) {
                return;
            }
            this.step = index;
            this.$nextTick(function () {
                const field = ({source: ({docker: this.$refs.image, app: this.$refs.pick, program: this.$refs.command, files: this.$refs.folder_path, external: this.$refs.upstream})[this.what]})[this.steps[Math.min(this.step, this.steps.length - 1)].key];
                if (field !== undefined) {
                    field.focus();
                }
            });
        },
        step_to: function (key) {
            this.mode = 'steps';
            this.step = this.steps.findIndex(v => v.key === key);
        },
        machine_pick: function (value) {
            this.m.places[0].text = value;
            this.place_change();
        },
        // New remote, and back here once it is made, with every answer and that machine picked
        machine_add: function () {
            const index = this.steps.findIndex(v => v.key === 'machine');
            this.$emit('machine', {model: model_copy(this.model), what: this.what, step: (index === -1) ? this.step : index, mode: this.mode, app_files: this.app_files});
        },
        signed_in_pick: function () {
            if (this.m.auth === '') {
                this.m.auth = this.walls_here[0].name;
            }
        },
        // One of the rest, changed in the whole form, its card open
        rest_change: function (id) {
            this.all_settings();
            this.section_open(id);
        },
        // What the second step said, in a few words: the image, the app, the line, the folder,
        // the socket or the address it answers at
        source_answer: function (now) {
            return ({docker: now.image, app: (this.app_files === null) ? '' : this.app_files.label, program: now.command, files: now.folder, socket: now.socket, external: now.upstream})[this.what] || '';
        },
        source_sub: function (now) {
            if ((this.what === 'docker') || (this.what === 'program')) {
                return (now.port === '') ? '' : `port ${now.port}`;
            }
            if (this.what === 'app') {
                return (this.app_files === null) ? '' : `${this.app_steps}, on port ${this.app_port}`;
            }
            return '';
        },
        place_change: function () {
            if (this.m.type === 'docker') {
                this.image_change();
                return;
            }
            if (this.m.type === 'shell') {
                this.ports_read();
            }
        },
        // The whole form takes over from what the short one would make
        all_settings: function () {
            if (this.m.type === 'shell') {
                Object.assign(this.model, this.model_now());
            }
            this.simple = false;
        },
        app_picked: async function (event) {
            const picked = await app_files_pick(event.target);
            event.target.value = '';
            await this.app_take(picked);
        },
        app_dropped: async function (event) {
            this.drop_over = false;
            await this.app_take(await app_files_pick(event.dataTransfer));
        },
        // A folder or a zip is read here: what is in it, under its one top folder when it has
        // one, and whether that is an app folder. It names the app.
        app_take: async function (picked) {
            if (picked === null) {
                return;
            }
            if (this.m.type !== 'shell') {
                this.short_kind('shell');
            }
            if (picked.several !== undefined) {
                this.app_files = Object.assign(app_entries_read(`${picked.several} things`, [], `${picked.several} things were dropped at once: drop one, the app's folder or its zip.`), {name: ''});
                return;
            }
            const read = (picked.file !== undefined) ? await app_zip_read(picked.file) : app_folder_read(picked.folder);
            this.app_files = Object.assign(read, {name: name_from_folder(read.label.replace(/\.zip$/i, ''))});
        },
        size_text: function (bytes) {
            return format_bytes(bytes);
        },
        // The ports the machine listens on now; a machine that cannot say leaves the list empty
        ports_read: async function () {
            const place = this.m.places[0].text;
            if ((place === '') || place.startsWith('#')) {
                return;
            }
            const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(place)}/firewall/ports`).then(v => v.json()).catch(() => ({}));
            if (place === this.m.places[0].text) {
                this.ports_busy = Array.isArray(answer.items) ? answer.items.map(v => v.port) : [];
            }
        },
        image_change: async function () {
            const model = this.m;
            if (model.type !== 'docker') {
                return;
            }
            const line = docker_run_parse(model.image);
            if (line !== null) {
                this.docker_run_take(line);
            }
            this.detected_port = null;
            if (model.image === '') {
                return;
            }
            const image = model.image;
            // The image is asked about on the first machine it may run on; a tag is asked of
            // any online machine carrying it, and nothing named of any machine that is online
            const first = model.places[0].text;
            const where = (first === '') ? '' : `&remote=${encodeURIComponent(first)}`;
            const answer = await fetch(`/api/v1/image-ports?image=${encodeURIComponent(image)}${where}`).then(v => v.json()).catch(() => ({ports: []}));
            if ((image === this.m.image) && (answer.ports.length > 0)) {
                this.detected_port = answer.ports[0];
                // A new service takes the port the image names, unless one was typed
                if (this.creating && (this.m.port === '')) {
                    this.m.port = String(answer.ports[0]);
                }
            }
        },
        // One copy is the shape almost everything has. Asking for more is deliberate, and
        // saying no again puts the pool away rather than leaving numbers behind in the file.
        pool_set: function (on) {
            if (on === false) {
                for (const name of ['min', 'max', 'warmup_queue', 'warmup_wait', 'scale_down_after']) {
                    this.m[name] = '';
                }
                this.m.autoscale = false;
                return;
            }
            if (parseInt(this.m.max, 10) > 1) {
                return;
            }
            this.m.max = '3';
        },
        idle_set: function (text) {
            this.m.never_stop = false;
            this.m.stop_after_idle = text;
        },
        row_add: function (rows, row) {
            rows.push(Object.assign({key: Math.random()}, row));
        },
        row_drop: function (rows, row) {
            if ((rows === this.m.secrets) && row.kept) {
                this.secrets_gone.push(row);
            }
            rows.splice(rows.indexOf(row), 1);
        },
        // One more machine its port is brought to, as a socket file named after it: the first
        // machine online it is on nowhere yet, not the one it runs on; else this host, where
        // serviceman runs (null); else a machine whose agent is away now
        target_add: function () {
            const machine = machine_of(this.m);
            const taken = this.m.brought.targets.map(v => v.remote);
            const free = this.remotes.filter(v => (v.name !== machine) && (taken.includes(v.name) === false));
            const online = free.find(v => v.phase === 'online');
            let remote = null;
            if (online !== undefined) {
                remote = online.name;
            }
            else if (taken.includes(null) && (free.length > 0)) {
                remote = free[0].name;
            }
            this.row_add(this.m.brought.targets, {remote, kind: 'socket', socket: '', port: '', original: null});
        },
        click_another_machine: function () {
            this.target_add();
        },
        // The program as its card that brings its port over sees it (brought_said)
        program_of: function (model) {
            const tied = (this.tied === undefined) ? [] : this.tied.map(v => v.label);
            const labels = (this.forward_labels === undefined) ? [] : this.forward_labels.filter(v => tied.includes(v) === false);
            return {name: model.name, machine: machine_of(model), port: model.port, remotes: this.remotes, tried: this.tried, labels};
        },
        // The forwards that are part of the service, as this save writes them, or null when it
        // leaves them as they are
        forwards_written: function (model) {
            if ((model.type !== 'shell') || (this.brought_open !== true)) {
                return null;
            }
            return forwards_from_brought(model.brought, this.program_of(model));
        },
        // What is wrong in one row of secrets, by the box it is wrong in. A name the door would
        // refuse is said at once; a row half filled in waits for Save, which then sends nothing:
        // a value with no name would be dropped unsaid, and a name with no value keeps nothing.
        secret_said: function (row) {
            const filled = (row.value !== '') || (row.copy_from !== '');
            const out = {name: secret_name_said(row.name), value: ''};
            if (this.tried && (row.name === '') && filled) {
                out.name = 'A secret needs a name: one has a value and no name.';
            }
            if (this.tried && (row.name !== '') && (filled === false) && (row.kept === false)) {
                out.value = 'A new secret needs a value: type one, or take the row away.';
            }
            return out;
        },
        // The problems in the open card, or in any card while making one
        problems_here: function () {
            if (this.creating) {
                return Object.keys(this.problems);
            }
            const open = this.kind_changing ? SECTIONS.filter(v => v.must && v.kinds.includes(this.m.type)).map(v => v.id) : [this.editing];
            const fields = [].concat(...open.map(v => SECTION_PROBLEMS[v] || []));
            return Object.keys(this.problems).filter(v => fields.includes(v));
        },
        create: async function () {
            this.tried = true;
            if (this.problem_count > 0) {
                // Something is shown where it can be fixed: the step that asks it, or the whole
                // form for what no step shows
                if (this.simple) {
                    const keys = Object.keys(this.problems);
                    const found = this.steps.findIndex(v => (STEP_PROBLEMS[v.key] || []).some(vv => keys.includes(vv)));
                    if (found === -1) {
                        this.all_settings();
                    }
                    else {
                        this.mode = 'steps';
                        this.step = found;
                    }
                }
                return;
            }
            const model = this.model_now();
            if ((model.type === 'shell') && (this.app_files !== null)) {
                try {
                    model.cwd = await this.files_send(model.cwd);
                }
                catch (error) {
                    this.busy = false;
                    this.report(error.message, true);
                    return;
                }
            }
            const ok = await this.write('POST', '/api/v1/services', model, this.forwards_written(model));
            if (ok) {
                this.$emit('saved', model.name);
                this.$emit('close');
            }
        },
        // The app's files, into a new folder on its machine through the File Manager's API, as
        // one tar with their modes; what comes back is the folder as the machine names it
        files_send: function (folder) {
            const place = this.m.places[0].text;
            this.busy = true;
            this.files_copy = {title: `${this.app_files.label} to ${place}`, state: 'waiting', files: this.app_files.files, files_done: 0, failed: 0, bytes: null, bytes_done: 0, samples: [], left_ms: null, now: null, note: 'reading the files…', note_bad: false};
            return app_files_send(this.app_files, place, folder, v => this.report(v, false), this.files_copy);
        },
        // The open card's Save: written at once, one press for one change; the card stays open,
        // saying why, when something in it is to be put right or the write is refused
        section_save_one: async function () {
            this.tried = true;
            if (this.problems_here().length > 0) {
                return;
            }
            await this.section_save();
        },
        // Nothing waiting for Save is no draft at all: the cards show what is saved
        draft_settle: function () {
            if ((this.draft !== null) && (this.editing === '') && (this.changed_ids.length === 0)) {
                this.draft = null;
            }
        },
        // The service written as the cards say it; a card with something wrong opens to be put right
        section_save: async function () {
            this.tried = true;
            const wrong = this.sections.find(v => v.wrong);
            if (wrong !== undefined) {
                this.section_open(wrong.id);
                return;
            }
            const model = this.model_now();
            const ok = await this.write('PUT', `/api/v1/services/${encodeURIComponent(this.original.name)}`, model, this.forwards_written(model));
            if (ok) {
                this.model = model;
                this.draft = null;
                this.snapshot = null;
                this.editing = '';
                this.tried = false;
                this.$emit('saved', model.name);
            }
        },
        // Sends the service and its secrets, and the forwards that are part of it when the save
        // writes them (null leaves them as they are). A save whose answer never came back is
        // looked for in what serviceman knows, since it may have landed anyway.
        write: async function (method, url, model, forwards) {
            this.busy = true;
            this.report('', false);
            try {
                const body = (forwards === null) ? {service: this.entry_of(model)} : {service: this.entry_of(model), forwards};
                const answer = await fetch(url, {method, body: JSON.stringify(body)});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    if (method === 'POST') {
                        this.refused = outcome.error;
                    }
                    return false;
                }
                this.refused = '';
                // The secrets are not part of the config, so they are written after it — and
                // under the name the service has now, which may be the name it just got. One the
                // door does not take is said in the door's words and nothing closes: its row
                // stays as it was typed, while the service itself is saved.
                const refused = await secret_rows_write(model.name, model.secrets, this.secrets_gone);
                if (refused !== null) {
                    this.half = true;
                    this.report(`${refused} — ${(method === 'POST') ? `${model.name} itself is made` : 'the rest is saved'}`, true);
                    return false;
                }
                return true;
            }
            catch {
                this.report('the answer never came back — checking whether it landed…', false);
                const landed = await settled(async () => (await state_read()).services.some(v => v.name === model.name));
                if (landed === false) {
                    this.report('serviceman is not answering', true);
                }
                return landed;
            }
            finally {
                this.busy = false;
            }
        },
        remove: async function () {
            this.busy = true;
            try {
                const answer = await fetch(`/api/v1/services/${encodeURIComponent(this.original.name)}`, {method: 'DELETE'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.$emit('saved', null);
            }
            catch {
                this.report('the answer never came back — checking whether it landed…', false);
                const name = this.original.name;
                const gone = await settled(async () => (await state_read()).services.some(v => v.name === name) === false);
                if (gone === false) {
                    this.report('serviceman is not answering', true);
                    return;
                }
                this.$emit('saved', null);
            }
            finally {
                this.busy = false;
            }
        },
        // The file opens at the foot of a long page, so it is brought into view with it
        json_toggle: function () {
            this.json_open = (this.json_open === false);
            if (this.json_open === false) {
                return;
            }
            const self = this;
            this.$nextTick(function () {
                self.$refs.json.scrollIntoView({block: 'nearest', behavior: 'smooth'});
            });
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
    created: async function () {
        // A new container or program runs on the machine it was added from, or the first there
        // is, until somebody says otherwise; a form with no machine to offer leaves the place
        // empty and says so. A service being edited keeps what it has — an empty place is "this
        // host" for something already running — and so does anything made as already running.
        if (this.creating && (this.model.places[0].text === '') && (this.places.length > 0) && (this.model.type !== 'external')) {
            this.model.places[0].text = this.place_default;
            this.place_given = this.place_default;
        }
        try {
            const answer = await fetch('/api/v1/secrets', {cache: 'no-store'});
            const body = await answer.json();
            this.library = body.global.map(v => v.name);
            const name = (this.original === null) ? '' : this.original.name;
            for (const item of body.services.filter(v => v.service === name)) {
                this.model.secrets.push({key: Math.random(), name: item.name, value: '', copy_from: '', kept: true, length: item.length});
            }
            if ((this.original === null) && (this.source !== undefined) && (this.source !== null)) {
                this.source_secret_count = body.services.filter(v => v.service === this.source.name).length;
            }
        }
        catch {
            this.library = [];
        }
    },
};

// A size in the unit it reads best in, for a machine's free memory: 3 GB, 512 MB
// A model as a copy of its own, rows and all, for a card to change without touching the page
function model_copy(model)
{
    return JSON.parse(JSON.stringify(model));
}

// "registry.example.com:5000/team/grafana:latest" -> "grafana"
// The name an app folder gives itself: /home/user/appdir/ is appdir
function name_from_folder(folder)
{
    const tail = folder.replace(/\/+$/, '').split('/').pop();
    return tail.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '');
}

function name_from_image(image)
{
    const tail = image.split('/').pop();
    const bare = tail.split(':')[0];
    return bare.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '');
}

// The first name not taken yet: grafana, grafana-2, grafana-3, ...
function name_free(name, names)
{
    if ((name === '') || (names.includes(name) === false)) {
        return name;
    }
    for (let i = 2; ; i++) {
        if (names.includes(`${name}-${i}`) === false) {
            return `${name}-${i}`;
        }
    }
}

// The raw config service -> what the fields show; null -> a blank docker form
// `remote` is one machine, `remotes` a list of them; both mean the same thing here
function remotes_of(service)
{
    if (Array.isArray(service.remotes)) {
        return service.remotes;
    }
    return (service.remote === undefined) ? [] : [service.remote];
}

// The one machine a program of the form runs on, or null for none, a list or a tag: its port
// is brought over from there
function machine_of(model)
{
    const places = model.places.map(v => v.text).filter(v => v !== '');
    return ((places.length === 1) && (places[0].startsWith('#') === false)) ? places[0] : null;
}

function form_from_service(service)
{
    const out = {
        name: '',
        title: '',
        type: 'docker',
        places: [],
        hosts: [],
        strip_prefix: false,
        redirect: '',
        // The wall it stands behind at every address, or '' for none
        auth: '',
        image: '',
        port: '',
        network: '',
        init: true,
        cwd: '',
        env: [],
        volumes: [],
        upstream: '',
        socket: '',
        folder: '',
        command: '',
        user: '',
        secrets: [],
        start_tries: '',
        install: '',
        update: '',
        stop: '',
        uninstall: '',
        start: 'on_demand',
        restart: 'on_failure',
        stop_after_idle: '',
        never_stop: false,
        start_timeout: '',
        stop_timeout: '',
        request_timeout: '',
        never_request_timeout: false,
        min: '',
        max: '',
        concurrency: '',
        warmup_queue: '',
        warmup_wait: '',
        scale_down_after: '',
        prepull: true,
        autoscale: false,
        busy_up: '',
        up_for: '',
        busy_down: '',
        down_for: '',
        cool_down: '',
        // The forwards that are part of it, as its card holds them (brought_from_forwards)
        brought: {port: '', targets: [], kept: []},
    };
    if (service === null) {
        out.hosts.push({key: Math.random(), text: ''});
        out.places.push({key: Math.random(), text: ''});
        return out;
    }
    const publish = service.publish || {};
    out.name = service.name || '';
    out.title = service.title || '';
    out.type = service.type || 'docker';
    for (const name of remotes_of(service)) {
        out.places.push({key: Math.random(), text: name});
    }
    if (out.places.length === 0) {
        out.places.push({key: Math.random(), text: ''});
    }
    for (const text of (publish.hosts || ((publish.host === undefined) ? [] : [publish.host]))) {
        out.hosts.push({key: Math.random(), text});
    }
    if (out.hosts.length === 0) {
        out.hosts.push({key: Math.random(), text: ''});
    }
    out.strip_prefix = publish.strip_prefix === true;
    out.redirect = service.redirect || '';
    out.auth = ((service.auth === undefined) || (service.auth === null)) ? '' : service.auth;
    out.image = service.image || '';
    out.port = (publish.port === undefined) ? '' : String(publish.port);
    out.network = service.network || '';
    out.init = service.init !== false;
    for (const name of Object.keys(service.env || {})) {
        out.env.push({key: Math.random(), name, value: String(service.env[name])});
    }
    for (const volume of (service.volumes || [])) {
        out.volumes.push(Object.assign({key: Math.random()}, volume_row(volume)));
    }
    out.upstream = service.upstream || '';
    out.socket = service.socket || '';
    out.folder = service.folder || '';
    out.command = service.command || '';
    out.cwd = service.cwd || '';
    out.user = service.user || '';
    const life = service.lifecycle || {};
    out.install = life.install || '';
    out.update = life.update || '';
    out.stop = life.stop || '';
    out.uninstall = life.uninstall || '';
    const policy = service.policy || {};
    out.start = policy.start || 'on_demand';
    out.restart = policy.restart || 'on_failure';
    out.never_stop = policy.stop_after_idle === false;
    out.stop_after_idle = (out.never_stop || (policy.stop_after_idle === undefined)) ? '' : String(policy.stop_after_idle);
    out.start_timeout = (policy.start_timeout === undefined) ? '' : String(policy.start_timeout);
    out.stop_timeout = (policy.stop_timeout === undefined) ? '' : String(policy.stop_timeout);
    out.start_tries = (policy.start_tries === undefined) ? '' : String(policy.start_tries);
    out.never_request_timeout = policy.request_timeout === false;
    out.request_timeout = (out.never_request_timeout || (policy.request_timeout === undefined)) ? '' : String(policy.request_timeout);
    const instances = policy.instances || {};
    out.min = (instances.min === undefined) ? '' : String(instances.min);
    out.max = (instances.max === undefined) ? '' : String(instances.max);
    out.concurrency = ((policy.concurrency === undefined) || (policy.concurrency === false)) ? '' : String(policy.concurrency);
    const warmup = policy.warmup || {};
    out.warmup_queue = (warmup.queue === undefined) ? '' : String(warmup.queue);
    out.warmup_wait = (warmup.wait === undefined) ? '' : String(warmup.wait);
    out.scale_down_after = (policy.scale_down_after === undefined) ? '' : String(policy.scale_down_after);
    out.prepull = policy.prepull !== false;
    const autoscale = policy.autoscale;
    out.autoscale = (autoscale !== undefined) && (autoscale !== null) && (autoscale !== false);
    if (out.autoscale) {
        out.busy_up = (autoscale.busy_up === undefined) ? '' : String(autoscale.busy_up);
        out.busy_down = (autoscale.busy_down === undefined) ? '' : String(autoscale.busy_down);
        out.up_for = (autoscale.up_for === undefined) ? '' : String(autoscale.up_for);
        out.down_for = (autoscale.down_for === undefined) ? '' : String(autoscale.down_for);
        out.cool_down = (autoscale.cool_down === undefined) ? '' : String(autoscale.cool_down);
    }
    return out;
}

// "src:tgt", "src:tgt:ro" or the object form -> one storage line of the form
function volume_row(volume)
{
    if (typeof volume !== 'string') {
        return {source: volume.source || '', target: volume.target || '', readonly: volume.readonly === true};
    }
    const parts = volume.split(':');
    const readonly = (parts[parts.length - 1] === 'ro');
    if (readonly) {
        parts.pop();
    }
    const target = (parts.length > 1) ? parts.pop() : '';
    return {source: parts.join(':'), target, readonly};
}

// Where the service answers, in the one place the config keeps it
function publish_from_model(model)
{
    const out = {};
    const hosts = model.hosts.map(v => v.text).filter(v => v !== '');
    if (hosts.length === 1) {
        out.host = hosts[0];
    }
    if (hosts.length > 1) {
        out.hosts = hosts;
    }
    if (model.type === 'docker') {
        out.port = number_or_text(model.port);
    }
    if ((model.type === 'shell') && (model.port !== '')) {
        out.port = number_or_text(model.port);
    }
    // The path comes off only where there is one; with no path the word would be noise
    if (model.strip_prefix && hosts.some(v => v.includes('/'))) {
        out.strip_prefix = true;
    }
    return out;
}

// The fields -> the config file shape; only what the user filled lands in the file
function json_from_service(model)
{
    const out = {name: model.name};
    if (model.title !== '') {
        out.title = model.title;
    }
    out.type = model.type;
    const places = model.places.map(v => v.text).filter(v => v !== '');
    if (((model.type === 'docker') || (model.type === 'shell')) && (places.length > 0)) {
        // One machine reads better as "remote"; a list of them is a list
        out[(places.length === 1) ? 'remote' : 'remotes'] = (places.length === 1) ? places[0] : places;
    }
    out.publish = publish_from_model(model);
    if ((model.redirect !== '') && ((model.type === 'docker') || (model.type === 'shell'))) {
        out.redirect = model.redirect;
    }
    if (model.auth !== '') {
        out.auth = model.auth;
    }
    if (model.type === 'docker') {
        out.image = model.image;
        const env = {};
        for (const row of model.env) {
            if (row.name !== '') {
                env[row.name] = row.value;
            }
        }
        if (Object.keys(env).length > 0) {
            out.env = env;
        }
        const volumes = model.volumes.filter(v => (v.source !== '') || (v.target !== '')).map(volume_text);
        if (volumes.length > 0) {
            out.volumes = volumes;
        }
        if (model.network !== '') {
            out.network = model.network;
        }
        if (model.init === false) {
            out.init = false;
        }
    }
    if (model.type === 'shell') {
        out.command = model.command;
        const volumes = model.volumes.filter(v => (v.source !== '') || (v.target !== '')).map(volume_text);
        if (volumes.length > 0) {
            out.volumes = volumes;
        }
        if (model.image !== '') {
            out.image = model.image;
        }
        if ((model.image !== '') && (model.user !== '')) {
            out.user = model.user;
        }
        const lifecycle = {};
        for (const step of ['install', 'update', 'stop', 'uninstall']) {
            if (model[step] !== '') {
                lifecycle[step] = model[step];
            }
        }
        if (Object.keys(lifecycle).length > 0) {
            out.lifecycle = lifecycle;
        }
        if (model.cwd !== '') {
            out.cwd = model.cwd;
        }
        const env = {};
        for (const row of model.env) {
            if (row.name !== '') {
                env[row.name] = row.value;
            }
        }
        if (Object.keys(env).length > 0) {
            out.env = env;
        }
    }
    if (model.type === 'external') {
        if (places.length > 0) {
            out.remote = places[0];
        }
        if (model.socket !== '') {
            out.socket = model.socket;
            return out;
        }
        out.upstream = model.upstream;
        return out;
    }
    if (model.type === 'files') {
        if (model.folder !== '') {
            out.folder = model.folder;
        }
        return out;
    }
    const policy = {};
    if ((model.start === 'always') || ((model.type === 'shell') && (model.port === ''))) {
        policy.start = 'always';
    }
    if (model.restart !== 'on_failure') {
        policy.restart = model.restart;
    }
    if (model.start !== 'always') {
        if (model.never_stop) {
            policy.stop_after_idle = false;
        }
        else if (model.stop_after_idle !== '') {
            policy.stop_after_idle = model.stop_after_idle;
        }
    }
    if (model.stop_timeout !== '') {
        policy.stop_timeout = model.stop_timeout;
    }
    if (model.start_timeout !== '') {
        policy.start_timeout = model.start_timeout;
    }
    if (model.start_tries !== '') {
        policy.start_tries = number_or_text(model.start_tries);
    }
    if (model.never_request_timeout) {
        policy.request_timeout = false;
    }
    else if (model.request_timeout !== '') {
        policy.request_timeout = model.request_timeout;
    }
    if (model.type === 'docker') {
        const instances = {};
        if (model.min !== '') {
            instances.min = number_or_text(model.min);
        }
        if (model.max !== '') {
            instances.max = number_or_text(model.max);
        }
        if (Object.keys(instances).length > 0) {
            policy.instances = instances;
        }
        if (model.concurrency !== '') {
            policy.concurrency = number_or_text(model.concurrency);
        }
        const warmup = {};
        if (model.warmup_queue !== '') {
            warmup.queue = number_or_text(model.warmup_queue);
        }
        if (model.warmup_wait !== '') {
            warmup.wait = model.warmup_wait;
        }
        if (Object.keys(warmup).length > 0) {
            policy.warmup = warmup;
        }
        if (model.scale_down_after !== '') {
            policy.scale_down_after = model.scale_down_after;
        }
        if (model.prepull === false) {
            policy.prepull = false;
        }
        if (model.autoscale && (model.concurrency !== '')) {
            // Only what was filled in; the rest is serviceman's default, and stays that way
            const autoscale = {};
            for (const name of ['busy_up', 'busy_down']) {
                if (model[name] !== '') {
                    // A share is 0.7, not 7 — a whole-number reader would keep it as text
                    const share = Number(model[name]);
                    autoscale[name] = Number.isFinite(share) ? share : model[name];
                }
            }
            for (const name of ['up_for', 'down_for', 'cool_down']) {
                if (model[name] !== '') {
                    autoscale[name] = model[name];
                }
            }
            policy.autoscale = autoscale;
        }
    }
    if (Object.keys(policy).length > 0) {
        out.policy = policy;
    }
    return out;
}

// One storage line of the form -> the "src:tgt" or "src:tgt:ro" text of the config
function volume_text(row)
{
    return `${row.source}:${row.target}${row.readonly ? ':ro' : ''}`;
}

// A number lands as a number; anything else stays as typed for the validator to name
// "1 path", "2 paths" — the form says how much of itself was filled in for you
function plural_words(count, one, many)
{
    return `${count} ${(count === 1) ? one : many}`;
}

function number_or_text(text)
{
    return /^\d+$/.test(text) ? parseInt(text, 10) : text;
}

export default service_form;
