import app_files_pick from './app_files_pick.js';
import app_files_send from './app_files_send.js';
import app_folder_read from './app_folder_read.js';
import app_zip_read from './app_zip_read.js';
import docker_run_parse from './docker_run_parse.js';
import format_bytes from './format_bytes.js';
import settled from './settled.js';
import snippet from './snippet.js';
import state_read from './state_read.js';

// What a service can be, in the order the question is worth asking
const KINDS = ['docker', 'shell', 'external'];

const KIND_WORDS = {
    docker: 'an agent runs it and stops it on the machine you name',
    shell: 'a command line kept alive on a machine of yours',
    external: 'serviceman only gives it an address, and never starts it',
};

const KIND_NAMES = {
    docker: 'A docker image',
    shell: 'A program',
    external: 'Something already running',
};

// What the short form makes: an image, or an app folder, a program of one shape. bin/run serves
// it on PORT; bin/configure, when it has one, sets it up once before the first run.
const SHORT_KINDS = ['docker', 'shell'];

const SHORT_NAMES = {
    docker: 'A docker image',
    shell: 'An app folder',
};

const SHORT_WORDS = {
    docker: 'an agent runs it and stops it on the machine you name',
    shell: 'its folder or a .zip of it, with bin/run, from this computer',
};

// The ports an app folder is given, the first one free from here: well away from serviceman's
// own and from what most dev servers take
const APP_PORT_FIRST = 8080;

// The answers to "sleep after" that are worth one click
const IDLE_STEPS = ['2m', '10m', '1h'];

// A service is read top to bottom in these cards, on its page and while it is made. `must` is
// what a new one cannot do without; the rest open closed, on serviceman's defaults.
const SECTIONS = [
    {id: 'name', title: 'Name', kinds: ['docker', 'shell', 'external'], must: true},
    {id: 'runs', title: 'What runs', kinds: ['docker', 'shell', 'external'], must: true},
    {id: 'where', title: 'Where it runs', kinds: ['docker', 'shell', 'external'], must: true},
    {id: 'address', title: 'Addresses', kinds: ['docker', 'shell', 'external'], must: true},
    {id: 'keep', title: 'Storage and secrets', kinds: ['docker', 'shell'], must: false},
    {id: 'policy', title: 'When it runs', kinds: ['docker', 'shell'], must: false},
    {id: 'scale', title: 'Copies', kinds: ['docker'], must: false},
];

// Which card each thing that can be wrong is in
const SECTION_PROBLEMS = {
    name: ['name'],
    runs: ['port', 'command', 'upstream'],
    where: ['places'],
    address: ['hosts'],
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
    <!-- A new service asks for what almost every one needs, and nothing else; All settings is the whole form -->
    <template v-if="(creating && simple)">
        <div class="list-head">
            <h1>{{ heading }}</h1>
        </div>
        <div class="kinds short">
            <button v-for="type of SHORT_KINDS" :key="type" type="button" class="kind" :class="{on: (type === m.type)}" @click="short_kind(type)">
                <span class="name">{{ SHORT_NAMES[type] }}</span>
                <span class="muted">{{ SHORT_WORDS[type] }}</span>
            </button>
        </div>
        <div class="card svc-sec open" :class="{dropping: drop_over}" @dragover.prevent="drop_over = true" @dragleave="drop_over = false" @drop.prevent="app_dropped">
            <div class="grid svc-body">
                <template v-if="(m.type === 'docker')">
                    <label>Image</label>
                    <div>
                        <input ref="image" v-model.trim="m.image" placeholder="grafana/grafana:latest — or paste a whole docker run line" spellcheck="false" @paste="image_paste" @change="image_change">
                    </div>
                </template>
                <template v-else>
                    <label>App</label>
                    <div>
                        <div class="line">
                            <button ref="pick" type="button" :class="{wrong: problems.cwd}" @click="$refs.folder.click()">A folder…</button>
                            <button type="button" :class="{wrong: problems.cwd}" @click="$refs.zip.click()">A .zip…</button>
                            <input ref="folder" type="file" webkitdirectory hidden @change="app_picked">
                            <input ref="zip" type="file" accept=".zip,application/zip" hidden @change="app_picked">
                        </div>
                        <p v-if="(app_files !== null)">
                            <code>{{ app_files.label }}</code> <span v-if="(app_files.files > 0)" class="muted">— {{ app_files.files === 1 ? 'one file' : app_files.files + ' files' }}, {{ size_text(app_files.size) }}</span> <button type="button" class="link" @click="app_files = null">not this one</button>
                        </p>
                        <p v-if="problems.cwd" class="bad">{{ problems.cwd }}</p>
                        <p v-else-if="(app_files !== null)" class="muted">Copied to <code>{{ app_dir }}</code> on {{ place_text(m.places[0].text) }}; {{ app_files.configure ? 'bin/configure runs once, then bin/run' : 'bin/run, with nothing to configure first' }}, on port {{ app_port }} as <code>PORT</code>.</p>
                        <p v-else class="muted">Its folder on this computer, with <code>bin/run</code> in it, or a .zip of that folder: picked, or dropped here. serviceman copies it to the machine it runs on, into a folder of its own.</p>
                    </div>
                </template>
                <label>Name</label>
                <div>
                    <input v-model.trim="m.name" :placeholder="(easy_name === '' ? (m.type === 'docker' ? 'grafana' : 'appdir') : easy_name)" :class="{wrong: problems.name}" spellcheck="false">
                    <p v-if="problems.name" class="bad">{{ problems.name }}</p>
                    <p v-else-if="(m.name === '' && easy_name !== '')" class="muted">Left empty, it is named <code>{{ easy_name }}</code> after its {{ m.type === 'docker' ? 'image' : ((app_files !== null && app_files.label.endsWith('/')) ? 'folder' : 'zip') }}.</p>
                </div>
                <template v-if="(m.type === 'docker')">
                    <label>Port inside</label>
                    <div>
                        <div class="line">
                            <input v-model.trim="m.port" :placeholder="(detected_port === null ? '80' : String(detected_port))" class="short" :class="{wrong: problems.port}" spellcheck="false">
                            <button v-if="(detected_port !== null && m.port !== String(detected_port))" type="button" class="tab" @click="m.port = String(detected_port)">use {{ detected_port }}, from the image</button>
                        </div>
                        <p v-if="problems.port" class="bad">{{ problems.port }}</p>
                        <p v-else-if="(m.port === '')" class="muted">Left empty, it is {{ detected_port === null ? '80' : detected_port + ', the one the image names' }}.</p>
                    </div>
                </template>
                <label>Runs on</label>
                <div>
                    <select v-if="(places.length > 0)" v-model="m.places[0].text" :class="{wrong: problems.places}" @change="place_change">
                        <option v-for="item of places" :key="item.value" :value="item.value">{{ item.label }}</option>
                    </select>
                    <p v-else class="bad">No machine yet. It runs where an agent is — add a remote first.</p>
                    <p v-if="(places.length > 0 && problems.places)" class="bad">{{ problems.places }}</p>
                </div>
                <label>Address</label>
                <div>
                    <p v-if="(easy_host === '')" class="muted">Taken from its name, once it has one that fits.</p>
                    <p v-else><code>{{ easy_host }}</code> <span class="muted">— from its name</span></p>
                </div>
            </div>
        </div>
    </template>
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
    <div v-for="section of (simple ? [] : sections)" :key="section.id" class="card svc-sec" :class="{open: section.open, wrong: section.wrong}" :id="('svc-' + section.id)">
        <div class="svc-head">
            <b>{{ section.title }}</b>
            <span v-if="(section.open === false)" class="svc-sum">
                <span v-for="line of section.summary.lines" :key="line">{{ line }}</span>
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
                    <input v-model.trim="m.image" placeholder="grafana/grafana:latest — or paste a whole docker run line" spellcheck="false" @paste="image_paste" @change="image_change">
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
                    <div v-for="row of m.env" :key="row.key" class="line">
                        <input v-model.trim="row.name" placeholder="NAME" class="short" spellcheck="false">
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
                    <input v-model.trim="m.image" placeholder="node:24-alpine — optional" spellcheck="false">
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
                    <div v-for="row of m.env" :key="row.key" class="line">
                        <input v-model.trim="row.name" placeholder="NAME" class="short" spellcheck="false">
                        <input v-model.trim="row.value" placeholder="value" spellcheck="false">
                        <button type="button" title="Take this variable away" aria-label="Take this variable away" @click="row_drop(m.env, row)">×</button>
                    </div>
                    <button type="button" @click="row_add(m.env, {name: '', value: ''})">+ variable</button>
                </div>
            </template>
            <template v-if="(section.id === 'runs' && m.type === 'external')">
                <label>Answers at</label>
                <div>
                    <input v-model.trim="m.upstream" placeholder="127.0.0.1:7000" :class="{wrong: problems.upstream}" spellcheck="false">
                    <p v-if="problems.upstream" class="bad">{{ problems.upstream }}</p>
                    <p v-else-if="(m.places[0].text !== '')" class="muted">An address <b>on {{ m.places[0].text }}</b>, as <code>host:port</code> — <code>127.0.0.1</code> is that machine's own loopback. serviceman passes requests on and never starts or stops it.</p>
                    <p v-else class="muted">Where it already answers, as <code>host:port</code>. serviceman passes requests on and never starts or stops it.</p>
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
                <template v-if="(m.type !== 'external')">
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
                        <div v-for="row of m.secrets" :key="row.key" class="line">
                            <input v-model.trim="row.name" placeholder="credentials" class="short" spellcheck="false">
                            <input v-model="row.value" :placeholder="(row.kept ? row.length + ' characters kept — type to replace' : 'the value the program reads')" spellcheck="false">
                            <select v-if="(library.length > 0)" v-model="row.copy_from">
                                <option value="">or copy from…</option>
                                <option v-for="item of library_options" :key="item.value" :value="item.value">{{ item.label }}</option>
                            </select>
                            <button type="button" title="Take this secret away" aria-label="Take this secret away" @click="row_drop(m.secrets, row)">×</button>
                        </div>
                        <button type="button" @click="row_add(m.secrets, {name: '', value: '', copy_from: '', kept: false, length: 0})">+ secret</button>
                        <p class="muted">The program reads one with <code>secrets &lt;name&gt;</code>. They are this service's own and never in the config.</p>
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
            <button type="button" class="primary" :disabled="busy" @click="section_save">{{ busy ? 'saving…' : 'Save' }}</button>
            <button type="button" :disabled="busy" @click="section_cancel">Cancel</button>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </div>
    </div>
    <div v-if="(creating === false)" class="card svc-sec">
        <div class="svc-head">
            <b>Remove</b>
            <span v-if="(removing === false)" class="svc-sum"><span>Takes {{ model.name }} out of the config. Anything running keeps running.</span></span>
            <span v-else class="svc-sum"><span class="svc-warn">Forget {{ model.name }}? Anything running keeps running; nothing will start it again.</span></span>
            <span class="list-right">
                <button v-if="(removing === false)" type="button" class="danger" :disabled="(editing !== '')" @click="removing = true">Remove…</button>
                <template v-else>
                    <button type="button" class="danger" :disabled="busy" @click="remove">Forget it</button>
                    <button type="button" @click="removing = false">Keep it</button>
                </template>
            </span>
        </div>
    </div>
    <div v-if="creating" class="svc-create">
        <button type="button" class="primary" :disabled="busy" @click="create">{{ busy ? 'creating…' : 'Create service' }}</button>
        <button type="button" @click="$emit('close')">Cancel</button>
        <button v-if="simple" type="button" class="link" @click="all_settings">All settings…</button>
        <span v-if="(problem_count > 0)" class="bad">{{ problem_count === 1 ? 'One thing to fix' : problem_count + ' things to fix' }}</span>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
    <div ref="json" class="svc-json">
        <button type="button" class="link" @click="json_toggle">{{ json_open ? 'Hide' : 'Show' }} what {{ creating ? 'Create' : 'Save' }} writes to serviceman.json</button>
        <pre v-if="json_open" class="tail">{{ config_text }}</pre>
    </div>
</article>
`,
    components: {duration, snip: snippet},
    props: ['remotes', 'names', 'original', 'source', 'remote', 'control', 'port', 'redir', 'ports_taken'],
    emits: ['close', 'saved'],
    data: function () {
        const source = (this.source === undefined) ? null : this.source;
        const model = form_from_service((this.original === null) ? source : this.original);
        // A clone is a new service with the settings carried over; the name and the address must be its own
        if ((this.original === null) && (source !== null)) {
            model.name = name_free(source.name, this.names || []);
            model.hosts = [{key: Math.random(), text: ''}];
        }
        return {
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
            detected_port: null,
            // The app, a folder or a zip of this computer, read here and sent to its machine
            // as its files on Create (app_entries_read), and the name it gives the app
            app_files: null,
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
        library_options: function () {
            return this.library.map(v => ({value: v, label: v}));
        },
        // The model the fields are bound to: the draft of the open card, or the new service
        m: function () {
            return (this.draft === null) ? this.model : this.draft;
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
                out.push({id: item.id, title: item.title, must: item.must, open, wrong, last: false, summary: this.summary_of(item.id, this.model)});
            }
            // Save and Cancel go under the last card open: a new kind opens several at once
            const opened = out.filter(v => v.open);
            if (opened.length > 0) {
                opened[opened.length - 1].last = true;
            }
            return out;
        },
        // The kind is being changed in the Name card: what the new kind needs is asked in the
        // same save, since a kind with nothing said about what runs is not a service at all
        kind_changing: function () {
            return (this.creating === false) && (this.editing === 'name') && (this.m.type !== this.model.type);
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
            if ((this.creating === false) || (this.made_short === false) || (/^[a-z0-9][a-z0-9_-]*$/.test(name) === false)) {
                return '';
            }
            return this.host_from_name(name);
        },
        easy_name: function () {
            if ((this.m.type === 'shell') && this.made_short && (this.app_files !== null)) {
                return name_free(this.app_files.name, this.names || []);
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
        // Whether what is made fills itself in from the short form: an image always does, an
        // app folder while it is made there
        made_short: function () {
            return (this.m.type === 'docker') || ((this.m.type === 'shell') && this.simple);
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
        config_text: function () {
            return JSON.stringify(json_from_service(this.model_now()), null, 4);
        },
        prefix_on: function () {
            return this.m.hosts.some(v => v.text.includes('/'));
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
            if ((model.type === 'shell') && this.simple && this.creating) {
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
            if (this.tried && (model.type === 'external') && (model.upstream === '')) {
                out.upstream = 'Where it already answers is needed, as host:port.';
            }
            // An app not picked yet is said once, where it is picked: the name comes from it
            const unpicked = (model.type === 'shell') && this.simple && this.creating && (this.app_files === null);
            if (this.tried && (this.model_now().name === '') && (unpicked === false)) {
                out.name = 'A service needs a name.';
            }
            else if ((model.name !== '') && (/^[a-z0-9][a-z0-9_-]*$/.test(model.name) === false)) {
                out.name = 'Lowercase letters, digits, - and _ only, starting with a letter or a digit.';
            }
            return out;
        },
        problem_count: function () {
            return Object.keys(this.problems).length;
        },
    },
    watch: {
        // While a new one is made, the machine given by default follows the kind: something
        // already running starts on this host, a container or a program on the default machine
        'model.type': function (type) {
            if (this.creating === false) {
                return;
            }
            const place = this.model.places[0];
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
            if ((this.creating === false) || (this.made_short === false)) {
                return model;
            }
            const name = (model.name === '') ? this.easy_name : model.name;
            const out = Object.assign({}, model, {name});
            if (model.type === 'docker') {
                out.port = (model.port === '') ? String((this.detected_port === null) ? 80 : this.detected_port) : model.port;
            }
            else {
                // An app folder is one shape of program: bin/run on its port, bin/configure
                // first when the folder has one, in the folder serviceman gives it
                const files = this.app_files;
                Object.assign(out, {command: 'bin/run', install: ((files !== null) && files.configure) ? 'bin/configure' : '', port: String(this.app_port), image: '', cwd: this.app_dir});
            }
            if ((name !== '') && model.hosts.every(v => v.text === '')) {
                out.hosts = [{key: 'easy', text: this.host_from_name(name)}];
            }
            return out;
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
                lines.push((model.upstream === '') ? 'nowhere yet' : `already answers at ${model.upstream}`);
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
            if (id === 'keep') {
                const kept = model.volumes.filter(v => v.target !== '').map(v => v.target);
                // An app folder is its own storage: it stays, and its data/ outlives a new zip
                const app_folder = (model.type === 'shell') && (model.command === 'bin/run') && model.cwd.startsWith('/');
                if (app_folder) {
                    lines.push(`${model.cwd} stays; its data/ is kept through a new version`);
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
                return;
            }
            this.tried = false;
            this.draft = model_copy(this.model);
            this.secrets_gone = [];
            this.editing = id;
            this.strip_touched = false;
            this.image_change();
        },
        // A closed optional card goes back to serviceman's defaults, so what it says is true
        section_close: function (id) {
            const blank = form_from_service(null);
            const fields = {
                keep: ['volumes', 'secrets'],
                policy: ['start', 'restart', 'stop_after_idle', 'never_stop', 'start_timeout', 'stop_timeout', 'request_timeout', 'never_request_timeout', 'start_tries'],
                scale: ['min', 'max', 'concurrency', 'warmup_queue', 'warmup_wait', 'scale_down_after', 'autoscale', 'busy_up', 'up_for', 'busy_down', 'down_for', 'cool_down'],
            }[id] || [];
            for (const name of fields) {
                this.model[name] = blank[name];
            }
            this.opened[id] = false;
        },
        section_cancel: function () {
            this.draft = null;
            this.editing = '';
            this.tried = false;
            this.note = '';
            this.bad = false;
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
        image_paste: function () {
            // The value is not in the box until the paste has landed
            const self = this;
            this.$nextTick(function () {
                self.image_change();
            });
        },
        // The short form's two kinds: what the other one needs is asked of its machine now
        short_kind: function (type) {
            this.m.type = type;
            this.$nextTick(function () {
                const field = (type === 'docker') ? this.$refs.image : this.$refs.pick;
                if (field !== undefined) {
                    field.focus();
                }
            });
            if (type === 'shell') {
                this.ports_read();
            }
        },
        place_change: function () {
            if (this.m.type === 'docker') {
                this.image_change();
                return;
            }
            this.ports_read();
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
            const read = (picked.zip !== undefined) ? await app_zip_read(picked.zip) : app_folder_read(picked.folder);
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
        // What the rows say, sent one by one: a value typed here, a copy asked for from the
        // library, or nothing left in the row at all, which takes the secret away.
        secrets_save: async function (service, model) {
            for (const row of model.secrets) {
                if (row.name === '') {
                    continue;
                }
                if (row.copy_from !== '') {
                    await this.secret_write({service, name: row.name, copy_from: row.copy_from});
                    row.copy_from = '';
                    row.kept = true;
                    continue;
                }
                if (row.value !== '') {
                    await this.secret_write({service, name: row.name, value: row.value});
                    row.value = '';
                    row.kept = true;
                }
            }
            for (const row of this.secrets_gone) {
                await this.secret_write({service, name: row.name, value: ''});
            }
            this.secrets_gone = [];
        },
        secret_write: function (body) {
            return fetch('/api/v1/secrets', {method: 'POST', body: JSON.stringify(body)});
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
                // Something the short form does not show is shown where it can be fixed
                if (Object.keys(this.problems).some(v => ['name', 'port', 'cwd', 'places'].includes(v) === false)) {
                    this.simple = false;
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
            const ok = await this.write('POST', '/api/v1/services', model);
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
            return app_files_send(this.app_files, place, folder, v => this.report(v, false));
        },
        // One card saved: the whole service is sent, and only this card differs from what was
        section_save: async function () {
            this.tried = true;
            if (this.problems_here().length > 0) {
                return;
            }
            const model = this.model_now();
            const ok = await this.write('PUT', `/api/v1/services/${encodeURIComponent(this.original.name)}`, model);
            if (ok) {
                this.model = model;
                this.draft = null;
                this.editing = '';
                this.$emit('saved', model.name);
            }
        },
        // Sends the service and its secrets. A save whose answer never came back is looked for
        // in what serviceman knows, since it may have landed anyway.
        write: async function (method, url, model) {
            this.busy = true;
            this.report('', false);
            try {
                const answer = await fetch(url, {method, body: JSON.stringify({service: json_from_service(model)})});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return false;
                }
                // The secrets are not part of the config, so they are written after it — and
                // under the name the service has now, which may be the name it just got
                await this.secrets_save(model.name, model);
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
        image: '',
        port: '',
        network: '',
        init: true,
        cwd: '',
        env: [],
        volumes: [],
        upstream: '',
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
        out.upstream = model.upstream;
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
