import addresses_pane from './addresses_pane.js';
import agent_current from './agent_current.js';
import authwall_pane from './authwall_pane.js';
import command_copy from './command_copy.js';
import config_read from './config_read.js';
import file_manager from 'file_manager/file_manager.js';
import find_palette from './find_palette.js';
import fold_table from './fold_table.js';
import format_bytes from './format_bytes.js';
import format_ms from './format_ms.js';
import forwards_section from './forwards_section.js';
import health_pane from './health_pane.js';
import join_form from './join_form.js';
import load_tests_pane from './load_tests_pane.js';
import logline_link from './logline_link.js';
import logline_pane from './logline_pane.js';
import logline_stage from './logline_stage.js';
import map_pane from './map_pane.js';
import networking_pane from './networking_pane.js';
import overview_icons from './overview_icons.js';
import remote_docker from './remote_docker.js';
import remote_firewall from './remote_firewall.js';
import remote_form from './remote_form.js';
import remote_overview from './remote_overview.js';
import remote_shell from './remote_shell.js';
import remotes_pane from './remotes_pane.js';
import secrets_form from './secrets_form.js';
import service_doors from './service_doors.js';
import service_form from './service_form.js';
import service_shell from './service_shell.js';
import services_pane from './services_pane.js';
import settled from './settled.js';
import snippet from './snippet.js';
import tokens_form from './tokens_form.js';
import volumes_pane from './volumes_pane.js';

import {createApp} from 'vue';

const POLL_MS = 1000;
// Rows of the package list drawn before the rest are asked for
const PACKAGES_AT_ONCE = 300;

// A machine with no node cannot run the agent, and the whole of node it needs is one file.
// Vladimir's line: the archive is unpacked as it arrives and only bin/node is kept.
const NODE_TEXT = 'v=v24.19.0; curl -fsSL https://nodejs.org/dist/$v/node-$v-linux-x64.tar.xz | pv | tar -xJ --strip-components=2 node-$v-linux-x64/bin/node';

const dot = {
    template: `<span class="dot" :class="phase"/>`,
    props: ['phase'],
};

// How a service stands now, above its cards: the state and what it is doing about it, where it
// is reached, and how much it is being asked. Everything here moves by itself; nothing here is
// set — that is the cards below.
const service_status = {
    template: `
<div class="card svc-status">
    <div class="row-of svc-state">
        <span class="pill" :class="pill">{{ state_text }}</span>
        <span class="muted">{{ state_detail }}</span>
    </div>
    <template v-if="(view.doing !== null)">
        <div class="meter"><i :style="{width: (view.progress === null ? '100%' : (Math.round(view.progress * 100) + '%'))}"/></div>
        <p class="muted">{{ view.doing }}{{ view.progress_text === null ? '' : ' · ' + view.progress_text }}</p>
    </template>
    <p v-if="error_shown" class="bad">{{ view.error }}</p>
    <pre v-if="(tail !== '')" class="tail">{{ tail }}</pre>
    <dl>
        <dt>Address</dt>
        <dd>
            <span v-if="(view.publish.hosts.length === 0 && door_names.length === 0)" class="muted">none — it only runs</span>
            <span v-for="host of view.publish.hosts" :key="host" class="svc-host"><a :href="address_of(host)" target="_blank" rel="noopener">{{ host }}</a></span>
            <span v-for="name of door_names" :key="(name.machine + ' ' + name.host)" class="svc-host" :class="{muted: name.off}"><a v-if="(name.host.startsWith('*') === false)" :href="('https://' + name.host)" target="_blank" rel="noopener">{{ name.host }}</a><code v-else>{{ name.host }}</code> <span class="muted">via {{ name.title }}<template v-if="(name.auth !== null)">, behind {{ name.auth }}</template><template v-if="name.off"> · off</template></span></span>
        </dd>
        <template v-if="(view.type !== 'external')">
            <dt>Runs on</dt>
            <dd>
                <template v-for="(name, i) of view.remotes" :key="name"><span v-if="(i > 0)" class="muted"> then </span><button type="button" class="link" @click="$emit('remote', name)">{{ remote_text(name) }}</button></template>
            </dd>
        </template>
        <template v-else>
            <dt>Answers at</dt>
            <dd><code>{{ view.upstream }}</code><template v-if="(view.remotes.length > 0)"><span class="muted"> on </span><button type="button" class="link" @click="$emit('remote', view.remotes[0])">{{ remote_text(view.remotes[0]) }}</button><span class="muted">, through its link</span></template></dd>
        </template>
        <dt>Requests</dt>
        <dd>{{ view.requests }} served · {{ view.inflight }} in flight<span v-if="(view.queue > 0)"> · {{ view.queue }} waiting</span><span v-if="(view.cold_start_ms !== null)" class="muted"> · last start took {{ format_ms(view.cold_start_ms) }}</span></dd>
        <template v-if="(view.instances.length > 1)">
            <dt>Copies</dt>
            <dd>
                <span v-for="item of view.instances" :key="item.slot" class="svc-copy"><span class="dot" :class="item.phase"/>#{{ item.slot }} {{ item.phase }}<span v-if="(item.inflight > 0)" class="muted"> · {{ item.inflight }} in flight</span></span>
            </dd>
        </template>
    </dl>
</div>
`,
    props: ['view', 'busy', 'port', 'remotes'],
    emits: ['remote'],
    computed: {
        // The names machines' doors answer for this service, beside its own
        door_names: function () {
            const out = [];
            for (const item of ((this.remotes === undefined) ? [] : this.remotes)) {
                const inbound = ((item.inbound === undefined) ? {} : item.inbound);
                for (const host of Object.keys(inbound)) {
                    const rule = ((typeof inbound[host] === 'string') ? {service: inbound[host]} : inbound[host]);
                    if (rule.service === this.view.name) {
                        out.push({machine: item.name, title: (item.title || item.name), host, off: (rule.off === true), auth: ((rule.auth === undefined) ? null : rule.auth)});
                    }
                }
            }
            return out;
        },
        pill: function () {
            if ((this.view.doing !== null) || (this.view.phase === 'starting') || (this.view.phase === 'stopping')) {
                return 'starting';
            }
            if ((this.view.phase === 'failed') || this.view.gave_up) {
                return 'failed';
            }
            return ((this.view.phase === 'running') ? 'running' : 'stopped');
        },
        state_text: function () {
            if (this.view.type === 'external') {
                return 'already running';
            }
            if ((this.view.phase === 'running') && (this.view.policy.instances.max > 1)) {
                return `running · ${this.view.instances_running} of ${this.view.policy.instances.max}`;
            }
            return ((this.view.doing === null) ? this.view.phase : 'working');
        },
        // The one line after the state: when it goes to sleep, how long it has been up, what
        // wakes it, or why it will not
        state_detail: function () {
            const view = this.view;
            if (view.type === 'external') {
                return 'serviceman passes requests on and never starts or stops it';
            }
            if (view.gave_up) {
                return `it failed ${view.failures} times in a row, so serviceman stopped trying — Start tries again`;
            }
            if (view.phase === 'lost') {
                return 'its machine is not connected; it keeps running there';
            }
            if (view.phase === 'running') {
                const said = [];
                if (view.uptime_ms !== null) {
                    said.push(`up ${format_ms(view.uptime_ms)}`);
                }
                if (view.stop_in_ms !== null) {
                    said.push(`sleeps in ${format_ms(view.stop_in_ms)} unless asked`);
                }
                return said.join(' · ');
            }
            if (view.phase === 'stopped') {
                return ((view.policy.start === 'always') ? 'it starts with serviceman' : 'the first request starts it');
            }
            return '';
        },
        error_shown: function () {
            return (this.view.error !== null) && (this.view.phase !== 'running');
        },
        // What it printed while it was worked on; once it runs, the Logs tab is the place
        tail: function () {
            const worth = ((this.view.doing !== null) || (this.view.phase === 'starting') || (this.view.phase === 'failed') || this.error_shown);
            if ((worth === false) || (this.view.said === undefined)) {
                return '';
            }
            return this.view.said.join('\n');
        },
    },
    methods: {
        format_ms,
        remote_text: function (name) {
            const found = ((this.remotes === undefined) ? [] : this.remotes).find(v => v.name === name) || null;
            return ((found === null) ? name : (found.title || found.name));
        },
        address_of: function (host) {
            const mark = host.indexOf('/');
            const hostname = ((mark === -1) ? host : host.slice(0, mark));
            const prefix = ((mark === -1) ? '' : host.slice(mark));
            return ((this.port === 80) ? `http://${hostname}${prefix}` : `http://${hostname}:${this.port}${prefix}`);
        },
    },
};

// The Logs tab of a service: a place kept for what the service itself writes, with nothing in
// it yet — reading a container's log through the link every two seconds was a log of the log
// What a service writes is in Logline, with every other line of every machine: this tab is the
// way to its own, filtered to it
const service_logs = {
    template: `
<article id="detail" class="logs">
    <h1><dot :phase="view.phase"/>{{ view.title || view.name }}</h1>
    <template v-if="(url !== null)">
        <p class="muted">What this service writes goes to Logline, from the machines that send their logs there.</p>
        <p><a :href="url" target="_blank" rel="noopener">Its lines in Logline, the last 24 hours ↗</a></p>
    </template>
    <p v-else class="muted">What this service writes goes to Logline, from the machines that send their logs there. Where Logline's viewer is is not set, so there is nothing to link to — the Logs tab of a machine has the form for it.</p>
</article>
`,
    components: {dot},
    props: ['view', 'logline'],
    computed: {
        url: function () {
            return logline_link(this.logline, 'service', this.view.name);
        },
    },
};

const config_editor = {
    template: `
<div id="editor">
    <div class="ace" ref="ace"/>
    <footer>
        <button type="button" :disabled="busy" @click="check">Check</button>
        <button type="button" :disabled="busy" @click="save">Save</button>
        <button type="button" :disabled="busy" @click="load">Load again</button>
        <button type="button" @click="$emit('close')">Close</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </footer>
</div>
`,
    props: ['theme'],
    emits: ['close', 'saved'],
    data: function () {
        return {hash: null, note: '', bad: false, busy: false};
    },
    watch: {
        theme: function (value) {
            this.ace.setTheme(ace_theme(value));
        },
    },
    methods: {
        load: async function () {
            this.busy = true;
            try {
                const loaded = await config_read();
                if (loaded.error !== undefined) {
                    this.report(loaded.error, true);
                    return;
                }
                this.hash = loaded.hash;
                this.ace.setValue(loaded.text, -1);
                this.report(loaded.path, false);
                this.ace.focus();
            }
            catch {
                this.report('serviceman is not answering', true);
            }
            finally {
                this.busy = false;
            }
        },
        check: async function () {
            const answer = await fetch('/api/v1/config/check', {method: 'POST', body: JSON.stringify({text: this.ace.getValue()})});
            const outcome = await answer.json();
            this.report(outcome.ok ? 'the config reads fine' : outcome.error, outcome.ok === false);
        },
        save: async function () {
            this.busy = true;
            const text = this.ace.getValue();
            try {
                const answer = await fetch('/api/v1/config', {method: 'POST', body: JSON.stringify({text, hash: this.hash})});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.hash = outcome.hash;
                const notes = ((outcome.notes.length > 0) ? outcome.notes.join(' · ') : 'nothing changed');
                this.report(outcome.restart_needed ? `saved · ${notes}` : `saved and applied · ${notes}`, false);
                this.$emit('saved');
            }
            catch {
                this.report('the answer never came back — checking whether it landed…', false);
                const landed = await settled(async () => (await config_read()).text === text);
                if (landed === false) {
                    this.report('serviceman is not answering', true);
                    return;
                }
                await this.load();
                this.report('saved · serviceman restarted while it was answering', false);
                this.$emit('saved');
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
    },
    mounted: function () {
        ace.config.set('basePath', '/vendor/ace');
        this.ace = ace.edit(this.$refs.ace, {
            mode: 'ace/mode/json',
            theme: ace_theme(this.theme),
            fontSize: 13,
            tabSize: 4,
            useSoftTabs: true,
            showPrintMargin: false,
        });
        this.ace.commands.addCommand({
            name: 'save',
            bindKey: {win: 'Ctrl-S', mac: 'Cmd-S'},
            exec: () => this.save(),
        });
        this.load();
    },
    unmounted: function () {
        this.ace.destroy();
    },
};

// The one command that puts the agent on the machine, written with the address this page was
// opened on and the token from the config
const remote_install = {
    template: `
<article id="detail">
    <h1>Install the agent on that machine</h1>
    <div v-if="(doors.length > 1)" class="tabs">
        <button v-for="item of doors" :key="item.key" type="button" class="tab" :class="{on: (item.key === door.key)}" @click="door_pick(item)">{{ item.label }}</button>
    </div>
    <p v-if="(door === null)" class="bad">The agent has no way in: the config gives the control page no port and no socket file.</p>
    <template v-else>
        <p class="muted">One command on that machine. It needs node and nothing else: the script fetches the agent, writes its token beside it, and — where there is systemd — keeps it up across reboots.</p>
        <dl>
            <dt>{{ door.socket === null ? 'It dials' : 'The socket file there' }}</dt>
            <dd>
                <input v-model.trim="typed" class="wide" spellcheck="false">
                <p class="muted">{{ door.hint }}</p>
            </dd>
        </dl>
        <label class="check wide"><input type="checkbox" v-model="root_half"> give it a root half too — the same file under the system's systemd, for the work that has to be root</label>
        <snip :text="install_text"/>
        <p v-if="root_half" class="muted">Run it as yourself, not with sudo in front: it asks for your password once, at the start, and uses it for the root half alone.</p>
        <p class="muted">No node on that machine? It is one file, and it goes in <code>~/bin</code> — nothing is installed and nothing else is touched:</p>
        <snip :text="node_text"/>
        <p class="muted">Or by hand — the two things that command does:</p>
        <snip :text="file_text"/>
        <p class="muted">Or start it as a container, if that machine has docker:</p>
        <snip :text="docker_text"/>
        <p v-if="(door.socket !== null)" class="muted">The socket file must be on that machine. This command copies it there, and no port stays open on the two machines: <code>ssh -R {{ door_where }}:{{ door.socket }} {{ view.name }}</code></p>
        <p class="muted">
            <a :href="'/api/v1/agent.js'" download>Download the agent file</a> ·
            to make the image, run <code>docker build -f Dockerfile.agent -t serviceman-agent .</code> in the repo
        </p>
    </template>
</article>
`,
    components: {snip: snippet},
    props: ['view', 'control'],
    data: function () {
        return {token: null, door_key: null, typed: '', root_half: false};
    },
    computed: {
        token_text: function () {
            return ((this.token === null) ? '<the token in the config>' : this.token);
        },
        agent_url: function () {
            return `${location.protocol}//${location.host}`;
        },
        // The ways in that the config gives an agent: a port, a socket file, or the two of them.
        //
        // What is filled in is what this page was opened on, which is right until serviceman
        // moves — behind tailscale, into a container, behind a name. The address the machine
        // over there must use is the one thing this end cannot know, so it can be typed.
        doors: function () {
            const out = [];
            if (this.control.port !== null) {
                out.push({
                    key: 'http',
                    label: 'http',
                    socket: null,
                    mark: this.agent_url,
                    hint: 'Where that machine reaches this one — a tailscale name, a public address, anything it can resolve.',
                });
            }
            if (this.control.socket !== null) {
                out.push({
                    key: 'socket',
                    label: 'socket',
                    socket: this.control.socket,
                    mark: this.control.socket,
                    hint: 'The path of the socket file on that machine — where an ssh forward puts it, which need not be the path it has here.',
                });
            }
            return out;
        },
        // What the commands below are written with: what is in the field, or — if it was
        // emptied — what this page knows
        door_where: function () {
            return ((this.typed === '') ? this.door.mark : this.typed);
        },
        door: function () {
            const out = this.doors.find(v => v.key === this.door_key);
            if (out !== undefined) {
                return out;
            }
            return ((this.doors.length === 0) ? null : this.doors[0]);
        },
        // The whole install in one line, the way tailscale does it: fetch and run, with the token
        // given to the script instead of baked into it
        install_text: function () {
            const fetched = ((this.door.socket === null)
                ? `curl -fsSL ${this.door_where}/api/v1/install.sh`
                : `curl -fsSL --unix-socket ${this.door_where} http://localhost/api/v1/install.sh`);
            const where = ((this.door.socket === null) ? '' : ` --url ${this.door_url}`);
            const root = (this.root_half ? ' --root' : '');
            return `${fetched} | sh -s -- --token ${this.token_text}${where}${root}`;
        },
        // The url the agent is given: a plain address, or a socket file as unix:///path
        door_url: function () {
            return ((this.door.socket === null) ? this.door_where : `unix://${this.door_where}`);
        },
        file_text: function () {
            const fetched = ((this.door.socket === null)
                ? `curl -fsSL ${this.door_where}/api/v1/agent.js -o serviceman-agent.js`
                : `curl -fsSL --unix-socket ${this.door_where} http://localhost/api/v1/agent.js -o serviceman-agent.js`);
            return `${fetched}\nnode serviceman-agent.js --url ${this.door_url} --token ${this.token_text}`;
        },
        node_text: function () {
            return NODE_TEXT;
        },
        docker_text: function () {
            const words = ['docker run -d --name serviceman-agent --restart always --network host', '-v /var/run/docker.sock:/var/run/docker.sock', '-v /:/host:ro -e SERVICEMAN_DIR=/host'];
            if (this.door.socket !== null) {
                words.push(`-v ${this.door_where}:${this.door_where}`);
            }
            words.push(`-e SERVICEMAN_URL=${this.door_url}`, `-e SERVICEMAN_TOKEN=${this.token_text}`, 'serviceman-agent');
            return words.join(' ');
        },
    },
    watch: {
        'view.name'() {
            this.token = null;
            this.token_read();
        },
    },
    methods: {
        // Picking a door puts what this end knows about it in the field: the address for the
        // port, the path for the socket file. It is a starting point, and it is meant to be
        // edited — the machine over there may reach this one by a different name entirely.
        door_pick: function (door) {
            this.door_key = door.key;
            this.typed = door.mark;
        },
        door_fill: function () {
            this.typed = ((this.door === null) ? '' : this.door.mark);
        },
        // The command is only worth copying with the real token in it, and the config has it
        token_read: async function () {
            if (this.view.phase === 'online') {
                return;
            }
            try {
                const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
                const found = (JSON.parse(loaded.text).remotes || []).find(v => v.name === this.view.name);
                this.token = ((found === undefined) ? null : found.token);
            }
            catch {
                this.token = null;
            }
        },
    },
    mounted: function () {
        this.token_read();
        this.door_fill();
    },
};


// A machine's own upkeep — its agent, its updates, its screen — and nothing moves by itself:
// every change is a press on this page
const remote_configure = {
    template: `
<article id="detail" class="cfg">
    <div>
        <h1>Configure</h1>
        <p class="muted">The agent, the updates and the screen of this machine. Nothing runs by itself — every change is a button on this page.</p>
    </div>
    <p v-if="offline" class="alert">This machine is not connected. What is below is what it last said; nothing can be asked of it until its agent dials in again.</p>
    <section class="card cfg-card">
        <div class="cfg-head">
            <span class="cfg-icon" v-html="icon('robot')"></span>
            <b>Agent</b>
            <span v-if="(agent_pill !== null)" class="pill" :class="agent_pill.tone">{{ agent_pill.text }}</span>
            <button type="button" class="cfg-act" :class="{primary: behind}" :disabled="(offline || updating)" @click="agent_update">{{ (updating ? 'asking…' : (behind ? 'Update the agent' : 'Fetch it again anyway')) }}</button>
        </div>
        <dl>
            <dt>Running</dt>
            <dd>serviceman-agent {{ view.agent_version || '—' }} <span class="muted">· {{ (view.agent_built === null ? 'from before builds were dated' : 'built ' + view.agent_built) }}</span></dd>
            <dt>This host serves</dt>
            <dd>{{ (served === null ? '—' : 'built ' + served) }}</dd>
        </dl>
        <p v-if="behind" class="muted">The two halves of a machine run from the same file: updating replaces it, the session agent starts again at once, and a root half — where there is one — steps aside for it within the half minute.</p>
        <p v-if="(view.update_refused !== null && view.update_refused !== undefined)" class="alert">Last asked, it answered: {{ view.update_refused }}</p>
        <p v-if="(agent_note !== '')" :class="(agent_bad ? 'bad' : 'muted')">{{ agent_note }}</p>
    </section>
    <section class="card cfg-card">
        <div class="cfg-head">
            <span class="cfg-icon" v-html="icon('download')"></span>
            <b>Updates</b>
            <span v-if="(updates_pill !== null)" class="pill" :class="updates_pill.tone">{{ updates_pill.text }}</span>
            <template v-if="(known && apt_able)">
                <button v-if="(apt.phase !== 'running')" type="button" class="cfg-act" :class="{primary: (updates !== null && updates.pending > 0)}" :disabled="(offline || updates === null || updates.pending === 0)" @click="apt_start">Install them</button>
                <button v-else type="button" class="cfg-act" :disabled="cancelling" @click="apt_stop">{{ (cancelling ? 'stopping…' : 'Cancel') }}</button>
            </template>
        </div>
        <p v-if="(known === false)" class="muted">Nothing is known about this machine yet.</p>
        <p v-else-if="(apt_able === false)" class="muted">The agent on this machine is from before installing updates.</p>
        <template v-else>
            <p v-if="(updates === null)" class="muted">This machine says nothing about updates — it is not an ubuntu with update-notifier on it.</p>
            <p v-else-if="(updates.pending === 0)" class="muted">Everything apt knows of is installed.</p>
            <p v-else class="muted">{{ updates.pending }} to install<span v-if="(updates.security > 0)">, {{ updates.security }} of them security</span>. <code>apt-get update</code>, then <code>apt-get upgrade</code>, answering its questions as a person would and keeping every config file you changed.</p>
            <p v-if="(updates !== null && updates.reboot)" class="muted">An installed update wants the machine restarted.</p>
            <p v-if="(apt.phase === 'running')" class="muted">installing… {{ apt.lines.length }} {{ plural(apt.lines.length, 'line', 'lines') }} so far</p>
            <p v-if="(apt.phase === 'ok')" class="muted">done · {{ apt.lines.length }} {{ plural(apt.lines.length, 'line', 'lines') }}</p>
            <p v-if="(apt.phase === 'cancelled')" class="muted">Stopped where it stood. A run stopped in the middle of installing may leave a package half-set-up: <code>sudo dpkg --configure -a</code> on that machine finishes what was interrupted, and the Shell tab is one click away.</p>
            <p v-if="(apt.phase === 'error')" class="bad">{{ apt.error }}</p>
            <p v-if="(apt.containers && apt.containers.down.length > 0)" class="alert">{{ apt.containers.down.length }} {{ plural(apt.containers.down.length, 'container', 'containers') }} ran before the upgrade and cannot start now: {{ apt.containers.down.map(v => v.name).join(', ') }}. The lines below say why, and so does the Problems page.</p>
            <p v-if="(apt.containers && apt.containers.started.length > 0)" class="muted">Started again after the upgrade: {{ apt.containers.started.join(', ') }}.</p>
            <template v-if="sudo_wanted">
                <p class="muted">apt-get has to be root, and sudo on that machine asked for a password — there is nobody here to type one. Give {{ view.name }} a root agent and the question goes away for good: it is the same file, kept up by the system's systemd, dialling nowhere and answering one socket that only {{ agent_user }} may open.</p>
                <snip :text="root_install_text"/>
                <p class="muted">Say it plainly: a machine with a root agent is a machine this page can be root on. The grant is made there, with sudo, by you — and a machine without it simply cannot be updated from here.</p>
            </template>
            <pre v-if="(apt.lines.length > 0)" class="tail" ref="apt_tail">{{ apt.lines.join('\\n') }}</pre>
        </template>
    </section>
    <section class="card cfg-card">
        <div class="cfg-head">
            <span class="cfg-icon" v-html="icon('monitor')"></span>
            <b>Screen</b>
            <button v-if="(known && shot_able)" type="button" class="cfg-act" :disabled="(shooting || offline)" @click="shoot">{{ (shooting ? 'asking…' : 'Take a picture') }}</button>
        </div>
        <p v-if="(known === false)" class="muted">Nothing is known about this machine yet.</p>
        <p v-else-if="(shot_able === false)" class="muted">The agent on this machine is from before screenshots.</p>
        <template v-else>
            <p v-if="(shot === null && shot_note === '')" class="muted">A picture of what this machine's screen shows right now, taken when you press the button. It is shown on this page only and is not saved.</p>
            <p v-if="(shot_note !== '')" :class="(shot_bad ? 'bad' : 'muted')">{{ shot_note }}</p>
            <ul v-if="(shot_tried.length > 0)" class="tried">
                <li v-for="line of shot_tried" :key="line" class="muted">{{ line }}</li>
            </ul>
            <template v-if="shot_wants_gnome">
                <p class="muted">Wayland lets one caller take a picture of the screen: the one gnome itself trusts. <code>gnome-screenshot</code> is that one, and it is not on this machine.</p>
                <snip text="sudo apt install -y gnome-screenshot"/>
                <p class="muted">Then press the button again. A machine whose screen is served by X11 instead wants <code>imagemagick</code>, and one running sway or hyprland wants <code>grim</code>.</p>
            </template>
            <template v-else-if="shot_refused">
                <p class="muted">This machine has the tool and gnome will not let it work: newer gnome answers a screenshot only for somebody sitting at the machine, so <code>gnome-screenshot</code> ends without a word and writes nothing, and the shell's own door says <em>Screenshot is not allowed</em>. Nothing installable changes that.</p>
                <p class="muted">Two ways round it, both of them things you do once on that machine: give it a line of its own that can take the picture — a gnome shell extension that answers on the session bus is the usual one — and name it when the agent starts:</p>
                <snip text="SERVICEMAN_SCREENSHOT='my-capture-line %f' # %f is the file to write"/>
                <p class="muted">Or turn on gnome's own Remote Desktop in Settings and look at the screen that way. serviceman asks the machine and shows what comes back; it cannot talk gnome out of its mind.</p>
            </template>
            <img v-if="(shot !== null)" :src="shot" class="shot" alt="">
        </template>
    </section>
</article>
`,
    components: {snip: snippet},
    props: ['view', 'served'],
    data: function () {
        return {
            shot: null,
            shot_note: '',
            shot_bad: false,
            shooting: false,
            shot_tried: [],
            apt: {phase: 'idle', lines: [], error: null},
            cancelling: false,
            apt_timer: null,
            updating: false,
            agent_note: '',
            agent_bad: false,
        };
    },
    computed: {
        offline: function () {
            return this.view.phase !== 'online';
        },
        // Whether this machine runs something other than what the host serves. An agent from
        // before the build was written in says nothing, and that is behind by definition.
        behind: function () {
            return (this.served !== null) && (this.view.agent_built !== this.served);
        },
        // A machine that has never dialled in has said nothing about itself, which is not the
        // same as an agent too old to do a thing
        known: function () {
            return this.view.machine !== null;
        },
        shot_able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('screenshot');
        },
        apt_able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('apt');
        },
        // The failure with one known answer: the tool gnome trusts is not on the machine
        shot_wants_gnome: function () {
            return /gnome-screenshot: [^·]*ENOENT/.test(this.shot_tried.join(' '));
        },
        // And the one with no answer to install: the tool is there and gnome refuses it
        // anyway, which is what newer gnome does to anything nobody is sitting in front of
        shot_refused: function () {
            const said = this.shot_tried.join(' ');
            return (this.shot_wants_gnome === false) && /gnome-screenshot: (ended|wrote nothing)/.test(said);
        },
        // The one failure that is not the machine's fault and not apt's: sudo had nobody to
        // ask. It is fixed once, on that machine, with the line below.
        sudo_wanted: function () {
            const said = `${this.apt.error || ''} ${this.apt.lines.join(' ')}`;
            return (this.apt.phase === 'error') && /sudo:.*(password|no tty|askpass)/i.test(said);
        },
        agent_user: function () {
            const machine = this.view.machine;
            return (((machine === null) || !machine.user) ? 'the user its agent runs as' : machine.user);
        },
        // The one command that gives a machine its root half, run on that machine
        root_install_text: function () {
            const machine = this.view.machine;
            const dir = (((machine === null) || !machine.dir) ? '~/serviceman-agent' : machine.dir);
            return `sudo ${dir}/bin/install-root`;
        },
        // What the machine last said is waiting; an agent from before the field says nothing
        updates: function () {
            return ((this.view.machine === null) ? null : this.view.machine.updates);
        },
        // The word beside each card's title: where the agent stands against the one served
        agent_pill: function () {
            if (this.served === null) {
                return null;
            }
            return (this.behind ? {tone: 'starting', text: 'update available'} : {tone: 'running', text: 'up to date'});
        },
        updates_pill: function () {
            if ((this.known === false) || (this.apt_able === false)) {
                return null;
            }
            if (this.apt.phase === 'running') {
                return {tone: 'starting', text: 'installing'};
            }
            if (this.updates === null) {
                return {tone: '', text: 'not known'};
            }
            if (this.updates.pending === 0) {
                return {tone: 'running', text: 'up to date'};
            }
            if (this.updates.security > 0) {
                return {tone: 'failed', text: `${this.updates.security} security`};
            }
            return {tone: 'starting', text: `${this.updates.pending} to install`};
        },
    },
    methods: {
        plural,
        icon: icon_html,
        // The agent fetches the file the host serves and starts again with it, so the link
        // drops under this request and comes back a moment later — which is what "it worked"
        // looks like here
        agent_update: async function () {
            this.updating = true;
            this.agent_report('asking the machine…', false);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/agent-update`, {method: 'POST'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.agent_report(outcome.error, true);
                    return;
                }
                this.agent_report('it is fetching the agent and starting again', false);
            }
            catch {
                this.agent_report('the answer never came back', true);
            }
            finally {
                this.updating = false;
            }
        },
        agent_report: function (note, bad) {
            this.agent_note = note;
            this.agent_bad = bad;
        },
        // The run outlives the request that started it, so the page reads how it is going —
        // quickly while it runs, and once more when it ends
        apt_read: async function () {
            clearTimeout(this.apt_timer);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/apt`, {cache: 'no-store'});
                if (answer.ok) {
                    const before = this.apt.lines.length;
                    this.apt = await answer.json();
                    if (this.apt.lines.length !== before) {
                        this.apt_scroll();
                    }
                }
            }
            catch {
                // The next tick asks again; the header already says when serviceman is away
            }
            if (this.apt.phase === 'running') {
                this.apt_timer = setTimeout(() => this.apt_read(), 1000);
            }
        },
        // A log that grows under your eyes follows the last line, the way a terminal does
        apt_scroll: async function () {
            await this.$nextTick();
            const pane = this.$refs.apt_tail;
            if ((pane !== undefined) && (pane !== null)) {
                pane.scrollTop = pane.scrollHeight;
            }
        },
        apt_start: async function () {
            this.apt = {phase: 'running', lines: [], error: null};
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/apt-upgrade`, {method: 'POST'});
                if (answer.ok === false) {
                    const outcome = await answer.json();
                    this.apt = {phase: 'error', lines: [], error: outcome.error};
                    return;
                }
            }
            catch {
                this.apt = {phase: 'error', lines: [], error: 'the answer never came back'};
                return;
            }
            this.apt_read();
        },
        apt_stop: async function () {
            this.cancelling = true;
            try {
                await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/apt-cancel`, {method: 'POST'});
            }
            catch {
                // Whether it stopped is what the run itself says, a moment from now
            }
            finally {
                this.cancelling = false;
            }
        },
        // The png is answered to this page and to nothing else; the last one is let go before
        // the next is asked for
        shoot: async function () {
            this.shooting = true;
            this.shot_tried = [];
            this.shot_report('asking the machine…', false);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/screenshot`, {method: 'POST'});
                if (answer.ok === false) {
                    const outcome = await answer.json();
                    this.shot_tried = ((outcome.tried === undefined) ? [] : outcome.tried);
                    this.shot_report(outcome.error, true);
                    return;
                }
                this.shot_forget();
                this.shot = URL.createObjectURL(await answer.blob());
                this.shot_report('what is on that screen now', false);
            }
            catch {
                this.shot_report('the answer never came back', true);
            }
            finally {
                this.shooting = false;
            }
        },
        shot_forget: function () {
            if (this.shot !== null) {
                URL.revokeObjectURL(this.shot);
                this.shot = null;
            }
        },
        shot_report: function (note, bad) {
            this.shot_note = note;
            this.shot_bad = bad;
        },
    },
    mounted: function () {
        this.apt_read();
    },
    unmounted: function () {
        this.shot_forget();
        clearTimeout(this.apt_timer);
    },
};

// One machine's files, through the File Manager module: its API is this host's
// /api/v1/remotes/<name>/fs, and the agent on that machine does the reading and the writing
const remote_files = {
    template: `
<article v-if="(known === false)" id="detail" class="list fm">
    <p class="muted">This machine has not connected since serviceman last started, so what its agent can do is not known yet. A running agent dials in by itself; the Install tab has the command for a machine without one.</p>
</article>
<article v-else-if="(fs_able === false)" id="detail" class="list fm">
    <p class="muted">The agent on this machine is from before the file manager, so its folders cannot be read yet.</p>
    <p class="muted">It updates itself within a minute or two of being connected; the Overview says when it refuses, and why.</p>
</article>
<file-manager v-else id="detail" class="list" :base="base" :theme="theme" :offline="offline" :open_base="open_base" :title="(view.title || view.name)" :user="agent_user" home_title="The home folder of the agent's user" :start="start" transfers="/api/v1/transfers" :disk="view.name" :targets="targets" @path="$emit('path', $event)"/>
`,
    components: {'file-manager': file_manager},
    // start: the folder to open first, from the address; path: each folder opened after
    props: ['view', 'remotes', 'control', 'theme', 'start'],
    emits: ['path'],
    computed: {
        // The other machines a file can be copied to: one that is not connected now takes the
        // copy when it is back
        targets: function () {
            const out = [];
            for (const item of ((this.remotes === undefined) ? [] : this.remotes)) {
                if (item.name !== this.view.name) {
                    out.push({value: item.name, label: ((item.phase === 'online') ? (item.title || item.name) : `${item.title || item.name} (${item.phase})`)});
                }
            }
            return out;
        },
        base: function () {
            return `/api/v1/remotes/${encodeURIComponent(this.view.name)}/fs`;
        },
        offline: function () {
            return this.view.phase !== 'online';
        },
        known: function () {
            return this.view.machine !== null;
        },
        fs_able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('fs_list');
        },
        agent_user: function () {
            const machine = this.view.machine;
            return (((machine === null) || !machine.user) ? 'the user its agent runs as' : machine.user);
        },
        // A file opens under its machine's own name — phone.fs.<control host> — where the whole
        // path is the address, so a page finds its style.css one name over. A machine whose
        // name cannot be a label, or a control page with no name, opens through the API.
        open_base: function () {
            if ((this.control === undefined) || (this.control === null) || (this.control.host === null) || this.view.name.includes('.')) {
                return null;
            }
            const port = ((location.port === '') ? '' : `:${location.port}`);
            return `${location.protocol}//${this.view.name}.fs.${this.control.host}${port}`;
        },
    },
};

// Everything this host wrote about one machine, and everything that machine said itself
// The list as a tree: every process under the one that started it, and one whose parent is not
// in the list stands as a root of its own. ps prints by pid, so children keep that order.
function proc_rows(items, closed)
{
    const by_pid = {};
    for (const item of items) {
        by_pid[item.pid] = item;
    }
    const kids = {};
    const roots = [];
    for (const item of items) {
        const parent = by_pid[item.ppid];
        if ((parent === undefined) || (parent === item)) {
            roots.push(item);
            continue;
        }
        if (kids[item.ppid] === undefined) {
            kids[item.ppid] = [];
        }
        kids[item.ppid].push(item);
    }
    const out = [];
    for (const item of roots) {
        proc_walk(out, kids, closed, item, 0);
    }
    return out;
}

// One process and what it started, as rows. A folded one keeps its children out of the list
// and says how many it is holding — a folded row that hides its count looks like a leaf.
function proc_walk(out, kids, closed, item, depth)
{
    const children = ((kids[item.pid] === undefined) ? [] : kids[item.pid]);
    if (closed[item.pid] === true) {
        out.push({item, depth, children: children.length, hidden: proc_count(kids, item)});
        return;
    }
    out.push({item, depth, children: children.length, hidden: 0});
    for (const kid of children) {
        proc_walk(out, kids, closed, kid, depth + 1);
    }
}

// How many processes are under this one, all the way down
function proc_count(kids, item)
{
    const children = ((kids[item.pid] === undefined) ? [] : kids[item.pid]);
    let out = children.length;
    for (const kid of children) {
        out += proc_count(kids, kid);
    }
    return out;
}

// The ways the process list is shown: the tree, or the heaviest first
const PROC_VIEWS = [
    {value: 'tree', label: 'Tree'},
    {value: 'cpu', label: 'Top CPU'},
    {value: 'rss', label: 'Top memory'},
];

// Whether a process is what was typed: its command, its user or its pid
function proc_matches(item, query)
{
    return item.command.toLowerCase().includes(query) || String(item.user).toLowerCase().includes(query) || (String(item.pid) === query);
}

// The matches and every process above them, so a match keeps its place in the tree
function proc_with_parents(items, matched)
{
    const by_pid = {};
    for (const item of items) {
        by_pid[item.pid] = item;
    }
    const kept = new Set();
    for (const pid of matched) {
        let at = by_pid[pid];
        while ((at !== undefined) && (kept.has(at.pid) === false)) {
            kept.add(at.pid);
            at = ((at.ppid === at.pid) ? undefined : by_pid[at.ppid]);
        }
    }
    return items.filter(v => kept.has(v.pid));
}

// How heavy a share is, for the bar under it: amber from half, red from nine tenths
function load_level(share)
{
    if (share >= 0.9) {
        return 'full';
    }
    return ((share >= 0.5) ? 'filling' : '');
}

// Everything running on a machine, as the tree it is: a process sits under the one that
// started it, and a branch folds away. ps is run over there when the pane opens and when Read
// again is pressed — a table this long on a clock would be a machine talking about itself all
// day, and a tree that moves under the hand is one nobody can read.
const remote_processes = {
    template: `
<article id="detail" class="procs-pane">
    <p v-if="(known === false)" class="muted">This machine has not connected since serviceman last started, so what its agent can do is not known yet. A running agent dials in by itself; the Install tab has the command for a machine without one.</p>
    <template v-else-if="(proc_able === false)">
        <p class="muted">The agent on this machine is from before the process list, so what it is running cannot be read yet.</p>
        <p class="muted">It updates itself within a minute or two of being connected; the Overview says when it refuses, and why.</p>
    </template>
    <template v-else>
        <div class="list-bar">
            <button type="button" :disabled="(busy || offline)" @click="read">Read again</button>
            <command-copy :commands="commands"/>
            <input v-model="query" class="list-find" type="search" placeholder="Filter by command, user or pid" spellcheck="false" aria-label="Filter processes">
            <span class="seg">
                <button v-for="option of views" :key="option.value" type="button" :class="{on: (view_by === option.value)}" @click="view_by = option.value">{{ option.label }}</button>
            </span>
            <button v-if="(view_by === 'tree' && query === '' && rows.length > 0)" type="button" @click="fold_all">{{ (folded ? 'Unfold all' : 'Fold all') }}</button>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </div>
        <div v-if="(items.length > 0)" class="list-summary muted">
            <span>{{ items.length }} {{ plural(items.length, 'process', 'processes') }}</span>
            <span>{{ users }} {{ plural(users, 'user', 'users') }}</span>
            <span :title="cpu_title">CPU {{ cpu_share }}% of {{ cores }} {{ plural(cores, 'core', 'cores') }}<template v-if="(window_ms === null)"> · lifetime averages</template></span>
            <span>RSS {{ format_bytes(rss_total) }}</span>
            <span v-if="(query !== '')">{{ matched_count }} {{ plural(matched_count, 'match', 'matches') }}</span>
        </div>
        <!-- Command and State never fold; the rest fold where the pane is narrow, CPU last -->
        <fold-table v-if="(rows.length > 0)" v-slot="fold" :order="['user', 'pid', 'running', 'rss', 'memory', 'cpu']">
            <table class="procs">
                <thead>
                    <tr>
                        <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                        <th>Command</th>
                        <th data-fold="pid">PID</th>
                        <th data-fold="user">User</th>
                        <th data-fold="cpu">CPU</th>
                        <th data-fold="memory">Memory</th>
                        <th data-fold="rss">RSS</th>
                        <th data-fold="running">Running</th>
                        <th>State</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="row of rows" :key="row.item.pid">
                        <!-- The row opens what folded; with nothing folded it opens its branch, as the caret does -->
                        <tr :class="{folds: (row.children > 0 && foldable && fold.folded.length === 0), dim: row.dim, foldable: (fold.folded.length > 0), open: fold.is_open(row.item.pid)}" @click="row_click(row, fold, $event)">
                            <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                            <td class="tree" :style="{paddingLeft: ((row.depth*1.1) + 'rem')}" :title="row.item.command">
                                <button v-if="(row.children > 0 && foldable)" type="button" class="caret" :class="{open: (closed[row.item.pid] !== true)}" :title="((closed[row.item.pid] === true) ? 'Unfold this branch' : 'Fold this branch')" @click.stop="branch_toggle(row)"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></button>
                                <span v-else-if="(view_by === 'tree')" class="caret"></span>
                                <code>{{ row.item.command }}</code>
                                <span v-if="(row.hidden > 0)" class="muted"> +{{ row.hidden }}</span>
                            </td>
                            <td data-fold="pid">{{ row.item.pid }}</td>
                            <td data-fold="user">{{ row.item.user }}</td>
                            <td data-fold="cpu">
                                <span class="load">
                                    <span class="meter" :class="load_level(row.item.cpu/100)"><i :style="{width: (Math.max(2, Math.min(100, row.item.cpu)) + '%')}"></i></span>
                                    {{ row.item.cpu.toFixed(1) }}%
                                </span>
                            </td>
                            <td data-fold="memory">
                                <span class="load">
                                    <span class="meter" :class="load_level(row.item.mem/25)"><i :style="{width: (Math.max(2, Math.min(100, row.item.mem*4)) + '%')}"></i></span>
                                    {{ row.item.mem.toFixed(1) }}%
                                </span>
                            </td>
                            <td data-fold="rss">{{ format_bytes(row.item.rss) }}</td>
                            <td data-fold="running">{{ format_ms(row.item.elapsed_ms) }}</td>
                            <td class="muted">{{ row.item.state }}</td>
                        </tr>
                        <tr v-if="fold.is_open(row.item.pid)" class="fold-more">
                            <td :colspan="fold.span">
                                <dl class="fold-details">
                                    <template v-if="fold.folded.includes('pid')">
                                        <dt>PID</dt>
                                        <dd>{{ row.item.pid }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('user')">
                                        <dt>User</dt>
                                        <dd>{{ row.item.user }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('cpu')">
                                        <dt>CPU</dt>
                                        <dd>
                                            <span class="load">
                                                <span class="meter" :class="load_level(row.item.cpu/100)"><i :style="{width: (Math.max(2, Math.min(100, row.item.cpu)) + '%')}"></i></span>
                                                {{ row.item.cpu.toFixed(1) }}%
                                            </span>
                                        </dd>
                                    </template>
                                    <template v-if="fold.folded.includes('memory')">
                                        <dt>Memory</dt>
                                        <dd>
                                            <span class="load">
                                                <span class="meter" :class="load_level(row.item.mem/25)"><i :style="{width: (Math.max(2, Math.min(100, row.item.mem*4)) + '%')}"></i></span>
                                                {{ row.item.mem.toFixed(1) }}%
                                            </span>
                                        </dd>
                                    </template>
                                    <template v-if="fold.folded.includes('rss')">
                                        <dt>RSS</dt>
                                        <dd>{{ format_bytes(row.item.rss) }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('running')">
                                        <dt>Running</dt>
                                        <dd>{{ format_ms(row.item.elapsed_ms) }}</dd>
                                    </template>
                                </dl>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </fold-table>
        <p v-else-if="(items.length > 0)" class="muted">Nothing matches “{{ query }}”.</p>
    </template>
</article>
`,
    components: {'command-copy': command_copy},
    props: ['view'],
    data: function () {
        // What is folded, by pid. A read that brings the same tree back keeps the folds it had.
        return {items: [], commands: undefined, window_ms: null, closed: {}, note: '', bad: false, busy: false, query: '', view_by: 'tree', views: PROC_VIEWS};
    },
    computed: {
        offline: function () {
            return this.view.phase !== 'online';
        },
        known: function () {
            return this.view.machine !== null;
        },
        proc_able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('proc_list');
        },
        matched: function () {
            const query = this.query.trim().toLowerCase();
            return ((query === '') ? null : new Set(this.items.filter(v => proc_matches(v, query)).map(v => v.pid)));
        },
        matched_count: function () {
            return ((this.matched === null) ? this.items.length : this.matched.size);
        },
        // A branch folds only in the whole tree: a filtered one shows every match
        foldable: function () {
            return (this.view_by === 'tree') && (this.matched === null);
        },
        rows: function () {
            const matched = this.matched;
            if (this.view_by !== 'tree') {
                const field = this.view_by;
                const items = ((matched === null) ? this.items : this.items.filter(v => matched.has(v.pid)));
                return items.slice().sort((a, b) => b[field] - a[field]).map(v => ({item: v, depth: 0, children: 0, hidden: 0, dim: false}));
            }
            if (matched === null) {
                return proc_rows(this.items, this.closed);
            }
            return proc_rows(proc_with_parents(this.items, matched), {}).map(v => ({item: v.item, depth: v.depth, children: v.children, hidden: 0, dim: matched.has(v.item.pid) === false}));
        },
        // Whether the button folds or unfolds: with nothing open below the roots, it unfolds
        folded: function () {
            return this.rows.every(v => (v.children === 0) || (this.closed[v.item.pid] === true));
        },
        users: function () {
            return new Set(this.items.map(v => v.user)).size;
        },
        cores: function () {
            const machine = this.view.machine;
            return (((machine === null) || !machine.cpu) ? 1 : Math.max(1, machine.cpu.count));
        },
        // Each process is a share of one core, as top shows it; together they are a share of
        // all the machine has
        cpu_share: function () {
            return Math.min(100, Math.round(this.items.reduce((sum, item) => sum + item.cpu, 0)/this.cores));
        },
        cpu_title: function () {
            if (this.window_ms === null) {
                return 'This agent is older and reports what ps does: each process\'s average over its whole life.';
            }
            return `What each process used over the ${this.window_ms} ms before the list was read; 100% is one whole core.`;
        },
        rss_total: function () {
            return this.items.reduce((sum, item) => sum + item.rss, 0);
        },
    },
    watch: {
        // An old agent updates itself while this pane is open; the first read follows by itself
        proc_able: function (value) {
            if (value && (this.items.length === 0)) {
                this.read();
            }
        },
        // A read that failed while the machine was away, or restarting, is read again once it
        // has dialled back in
        'view.connected_at': function () {
            if (this.bad && this.proc_able && (this.view.phase === 'online')) {
                this.read();
            }
        },
    },
    methods: {
        format_bytes,
        format_ms,
        load_level,
        plural,
        read: async function () {
            if (this.busy) {
                return;
            }
            this.busy = true;
            this.report('reading…', false);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/processes`, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.items = outcome.items;
                this.commands = outcome.commands;
                this.window_ms = ((outcome.cpu_window_ms === undefined) ? null : outcome.cpu_window_ms);
                this.report(`read ${new Date().toLocaleTimeString()}`, false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        // With columns folded, a click on the row opens what folded and the caret opens the
        // branch; with none folded, the whole row opens the branch
        row_click: function (row, fold, event) {
            if (fold.folded.length > 0) {
                fold.toggle(row.item.pid, event);
                return;
            }
            this.branch_toggle(row);
        },
        branch_toggle: function (row) {
            if ((row.children === 0) || (this.foldable === false)) {
                return;
            }
            if (this.closed[row.item.pid] === true) {
                delete this.closed[row.item.pid];
            }
            else {
                this.closed[row.item.pid] = true;
            }
        },
        // Everything at once, both ways: folded, the tree is its roots; unfolded, it is the
        // whole machine again
        fold_all: function () {
            if (this.folded) {
                this.closed = {};
                return;
            }
            const closed = {};
            for (const item of this.items) {
                closed[item.pid] = true;
            }
            this.closed = closed;
        },
    },
    mounted: function () {
        if (this.proc_able) {
            this.read();
        }
    },
};

// Every filesystem of a machine: the room each has, and the files it may still hold. A disk
// out of inodes refuses new files with space to spare, so the two stand side by side.
const remote_disks = {
    template: `
<article id="detail" class="list">
    <p v-if="(known === false)" class="muted">This machine has not connected since serviceman last started, so what its agent can do is not known yet. A running agent dials in by itself; the Install tab has the command for a machine without one.</p>
    <template v-else-if="(disk_able === false)">
        <p class="muted">The agent on this machine is from before the disk list, so its disks cannot be read yet.</p>
        <p class="muted">It updates itself within a minute or two of being connected; the Overview says when it refuses, and why.</p>
    </template>
    <template v-else>
        <div class="list-tools">
            <span>{{ summary }}</span>
            <button type="button" class="chip" :class="{on: show_all}" :title="(show_all ? 'Show the disks alone' : 'Show tmpfs, overlay and loop mounts too')" @click="show_all = !show_all">everything mounted <span class="muted">{{ items.length }}</span></button>
            <span class="list-right">
                <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
                <button type="button" :disabled="(busy || offline)" @click="read">Read again</button>
                <command-copy :commands="commands"/>
            </span>
        </div>
        <!-- Disk and Space used never fold; the rest fold where the pane is narrow, Free last -->
        <fold-table v-if="(rows.length > 0)" v-slot="fold" class="card" :order="['inodes_free', 'inodes_used', 'type', 'mounted', 'free']">
            <table class="list-table disks-table">
                <thead>
                    <tr>
                        <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                        <th>Disk</th>
                        <th data-fold="mounted">Mounted at</th>
                        <th data-fold="type">Type</th>
                        <th>Space used</th>
                        <th data-fold="free">Free</th>
                        <th data-fold="inodes_used">Inodes used</th>
                        <th data-fold="inodes_free">Inodes free</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="item of rows" :key="row_key(item)">
                        <tr :class="{muted: (item.disk === false), foldable: (fold.folded.length > 0), open: fold.is_open(row_key(item))}" @click="fold.toggle(row_key(item), $event)">
                            <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                            <td class="wraps"><code>{{ item.device }}</code></td>
                            <td data-fold="mounted">
                                <code>{{ item.mounts[0] }}</code>
                                <div v-if="(item.mounts.length > 1)" class="muted disk-also" :title="item.mounts.slice(1).join(', ')">also at {{ item.mounts.slice(1, 4).join(', ') }}{{ item.mounts.length > 4 ? ' and ' + (item.mounts.length - 4) + ' more' : '' }}</div>
                                <div v-if="(item.key_of !== undefined && item.key_of !== null)" class="muted">holds the key of {{ item.key_of }}</div>
                            </td>
                            <td data-fold="type">{{ item.type }}<span v-if="item.encrypted" class="tag disk-lock">encrypted</span></td>
                            <td>
                                <div class="disk-use">
                                    <span class="meter" :class="level_of(item.used, item.total)"><i :style="{width: (percent_of(item.used, item.total) + '%')}"/></span>
                                    <span>{{ percent_of(item.used, item.total) }}%</span>
                                </div>
                                <div class="muted">{{ format_bytes(item.used) }} of {{ format_bytes(item.total) }}</div>
                            </td>
                            <td data-fold="free">{{ format_bytes(item.free) }}</td>
                            <td data-fold="inodes_used">
                                <template v-if="(item.inodes_total !== null)">
                                    <div class="disk-use">
                                        <span class="meter" :class="level_of(item.inodes_used, item.inodes_total)"><i :style="{width: (percent_of(item.inodes_used, item.inodes_total) + '%')}"/></span>
                                        <span>{{ percent_of(item.inodes_used, item.inodes_total) }}%</span>
                                    </div>
                                    <div class="muted">{{ count_text(item.inodes_used) }} of {{ count_text(item.inodes_total) }}</div>
                                </template>
                                <span v-else class="muted">not counted</span>
                            </td>
                            <td data-fold="inodes_free">{{ item.inodes_total === null ? '' : count_text(item.inodes_free) }}</td>
                        </tr>
                        <tr v-if="fold.is_open(row_key(item))" class="fold-more">
                            <td :colspan="fold.span">
                                <dl class="fold-details">
                                    <template v-if="fold.folded.includes('mounted')">
                                        <dt>Mounted at</dt>
                                        <dd>
                                            <code>{{ item.mounts[0] }}</code>
                                            <div v-if="(item.mounts.length > 1)" class="muted">also at {{ item.mounts.slice(1).join(', ') }}</div>
                                            <div v-if="(item.key_of !== undefined && item.key_of !== null)" class="muted">holds the key of {{ item.key_of }}</div>
                                        </dd>
                                    </template>
                                    <template v-if="fold.folded.includes('type')">
                                        <dt>Type</dt>
                                        <dd>{{ item.type }}<span v-if="item.encrypted" class="tag disk-lock">encrypted</span></dd>
                                    </template>
                                    <template v-if="fold.folded.includes('free')">
                                        <dt>Free</dt>
                                        <dd>{{ format_bytes(item.free) }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('inodes_used')">
                                        <dt>Inodes used</dt>
                                        <dd>
                                            <template v-if="(item.inodes_total !== null)">
                                                <div class="disk-use">
                                                    <span class="meter" :class="level_of(item.inodes_used, item.inodes_total)"><i :style="{width: (percent_of(item.inodes_used, item.inodes_total) + '%')}"/></span>
                                                    <span>{{ percent_of(item.inodes_used, item.inodes_total) }}%</span>
                                                </div>
                                                <div class="muted">{{ count_text(item.inodes_used) }} of {{ count_text(item.inodes_total) }}</div>
                                            </template>
                                            <span v-else class="muted">not counted</span>
                                        </dd>
                                    </template>
                                    <template v-if="fold.folded.includes('inodes_free')">
                                        <dt>Inodes free</dt>
                                        <dd :class="{muted: (item.inodes_total === null)}">{{ item.inodes_total === null ? 'not counted' : count_text(item.inodes_free) }}</dd>
                                    </template>
                                </dl>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </fold-table>
        <p v-else-if="(busy === false && items.length > 0)" class="muted">No disks of its own — everything mounted here is tmpfs, overlay or a loop image. The chip above shows them.</p>
    </template>
</article>
`,
    components: {'command-copy': command_copy},
    props: ['view'],
    data: function () {
        return {items: [], commands: undefined, show_all: false, note: '', bad: false, busy: false};
    },
    computed: {
        offline: function () {
            return this.view.phase !== 'online';
        },
        known: function () {
            return this.view.machine !== null;
        },
        disk_able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('disk_list');
        },
        rows: function () {
            return (this.show_all ? this.items : this.items.filter(v => v.disk));
        },
        // The disks together, as the card on the Remotes page counts them
        summary: function () {
            const disks = this.items.filter(v => v.disk);
            if (disks.length === 0) {
                return '';
            }
            let used = 0;
            let total = 0;
            for (const item of disks) {
                used += item.used;
                total += item.total;
            }
            return `${disks.length} ${plural(disks.length, 'disk', 'disks')} · ${format_bytes(used)} of ${format_bytes(total)} used`;
        },
    },
    watch: {
        // An old agent updates itself while this pane is open; the first read follows by itself
        disk_able: function (value) {
            if (value && (this.items.length === 0)) {
                this.read();
            }
        },
        // A read that failed while the machine was away, or restarting, is read again once it
        // has dialled back in
        'view.connected_at': function () {
            if (this.bad && this.disk_able && (this.view.phase === 'online')) {
                this.read();
            }
        },
    },
    methods: {
        format_bytes,
        read: async function () {
            if (this.busy) {
                return;
            }
            this.busy = true;
            this.report('reading…', false);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/disks`, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.items = outcome.items;
                this.commands = outcome.commands;
                this.report('', false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        // A device may be mounted twice and a tmpfs is mounted everywhere: the two name a row
        row_key: function (item) {
            return `${item.device} ${item.mounts[0]}`;
        },
        percent_of: function (part, whole) {
            return ((whole > 0) ? Math.round(part/whole*100) : 0);
        },
        // A disk past nine tenths is one to look at; past three quarters, one to keep an eye on
        level_of: function (part, whole) {
            const percent = this.percent_of(part, whole);
            return ((percent >= 90) ? 'full' : ((percent >= 75) ? 'filling' : ''));
        },
        // 8775070 -> "8.8M": inodes are a count, not bytes
        count_text: function (count) {
            if (count < 10000) {
                return String(count);
            }
            if (count < 1000000) {
                return `${Math.round(count/1000)}K`;
            }
            return `${(count/1000000).toFixed(1)}M`;
        },
    },
    mounted: function () {
        if (this.disk_able) {
            this.read();
        }
    },
};

// Every package dpkg keeps on a machine: what each is, how much room it takes, which were
// asked for by name, and which an upgrade would move on. A machine carries a few thousand,
// so a filter comes first and the table shows a screenful until asked for the rest.
const remote_packages = {
    template: `
<article id="detail" class="list">
    <p v-if="(known === false)" class="muted">This machine has not connected since serviceman last started, so what its agent can do is not known yet. A running agent dials in by itself; the Install tab has the command for a machine without one.</p>
    <template v-else-if="(package_able === false)">
        <p class="muted">The agent on this machine is from before the package list, so its packages cannot be read yet.</p>
        <p class="muted">It updates itself within a minute or two of being connected; the Configure tab says when it refuses, and why.</p>
    </template>
    <template v-else>
        <div class="list-tools">
            <input v-model.trim="filter" type="search" placeholder="filter by name, section, what it is" spellcheck="false">
            <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" :title="chip.title" @click="show = chip.value">
                {{ chip.label }}
                <span class="muted">{{ chip.count }}</span>
            </button>
            <span class="list-right">
                <span class="muted">Sort by</span>
                <span class="seg">
                    <button type="button" :class="{on: (order === 'name')}" @click="order = 'name'">Name</button>
                    <button type="button" :class="{on: (order === 'size')}" @click="order = 'size'">Size</button>
                </span>
                <button type="button" :disabled="(busy || offline)" @click="read">Read again</button>
                <command-copy :commands="commands"/>
            </span>
        </div>
        <p v-if="(note !== '' || summary !== '')" :class="(bad ? 'bad' : 'muted')">{{ (note !== '' ? note : summary) }}</p>
        <!-- Package never folds, nor its held and half installed; the rest fold where the pane is narrow, Size last -->
        <fold-table v-if="(shown.length > 0)" v-slot="fold" class="card" :order="['summary', 'section', 'installed', 'version', 'size']">
            <table class="list-table packages-table">
                <thead>
                    <tr>
                        <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                        <th>Package</th>
                        <th data-fold="version">Version</th>
                        <th data-fold="size" class="package-size">Size</th>
                        <th data-fold="section">Section</th>
                        <th data-fold="installed">Installed</th>
                        <th data-fold="summary">What it is</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="item of shown" :key="row_key(item)">
                        <tr :class="{foldable: (fold.folded.length > 0), open: fold.is_open(row_key(item))}" @click="fold.toggle(row_key(item), $event)">
                            <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                            <!-- What it is wraps beside it; the name only once Size, the last, has folded too -->
                            <td :class="{wraps: fold.folded.includes('size')}">
                                <code>{{ item.name }}</code><span v-if="(item.arch !== native && item.arch !== 'all')" class="muted">:{{ item.arch }}</span>
                                <span v-if="item.held" class="tag" title="apt-mark hold: an upgrade leaves it where it is">held</span>
                                <span v-if="item.broken" class="tag bad" title="dpkg did not finish with it; sudo dpkg --configure -a finishes what was interrupted">half installed</span>
                            </td>
                            <td data-fold="version">
                                <code>{{ item.version }}</code>
                                <div v-if="(item.update !== null)" class="package-next">→ <code>{{ item.update.version }}</code><span v-if="item.update.security" class="tag package-security">security</span></div>
                            </td>
                            <td data-fold="size" class="package-size">{{ (item.size === null ? '' : format_bytes(item.size)) }}</td>
                            <td data-fold="section" class="muted">{{ item.section }}</td>
                            <td data-fold="installed" :class="{muted: (item.manual === false)}">{{ (item.manual ? 'by hand' : 'as a need') }}</td>
                            <td data-fold="summary" class="package-summary">{{ item.summary }}</td>
                        </tr>
                        <tr v-if="fold.is_open(row_key(item))" class="fold-more">
                            <td :colspan="fold.span">
                                <dl class="fold-details">
                                    <template v-if="fold.folded.includes('version')">
                                        <dt>Version</dt>
                                        <dd>
                                            <code>{{ item.version }}</code>
                                            <div v-if="(item.update !== null)" class="package-next">→ <code>{{ item.update.version }}</code><span v-if="item.update.security" class="tag package-security">security</span></div>
                                        </dd>
                                    </template>
                                    <template v-if="(fold.folded.includes('size') && item.size !== null)">
                                        <dt>Size</dt>
                                        <dd>{{ format_bytes(item.size) }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('section')">
                                        <dt>Section</dt>
                                        <dd class="muted">{{ item.section }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('installed')">
                                        <dt>Installed</dt>
                                        <dd :class="{muted: (item.manual === false)}">{{ (item.manual ? 'by hand' : 'as a need') }}</dd>
                                    </template>
                                    <template v-if="fold.folded.includes('summary')">
                                        <dt>What it is</dt>
                                        <dd>{{ item.summary }}</dd>
                                    </template>
                                </dl>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </fold-table>
        <p v-else-if="(busy === false && items.length > 0)" class="muted">No package here matches.</p>
        <p v-if="(matching.length > shown.length)"><button type="button" @click="limit = matching.length">Show the other {{ matching.length - shown.length }}</button></p>
    </template>
</article>
`,
    components: {'command-copy': command_copy},
    props: ['view'],
    data: function () {
        return {items: [], commands: undefined, filter: '', show: 'all', order: 'name', limit: PACKAGES_AT_ONCE, manual_known: true, updates_known: true, note: '', bad: false, busy: false};
    },
    computed: {
        offline: function () {
            return this.view.phase !== 'online';
        },
        known: function () {
            return this.view.machine !== null;
        },
        package_able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('package_list');
        },
        // The machine's own architecture, the one most of its packages are built for: only
        // a package of another one says which it is
        native: function () {
            const count = {};
            let out = 'all';
            for (const item of this.items) {
                count[item.arch] = (count[item.arch] || 0) + 1;
                if ((item.arch !== 'all') && ((out === 'all') || (count[item.arch] > count[out]))) {
                    out = item.arch;
                }
            }
            return out;
        },
        chips: function () {
            const out = [
                {value: 'all', label: 'all', count: this.items.length, title: 'Every installed package'},
                {value: 'manual', label: 'by hand', count: this.items.filter(v => v.manual).length, title: 'Asked for by name; the rest came along as something else needed them'},
                {value: 'update', label: 'to update', count: this.items.filter(v => v.update !== null).length, title: 'What apt-get upgrade would move on, as of the last apt-get update'},
            ];
            const held = this.items.filter(v => v.held).length;
            if (held > 0) {
                out.push({value: 'held', label: 'held', count: held, title: 'Kept where they are by apt-mark hold'});
            }
            const broken = this.items.filter(v => v.broken).length;
            if (broken > 0) {
                out.push({value: 'broken', label: 'half installed', count: broken, title: 'dpkg did not finish with these'});
            }
            return out;
        },
        matching: function () {
            const words = this.filter.toLowerCase().split(/\s+/).filter(v => v !== '');
            const show = this.show;
            const out = this.items.filter(function (item) {
                if (((show === 'manual') && (item.manual === false)) || ((show === 'update') && (item.update === null)) || ((show === 'held') && (item.held === false)) || ((show === 'broken') && (item.broken === false))) {
                    return false;
                }
                const text = `${item.name} ${item.section} ${item.summary}`.toLowerCase();
                return words.every(v => text.includes(v));
            });
            if (this.order === 'size') {
                out.sort((a, b) => (b.size || 0) - (a.size || 0));
            }
            return out;
        },
        shown: function () {
            return this.matching.slice(0, this.limit);
        },
        summary: function () {
            if (this.items.length === 0) {
                return '';
            }
            let size = 0;
            for (const item of this.items) {
                size += (item.size || 0);
            }
            const update = this.items.filter(v => v.update !== null);
            const security = update.filter(v => v.update.security).length;
            const parts = [`${this.items.length} ${plural(this.items.length, 'package', 'packages')} · ${format_bytes(size)}`];
            if (this.updates_known === false) {
                parts.push('apt could not be asked what an upgrade would bring');
            }
            else if (update.length > 0) {
                parts.push(`${update.length} to update${(security > 0) ? `, ${security} of them security` : ''}`);
            }
            else {
                parts.push('nothing to update');
            }
            if (this.manual_known === false) {
                parts.push('apt-mark could not say which were installed by hand');
            }
            return parts.join(' · ');
        },
    },
    watch: {
        // An old agent updates itself while this pane is open; the first read follows by itself
        package_able: function (value) {
            if (value && (this.items.length === 0)) {
                this.read();
            }
        },
        // A read that failed while the machine was away, or restarting, is read again once it
        // has dialled back in
        'view.connected_at': function () {
            if (this.bad && this.package_able && (this.view.phase === 'online')) {
                this.read();
            }
        },
        filter: function () {
            this.limit = PACKAGES_AT_ONCE;
        },
        show: function () {
            this.limit = PACKAGES_AT_ONCE;
        },
    },
    methods: {
        format_bytes,
        read: async function () {
            if (this.busy) {
                return;
            }
            this.busy = true;
            this.report('reading… dpkg, then a dry-run upgrade, which takes a second or two', false);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/packages`, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.items = outcome.items;
                this.commands = outcome.commands;
                this.manual_known = outcome.manual_known;
                this.updates_known = outcome.updates_known;
                this.report('', false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        // libc6:amd64 and libc6:i386 are two rows
        row_key: function (item) {
            return `${item.name}:${item.arch}`;
        },
    },
    mounted: function () {
        if (this.package_able) {
            this.read();
        }
    },
};

// Where one machine's container output goes, and how it is going: switched here, and every
// number the machine says about its sending. Logline keeps the lines; this page keeps none.
const remote_logline = {
    template: `
<article id="detail" class="logline">
    <h1>Logs</h1>
    <p class="muted">Every container's output on this machine, the files of the folders below, and its agent's own log, sent to <button type="button" class="link" :title="(view.logline.ui === null ? 'Where Logline’s viewer is: the ui of logline in serviceman.json' : view.logline.ui)" @click="logline_open">Logline</button> from the moment it is switched on. Nothing from before that moment is sent.</p>
    <div class="card svc-status">
        <div class="row-of svc-state">
            <span class="pill" :class="stage.pill">{{ stage.text }}</span>
            <span class="muted">{{ stage.detail }}</span>
        </div>
        <p v-if="(view.logline.error !== null)" class="bad">last told, it failed: {{ view.logline.error }}</p>
        <div class="actions">
            <span class="seg">
                <button type="button" :class="{on: (view.logline.logs === 'off')}" :disabled="busy" @click="pick('off')">Off</button>
                <button type="button" :class="{on: (view.logline.logs === 'all')}" :disabled="busy" @click="pick('all')">All containers</button>
            </span>
            <template v-if="asking_off">
                <span>Lines written while it is off are never sent, not even after it is on again.</span>
                <button type="button" class="danger" :disabled="busy" @click="save('off')">Turn it off</button>
                <button type="button" @click="asking_off = false">Keep sending</button>
            </template>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </div>
        <dl v-if="(view.logline.logs === 'all')">
            <dt>Sends to</dt>
            <dd><code v-if="(view.logline.endpoint !== null)">{{ view.logline.endpoint }}</code><span v-else class="bad">nowhere — Logline's address is not set</span></dd>
            <dt>Since</dt>
            <dd>
                <template v-if="(view.logline.floor !== null)">{{ time_text(view.logline.floor) }} <span class="muted">· {{ ago(view.logline.floor) }} ago</span></template>
                <span v-else class="muted">the moment the machine is told</span>
            </dd>
            <dt>Token</dt>
            <dd>
                <template v-if="(view.logline.ips !== null)">works from {{ view.logline.ips.join(', ') }}<span v-if="(view.logline.issued_at !== null)" class="muted"> · issued {{ time_text(view.logline.issued_at) }}</span></template>
                <span v-else class="muted">not issued yet</span>
            </dd>
            <dt>Containers</dt>
            <dd>{{ (status === null || status.collecting === false ? '—' : status.containers + ' followed') }}</dd>
            <template v-if="(view.logline.dirs.length > 0)">
                <dt>Files</dt>
                <dd>{{ (status === null || status.collecting === false || status.files === undefined ? '—' : status.files + ' read, in ' + plural(view.logline.dirs.length, 'a folder', view.logline.dirs.length + ' folders')) }}</dd>
            </template>
        </dl>
    </div>
    <div v-if="(view.logline.logs === 'all')" class="card svc-status">
        <div class="row-of svc-state">
            <b>Folders</b>
            <span class="muted">files read besides the containers' output</span>
        </div>
        <template v-if="(dirs_editing === false)">
            <p v-if="(view.logline.dirs.length === 0)" class="muted">None. A folder here has every file in it read a line at a time, from the moment it is added — a folder, <code>/var/log/nginx</code>, or a folder and a pattern, <code>~/app/logs/*.log</code>.</p>
            <div v-else class="logline-dirs">
                <div v-for="dir of view.logline.dirs" :key="dir.path">
                    <code>{{ dir.path }}</code>
                    <span class="muted"> · service </span><code>{{ dir.service || dir_default(dir.path) }}</code>
                    <span v-if="dir_error(dir.path) !== null" class="bad"> · cannot be read: {{ dir_error(dir.path) }}</span>
                </div>
            </div>
            <div class="actions">
                <button type="button" @click="dirs_edit">{{ (view.logline.dirs.length === 0 ? 'Add a folder' : 'Change') }}</button>
            </div>
        </template>
        <div v-else class="form">
            <div class="grid">
                <template v-for="(row, i) of dirs_form" :key="row.key">
                    <label>{{ i === 0 ? 'Folders' : '' }}</label>
                    <div class="line">
                        <input v-model.trim="row.path" placeholder="/var/log/nginx/*.log" spellcheck="false">
                        <input v-model.trim="row.service" :placeholder="('service: ' + (dir_default(row.path) || 'the folder’s name'))" class="dir-service" spellcheck="false">
                        <button type="button" title="Stop reading this folder" aria-label="Stop reading this folder" @click="dirs_form.splice(i, 1)">×</button>
                    </div>
                </template>
                <label>{{ dirs_form.length === 0 ? 'Folders' : '' }}</label>
                <div>
                    <button type="button" @click="dirs_form.push({key: Math.random(), path: '', service: ''})">+ folder</button>
                    <p class="muted">A path from <code>/</code> or <code>~/</code> on this machine. Files already there are read from where they end now; new ones from their start. Compressed and hidden files are left alone.</p>
                </div>
            </div>
            <div class="actions">
                <button type="button" :disabled="saving" @click="dirs_save">Save</button>
                <button type="button" @click="dirs_editing = false">Cancel</button>
                <span :class="(form_bad ? 'bad' : 'muted')">{{ form_note }}</span>
            </div>
        </div>
    </div>
    <div v-if="(view.logline.logs === 'all')" class="logline-tiles">
        <div v-for="tile of tiles" :key="tile.label" class="card logline-tile">
            <span class="muted">{{ tile.label }}</span>
            <b :class="tile.kind">{{ tile.value }}</b>
            <span class="muted logline-note" :title="tile.note">{{ tile.note }}</span>
        </div>
    </div>
    <div class="card svc-status">
        <div class="row-of svc-state">
            <b>Where Logline is</b>
            <span class="muted">the same for every remote, set on the <button type="button" class="link" @click="$emit('logline')">Logline page</button></span>
        </div>
    </div>
</article>
`,
    props: ['view'],
    emits: ['logline'],
    data: function () {
        return {
            busy: false,
            note: '',
            bad: false,
            asking_off: false,
            now: Date.now(),
            timer: null,
            dirs_editing: false,
            dirs_form: [],
            saving: false,
            form_note: '',
            form_bad: false,
        };
    },
    computed: {
        status: function () {
            return this.view.logline.status;
        },
        // One word for where it stands, and a sentence for why
        stage: function () {
            return logline_stage(this.view);
        },
        tiles: function () {
            const status = this.status;
            const counting = ((status !== null) && status.collecting);
            return [
                {label: 'Sent', value: (counting ? thousands_text(status.sent.lines) : '—'), note: (counting ? `lines · ${format_bytes(status.sent.bytes)}` : 'lines'), kind: ''},
                {label: 'Batches', value: (counting ? thousands_text(status.sent.batches) : '—'), note: 'each stored whole', kind: ''},
                {label: 'Waiting here', value: (counting ? thousands_text(status.waiting.lines) : '—'), note: (counting ? `lines · ${format_bytes(status.waiting.bytes)}` : 'lines'), kind: ((counting && (status.waiting.lines > 0)) ? 'busy' : '')},
                {label: 'Oldest waiting', value: ((counting && (status.waiting.oldest !== null)) ? this.ago(status.waiting.oldest) : '—'), note: 'how far behind it is', kind: ''},
                {label: 'Last sent', value: ((counting && (status.last_sent_at !== null)) ? `${this.ago(status.last_sent_at)} ago` : '—'), note: ((counting && (status.last_answer !== null)) ? `Logline said: ${status.last_answer}` : 'nothing yet'), kind: ((counting && (status.last_answer !== null) && (status.last_answer !== 'ok')) ? 'bad' : '')},
            ];
        },
    },
    methods: {
        // Off is asked twice: what is written while it is off is never sent
        pick: function (logs) {
            if (logs === this.view.logline.logs) {
                this.asking_off = false;
                return;
            }
            if (logs === 'off') {
                this.asking_off = true;
                return;
            }
            this.save(logs);
        },
        save: async function (logs) {
            this.busy = true;
            this.asking_off = false;
            this.report('saving…', false);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/logs`, {method: 'PUT', body: JSON.stringify({logs})});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.report('', false);
            }
            catch {
                this.report('the answer never came back — the page says what landed within a second', true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        plural,
        dirs_edit: function () {
            this.dirs_form = this.view.logline.dirs.map(v => ({key: Math.random(), path: v.path, service: v.service || ''}));
            if (this.dirs_form.length === 0) {
                this.dirs_form.push({key: Math.random(), path: '', service: ''});
            }
            this.form_note = '';
            this.dirs_editing = true;
        },
        dirs_save: async function () {
            this.saving = true;
            this.form_note = 'saving…';
            this.form_bad = false;
            try {
                const dirs = this.dirs_form.filter(v => v.path !== '').map(v => ({path: v.path, service: v.service}));
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/logs`, {method: 'PUT', body: JSON.stringify({dirs})});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.form_note = outcome.error;
                    this.form_bad = true;
                    return;
                }
                this.form_note = '';
                this.dirs_editing = false;
            }
            catch {
                this.form_note = 'the answer never came back — the page says what landed within a second';
                this.form_bad = true;
            }
            finally {
                this.saving = false;
            }
        },
        // The service a folder's lines are about when none is named: the folder's own name
        dir_default: function (text) {
            const parts = String(text || '').replace(/\/+$/, '').split('/').filter(v => (v !== '') && (v !== '~'));
            const last = parts[parts.length - 1] || '';
            return (last.includes('*') ? parts[parts.length - 2] || '' : last);
        },
        // Why the machine cannot read a folder, as it last said; null when it can
        dir_error: function (text) {
            const status = this.status;
            if ((status === null) || (status.dir_errors === undefined) || (status.dir_errors[text] === undefined)) {
                return null;
            }
            return status.dir_errors[text];
        },
        // Logline's viewer in a tab of its own, following new lines as they come
        logline_open: function () {
            const ui = this.view.logline.ui;
            if (ui === null) {
                this.report('Logline’s viewer is not set — it is set on the Logline page', true);
                return;
            }
            // This machine's lines, not every machine's: the tab is about this one
            window.open(logline_link({ui}, 'remote', this.view.name), '_blank', 'noopener');
        },
        // "2026-09-26 0:41:07 EEST": the moment in this browser's own zone, and which zone
        time_text: function (iso) {
            return new Date(iso).toLocaleString('sv-SE', {timeZoneName: 'short'});
        },
        ago: function (iso) {
            return format_ms(Math.max(0, this.now - Date.parse(iso)));
        },
    },
    mounted: function () {
        // The ages on this page move on their own
        this.timer = setInterval(() => this.now = Date.now(), POLL_MS);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
};

// 18234 -> "18,234": a count, grouped so it reads at a glance
function thousands_text(count)
{
    return count.toLocaleString('en-US');
}

// The underline of the open tab, as one element for the whole row: when the pick changes it
// slides from where it was to where it belongs, instead of appearing there
const tabink = {
    template: `<span class="tabink" :class="{still}" :style="{transform: 'translate(' + left + 'px, ' + top + 'px)', width: width + 'px'}"/>`,
    // Anything that may move or resize the open tab goes in the mark, and a changed mark means
    // measure again
    props: ['mark'],
    data: function () {
        return {left: 0, top: 0, width: 0, still: true};
    },
    watch: {
        mark: function () {
            this.$nextTick(() => this.place());
        },
    },
    methods: {
        allow_slides: function () {
            this.still = false;
        },
        place: function () {
            const on = this.$el.parentElement.querySelector('.tab.on');
            if (on === null) {
                this.width = 0;
                return;
            }
            // Under the tab itself, on whichever row it is: a narrow page wraps the tabs
            this.left = on.offsetLeft;
            this.top = on.offsetTop + on.offsetHeight - 1;
            this.width = on.offsetWidth;
        },
    },
    mounted: function () {
        // A page opened anew draws the line under its tab at once; only a move after that
        // slides, rather than the line flying in from the corner
        this.place();
        requestAnimationFrame(() => requestAnimationFrame(this.allow_slides));
        window.addEventListener('resize', this.place);
        // The web fonts land after the first paint, and every tab is a little wider then
        document.fonts.ready.then(this.place);
    },
    unmounted: function () {
        window.removeEventListener('resize', this.place);
    },
};

// Which tabs a remote can show: a machine that is away has nothing to open, and an online
// machine needs no install command
function remote_tab_allowed(view, tab)
{
    if ((tab === 'shell') || (tab === 'files') || (tab === 'docker') || (tab === 'firewall') || (tab === 'processes') || (tab === 'disks') || (tab === 'packages')) {
        return view.phase === 'online';
    }
    if (tab === 'install') {
        return view.phase !== 'online';
    }
    return true;
}

// One remote as one page, the way a service is one: tabs above, the pick kept by the app so
// it follows from machine to machine
const remote_page = {
    template: `
<div id="page">
    <div class="crumbs">
        <button type="button" class="link" @click="$emit('list')">Remotes</button>
        <span class="muted">›</span>
        <span class="dot" :class="(view.phase === 'online' ? 'running' : 'failed')"/>
        <b>{{ view.title || view.name }}</b>
        <code v-if="(view.title && view.title !== view.name)" class="muted">{{ view.name }}</code>
        <span v-if="(agent_now !== null)" class="pill" :class="(agent_now ? 'running' : 'starting')" :title="(agent_now ? 'It runs the agent this host serves' : 'It runs an older agent than this host serves; Configure updates it')">{{ (agent_now ? 'agent up to date' : 'agent outdated') }}</span>
        <div class="acts crumb-acts">
            <button type="button" title="A new service, run on this machine" @click="$emit('create', view.name)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Add service
            </button>
        </div>
        <a v-if="(logline_url !== null)" class="crumb-logs" :href="logline_url" target="_blank" rel="noopener" title="This machine's lines in Logline, the last 24 hours">Logs in Logline ↗</a>
    </div>
    <div class="tabbar">
        <nav class="tabs">
            <button type="button" class="tab" :class="{on: (tab_now === 'overview')}" @click="$emit('tab', 'overview')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>
                Overview
            </button>
            <button type="button" class="tab" :class="{on: (tab_now === 'configure')}" @click="$emit('tab', 'configure')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/></svg>
                Configure
            </button>
            <button type="button" class="tab" :class="{on: (tab_now === 'settings')}" @click="$emit('tab', 'settings')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l4 4"/></svg>
                Settings
            </button>
            <button type="button" class="tab" :class="{on: (tab_now === 'logs')}" @click="$emit('tab', 'logs')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 11h11M4 16h16M4 21h8"/></svg>
                Logs
            </button>
            <button v-if="(view.phase === 'online')" type="button" class="tab" :class="{on: (tab_now === 'files')}" @click="$emit('tab', 'files')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>
                File Manager
            </button>
            <button v-if="(view.phase === 'online')" type="button" class="tab" :class="{on: (tab_now === 'docker')}" @click="$emit('tab', 'docker')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18v2a7 7 0 0 1-7 7H9a6 6 0 0 1-6-6z"/><path d="M6 9h3v3H6zM10 9h3v3h-3zM14 9h3v3h-3zM10 5h3v3h-3z"/></svg>
                Docker
            </button>
            <button v-if="(view.phase === 'online')" type="button" class="tab" :class="{on: (tab_now === 'firewall')}" @click="$emit('tab', 'firewall')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>
                Firewall
            </button>
            <button v-if="(view.phase === 'online')" type="button" class="tab" :class="{on: (tab_now === 'processes')}" @click="$emit('tab', 'processes')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M9 12h11M14 18h6"/><path d="M5 6v12h4"/></svg>
                Processes
            </button>
            <button v-if="(view.phase === 'online')" type="button" class="tab" :class="{on: (tab_now === 'disks')}" @click="$emit('tab', 'disks')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
                Disks
            </button>
            <button v-if="(view.phase === 'online')" type="button" class="tab" :class="{on: (tab_now === 'packages')}" @click="$emit('tab', 'packages')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>
                Packages
            </button>
            <button v-if="(view.phase === 'online')" type="button" class="tab" :class="{on: (tab_now === 'shell')}" @click="$emit('tab', 'shell')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7l5 5-5 5"/><path d="M13 17h6"/></svg>
                Shell
            </button>
            <button v-if="(view.phase !== 'online')" type="button" class="tab" :class="{on: (tab_now === 'install')}" @click="$emit('tab', 'install')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
                Install
            </button>
            <ink :mark="(view.name + ':' + tab_now)"/>
        </nav>
    </div>
    <!-- Walking between tabs keeps each pane as it stands: the folder a file manager is in,
         a form half filled, a shell mid-session. Another machine is another page, so its
         panes start fresh. -->
    <keep-alive :max="10">
    <remote-overview v-if="(tab_now === 'overview')" :view="view" :services="services" :served="served" :logline="logline" @select="$emit('select', $event)" @tab="$emit('tab', $event)"/>
    <remote-configure v-else-if="(tab_now === 'configure')" :key="('configure-' + view.name)" :view="view" :served="served"/>
    <remote-form v-else-if="(tab_now === 'settings' && original !== null)" :key="('settings-' + view.name + '-' + edit_key)" :original="original" @close="$emit('tab', 'overview')" @saved="$emit('saved', $event)" @service="$emit('service', $event)"/>
    <article v-else-if="(tab_now === 'settings')" id="detail"><p class="muted">reading the config…</p></article>
    <remote-logline v-else-if="(tab_now === 'logs')" :key="('logs-' + view.name)" :view="view" @logline="$emit('logline')"/>
    <remote-docker v-else-if="(tab_now === 'docker')" :key="('docker-' + view.name)" :view="view" :theme="theme"/>
    <remote-firewall v-else-if="(tab_now === 'firewall')" :key="('firewall-' + view.name)" :view="view"/>
    <remote-files v-else-if="(tab_now === 'files')" :key="('files-' + view.name)" :view="view" :remotes="remotes" :control="control" :theme="theme" :start="files_path" @path="$emit('files_path', $event)"/>
    <remote-processes v-else-if="(tab_now === 'processes')" :key="('processes-' + view.name)" :view="view"/>
    <remote-disks v-else-if="(tab_now === 'disks')" :key="('disks-' + view.name)" :view="view"/>
    <remote-packages v-else-if="(tab_now === 'packages')" :key="('packages-' + view.name)" :view="view"/>
    <remote-shell v-else-if="(tab_now === 'shell' && shell_able)" :key="('shell-' + view.name)" :view="view" :theme="theme" :terminal="terminal" :prefer="prefer" @terminal="$emit('terminal', $event)"/>
    <article v-else-if="(tab_now === 'shell')" id="detail">
        <h1>Shell</h1>
        <p class="muted">The agent on this machine is from before machine shells, so none can be opened yet.</p>
        <p class="muted">It updates itself within a minute or two of being connected. If it stays old, run <code>bin/update</code> in the agent's folder on that machine — <code>~/serviceman-agent</code>, or <code>/opt/serviceman-agent</code> where it was installed as root.</p>
    </article>
    <remote-install v-else-if="(tab_now === 'install')" :key="('install-' + view.name)" :view="view" :control="control"/>
    </keep-alive>
</div>
`,
    components: {ink: tabink, 'remote-configure': remote_configure, 'remote-docker': remote_docker, 'remote-firewall': remote_firewall, 'remote-files': remote_files, 'remote-form': remote_form, 'remote-install': remote_install, 'remote-logline': remote_logline, 'remote-overview': remote_overview, 'remote-disks': remote_disks, 'remote-packages': remote_packages, 'remote-processes': remote_processes, 'remote-shell': remote_shell},
    props: ['view', 'remotes', 'services', 'control', 'tab', 'theme', 'served', 'logline', 'terminal', 'prefer', 'files_path'],
    emits: ['create', 'files_path', 'list', 'logline', 'saved', 'select', 'service', 'tab'],
    data: function () {
        return {original: null, edit_key: 0};
    },
    computed: {
        tab_now: function () {
            return (remote_tab_allowed(this.view, this.tab) ? this.tab : 'overview');
        },
        agent_now: function () {
            return agent_current(this.view, this.served);
        },
        logline_url: function () {
            return logline_link(this.logline, 'remote', this.view.name);
        },
        // Whether the agent over there knows how to open one — an old agent gets a word about
        // updating instead of a terminal that cannot work
        shell_able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('machine_shell');
        },
        // The settings tab edits the config entry, which the status does not carry
        settings_name: function () {
            return ((this.tab_now === 'settings') ? this.view.name : '');
        },
    },
    watch: {
        settings_name: {
            immediate: true,
            handler: function (name) {
                this.original = null;
                if (name !== '') {
                    this.original_load(name);
                }
            },
        },
    },
    methods: {
        original_load: async function (name) {
            const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
            const found = (JSON.parse(loaded.text).remotes || []).find(v => v.name === name) || null;
            // The tab may have moved on while the config was coming; a late answer is nobody's
            if (name === this.settings_name) {
                this.original = found;
                this.edit_key++;
            }
        },
    },
};

// Which tabs a service can show: logs only for what serviceman drives, a shell only inside a
// running container. A tab that does not apply falls back to the overview — and the pick
// stays, so the next service that has the tab opens on it.
function tab_allowed(view, tab)
{
    if (tab === 'logs') {
        return view.type !== 'external';
    }
    if (tab === 'shell') {
        return (view.type === 'docker') && (view.phase === 'running');
    }
    // Settings are the cards of the overview now; an address that names the tab lands there
    return tab !== 'settings';
}

// One service as one page: tabs pick what is below, the actions stand to the right of them,
// and the tab picked here is the app's, so it follows from service to service
const service_page = {
    template: `
<div id="page">
    <div class="crumbs">
        <button type="button" class="link" @click="$emit('list')">Services</button>
        <template v-if="(place !== null)">
            <span class="muted">›</span>
            <button type="button" class="link" @click="$emit('remote', place.name)">{{ place.title }}</button>
        </template>
        <span class="muted">›</span>
        <span class="dot" :class="(view.doing === null ? view.phase : 'starting')"/>
        <b>{{ view.title || view.name }}</b>
        <code v-if="(view.title && view.title !== view.name)" class="muted">{{ view.name }}</code>
        <div class="acts crumb-acts">
            <template v-if="driven">
                <button type="button" :disabled="(waiting || view.phase === 'running')" @click="$emit('start', view)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M8 5.5l11 6.5-11 6.5z"/></svg>
                    Start
                </button>
                <button type="button" :disabled="(waiting || view.phase !== 'running')" @click="$emit('stop', view)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
                    Stop
                </button>
                <button type="button" :disabled="(waiting || view.phase !== 'running')" title="Stop it and start it again, without the wait in between" @click="$emit('restart', view)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 2.5v4.2h-4.2"/></svg>
                    Restart
                </button>
                <button v-if="(view.image !== null)" type="button" :disabled="waiting" title="Ask the registry for that image again. A tag is not a version — this is what fetches one that was pushed over it. What is running is made again from what comes down." @click="$emit('pull', view)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 11l5 5 5-5"/><path d="M4 20h16"/><path d="M17 7.5a5 5 0 0 0-9.6-1.2A3.6 3.6 0 0 0 8 13"/></svg>
                    {{ (view.doing === null ? 'Pull' : 'Pulling…') }}
                </button>
                <button v-if="(view.installs === true)" type="button" :disabled="waiting" title="Run the install line again in an empty folder, then start what came back. Storage and secrets stay." @click="$emit('update', view)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>
                    {{ (view.doing === null ? 'Fetch again' : 'Fetching…') }}
                </button>
            </template>
            <button type="button" title="A new service that starts from this one's settings" @click="$emit('clone', view)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15.5 4.5H6a1.5 1.5 0 0 0-1.5 1.5v9.5"/></svg>
                Clone
            </button>
            <span v-if="(waiting && view.doing === null)" class="muted">{{ view.phase }}…</span>
            <span v-if="(view.type === 'external')" class="muted">runs somewhere else — serviceman only answers for it</span>
        </div>
        <a v-if="(logline_url !== null)" class="crumb-logs" :href="logline_url" target="_blank" rel="noopener" title="This service's lines in Logline, the last 24 hours">Logs in Logline ↗</a>
    </div>
    <div class="tabbar">
        <nav class="tabs">
            <button type="button" class="tab" :class="{on: (tab_now === 'overview')}" @click="$emit('tab', 'overview')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>
                Overview
            </button>
            <button v-if="driven" type="button" class="tab" :class="{on: (tab_now === 'logs')}" @click="$emit('tab', 'logs')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 11h11M4 16h16M4 21h8"/></svg>
                Logs
            </button>
            <button v-if="(view.type === 'docker' && view.phase === 'running')" type="button" class="tab" :class="{on: (tab_now === 'shell')}" @click="$emit('tab', 'shell')">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7l5 5-5 5"/><path d="M13 17h6"/></svg>
                Shell
            </button>
            <ink :mark="(view.name + ':' + tab_now)"/>
        </nav>
    </div>
    <!-- Walking between tabs keeps each pane as it stands, the way a remote's page does -->
    <!-- The overview is how it stands, then what it is made of: one card per part, each
         edited in place -->
    <keep-alive :max="10">
    <service-form v-if="(tab_now === 'overview' && original !== null)" :key="('cards-' + view.name + '-' + edit_key)" :remotes="remotes" :names="names" :original="original" :port="port" :redir="view.redir" @saved="saved">
        <service-status :view="view" :busy="busy" :port="port" :remotes="remotes" @remote="$emit('remote', $event)"/>
        <service-doors :view="view" :remotes="remotes" :names="names"/>
    </service-form>
    <article v-else-if="(tab_now === 'overview')" id="detail" class="list svc">
        <service-status :view="view" :busy="busy" :port="port" :remotes="remotes" @remote="$emit('remote', $event)"/>
        <service-doors :view="view" :remotes="remotes" :names="names"/>
        <p class="muted">{{ original_state === 'none' ? 'This serviceman runs without a config file, so nothing about the service can be changed from here.' : 'reading the config…' }}</p>
    </article>
    <service-logs v-else-if="(tab_now === 'logs')" :key="('logs-' + view.name)" :view="view" :logline="logline"/>
    <service-shell v-else-if="(tab_now === 'shell')" :key="('shell-' + view.name)" :view="view" :theme="theme"/>
    </keep-alive>
</div>
`,
    components: {ink: tabink, 'service-doors': service_doors, 'service-form': service_form, 'service-logs': service_logs, 'service-shell': service_shell, 'service-status': service_status},
    props: ['view', 'busy', 'port', 'remotes', 'names', 'tab', 'theme', 'logline'],
    emits: ['clone', 'list', 'pull', 'remote', 'restart', 'saved', 'start', 'stop', 'tab', 'update'],
    data: function () {
        // original_state: reading, found, or none — a serviceman without a config file
        return {original: null, original_state: 'reading', edit_key: 0};
    },
    computed: {
        logline_url: function () {
            return logline_link(this.logline, 'service', this.view.name);
        },
        tab_now: function () {
            return (tab_allowed(this.view, this.tab) ? this.tab : 'overview');
        },
        driven: function () {
            return this.view.type !== 'external';
        },
        // The machine the breadcrumb goes through: the first one named, not a #tag
        place: function () {
            const name = this.view.remotes.find(v => v.startsWith('#') === false);
            const found = ((name === undefined) ? undefined : this.remotes.find(v => v.name === name));
            return ((found === undefined) ? null : {name: found.name, title: (found.title || found.name)});
        },
        waiting: function () {
            return (this.busy === true) || (this.view.doing !== null) || (this.view.phase === 'starting') || (this.view.phase === 'stopping');
        },
    },
    watch: {
        // The cards edit the config entry, which the status does not carry: read for every
        // service the page shows, and again after each save
        'view.name': {
            immediate: true,
            handler: function (name) {
                this.original = null;
                this.original_state = 'reading';
                this.original_load(name);
            },
        },
    },
    methods: {
        original_load: async function (name) {
            const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
            // A serviceman with no config file has no entry to edit; the page says so
            const found = ((typeof loaded.text === 'string') ? JSON.parse(loaded.text).services.find(v => v.name === name) || null : null);
            // The page may have moved on while the config was coming; a late answer is nobody's
            if (name === this.view.name) {
                this.original = found;
                this.original_state = ((found === null) ? 'none' : 'found');
                this.edit_key++;
            }
        },
        // A card saved: the app hears which service it was — a renamed one moves the page —
        // and the cards are read again from what landed in the file
        saved: function (name) {
            this.$emit('saved', name);
            if ((name !== null) && (name === this.view.name)) {
                this.original_load(name);
            }
        },
    },
};

// What the address says you are looking at. Service and remote names are [a-z0-9_-], so the
// only thing between the parts is the separator itself. ?remote= narrows a list to one machine.
function route_from_path(pathname, search)
{
    const remote = new URLSearchParams(search).get('remote');
    const parts = [];
    for (const part of pathname.split('/')) {
        if (part !== '') {
            parts.push(decodeURIComponent(part));
        }
    }
    if (parts.length === 0) {
        return {kind: 'home', name: '', tab: '', item: '', remote};
    }
    if (((parts[0] === 'services') || (parts[0] === 'remotes')) && (parts.length > 1)) {
        return {kind: parts[0], name: parts[1], tab: ((parts[2] === undefined) ? '' : parts[2]), item: ((parts[3] === undefined) ? '' : parts[3]), remote: null, path: new URLSearchParams(search).get('path')};
    }
    return {kind: parts[0], name: '', tab: '', item: '', remote};
}

const app = {
    template: `
<header>
    <button type="button" class="brand" title="The front page: every service" @click="home_show">serviceman</button>
    <button type="button" id="find" title="Find anything by any word: a service, a remote, an address, a folder" @click="find_show">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <span>Find a service, remote, address or folder</span>
        <kbd>Ctrl K</kbd>
    </button>
    <span class="muted" id="summary">{{ summary }}</span>
    <div v-if="(skins.length > 0)" id="skin-pick">
        <button type="button" title="How the page looks" @click="skin_menu = !skin_menu">
            {{ skin_title }}
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <button v-if="skin_menu" type="button" class="skin-back" @click="skin_menu = false"></button>
        <!-- A card is clicked, never dragged: a picture picked up by a quick second click starts a
             browser drag, and on some desktops that drag holds the pointer until the page is reloaded -->
        <div v-if="skin_menu" class="skin-menu" @dragstart.prevent>
            <button type="button" class="skin-card" :class="{on: (skin === '')}" @click="skin_choose('')">
                <img :src="('/cover-classic-' + theme + '.svg')" alt="" draggable="false">
                <span>Classic</span>
            </button>
            <button v-for="item of skins" :key="item.name" type="button" class="skin-card" :class="{on: (skin === item.name)}" @click="skin_choose(item.name)">
                <img v-if="item.cover" :src="('/skins/' + encodeURIComponent(item.name) + '/cover-' + theme + '.svg')" alt="" draggable="false">
                <span>{{ item.title }}</span>
            </button>
        </div>
    </div>
    <button type="button" id="theme" title="Light or dark" @click="theme_toggle">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/></svg>
    </button>
</header>
<!-- What is wrong, above everything else on every page: a row of its own under the header -->
<button v-if="(problems.length > 0)" type="button" id="problems-bar" :title="problems.map(v => v.subject).join('\\n')" @click="health_show">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/></svg>
    <b>{{ problems.length }} {{ (problems.length === 1) ? 'problem' : 'problems' }}</b>
    <span class="problems-first">{{ problems[0].subject }}<span v-if="(problems.length > 1)" class="muted"> and {{ problems.length - 1 }} more</span></span>
    <span class="problems-open">See them →</span>
</button>
<main v-if="(state !== null)">
    <!-- One row per kind of thing, never one per thing: the rail stays the same length however
         many services there are, and each row is always where it was -->
    <nav id="rail" ref="rail">
        <button type="button" class="row kind" :class="{on: (kind_now === 'health'), open: (kind_now === 'health')}" title="How everything is: machines, services, logs, forwards" @click="health_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l2.5-6 5 12 2.5-6h4"/></svg>
            <span class="name">Health</span>
            <span :class="health_tally.state" :title="health_tally.title">{{ health_tally.text }}</span>
        </button>
        <button type="button" class="row kind" :class="{on: (kind_now === 'services' && selected_name === null), open: (kind_now === 'services')}" @click="home_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/></svg>
            <span class="name">Services</span>
            <span class="muted">{{ state.services.length }}</span>
        </button>
        <!-- The open kind shows what is in it, one step in, under its own row -->
        <div v-if="(kind_now === 'services' && state.services.length > 0)" class="rail-tree">
            <button v-for="view of rail_services" :key="view.name" type="button" class="row" :class="{on: (view.name === selected_name)}" :title="view.name" @click="select(view)">
                <dot :phase="(view.doing === null ? view.phase : 'starting')"/>
                <span class="name">{{ view.title || view.name }}</span>
            </button>
        </div>
        <button type="button" class="row kind" :class="{on: (kind_now === 'remotes' && remote_name === null), open: (kind_now === 'remotes')}" @click="remotes_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
            <span class="name">Remotes</span>
            <span :class="(remotes_offline > 0 ? 'bad' : 'muted')">{{ remotes_offline > 0 ? remotes_offline + ' offline' : state.remotes.length }}</span>
        </button>
        <div v-if="(kind_now === 'remotes' && state.remotes.length > 0)" class="rail-tree">
            <button v-for="item of rail_remotes" :key="item.name" type="button" class="row" :class="{on: (item.name === remote_name)}" :title="item.name" @click="remote_select(item)">
                <dot :phase="(item.phase === 'online' ? 'running' : 'failed')"/>
                <span class="name">{{ item.title || item.name }}</span>
                <svg v-if="(agent_current(item, state.agent_built) === false)" class="agent-behind" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" aria-label="runs an older agent"><title>Runs an older agent than this host serves</title><path d="M12 19V5M6 11l6-6 6 6"/></svg>
            </button>
        </div>
        <button type="button" class="row kind" :class="{on: (kind_now === 'addresses'), open: (kind_now === 'addresses')}" @click="addresses_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>
            <span class="name">Addresses</span>
            <span class="muted">{{ addresses_count }}</span>
        </button>
        <div v-if="(kind_now === 'addresses' && rail_addresses.length > 0)" class="rail-tree">
            <button v-for="item of rail_addresses" :key="item.key" type="button" class="row" :title="('goes to ' + item.service)" @click="select_named(item.service)">
                <span class="name"><code>{{ item.address }}</code></span>
            </button>
        </div>
        <button type="button" class="row kind" :class="{on: (kind_now === 'doors'), open: (kind_now === 'doors')}" title="The public names machines' doors answer, and what stands in front of them" @click="networking_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/></svg>
            <span class="name">Doors</span>
            <span class="muted">{{ doors_count }}</span>
        </button>
        <button type="button" class="row kind" :class="{on: (kind_now === 'forwards'), open: (kind_now === 'forwards')}" title="A port or a socket of one machine, brought to another" @click="forwards_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="6" height="8" rx="1"/><rect x="16" y="8" width="6" height="8" rx="1"/><path d="M8 12h7M12 9l3 3-3 3"/></svg>
            <span class="name">Forwards</span>
            <span class="muted">{{ forwards_count }}</span>
        </button>
        <button type="button" class="row kind" :class="{on: (kind_now === 'storage'), open: (kind_now === 'storage')}" @click="volumes_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
            <span class="name">Storage</span>
            <span class="muted">{{ volumes_count }}</span>
        </button>
        <div v-if="(kind_now === 'storage' && rail_folders.length > 0)" class="rail-tree">
            <button v-for="item of rail_folders" :key="item.key" type="button" class="row" :title="item.title" @click="select_named(item.service)">
                <span class="name"><code>{{ item.name }}</code></span>
            </button>
        </div>
        <button type="button" class="row kind" :class="{on: (kind_now === 'secrets'), open: (kind_now === 'secrets')}" @click="secrets_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>
            <span class="name">Secrets</span>
            <span class="muted">{{ secrets_count }}</span>
        </button>
        <div v-if="(kind_now === 'secrets' && secret_names.length > 0)" class="rail-tree">
            <button v-for="name of rail_secrets" :key="name" type="button" class="row" @click="secrets_show">
                <span class="name"><code>{{ name }}</code></span>
            </button>
        </div>
        <button type="button" class="row kind" :class="{on: (kind_now === 'tokens'), open: (kind_now === 'tokens')}" title="Who else may read this serviceman: a token for each agent, the machines it sees" @click="tokens_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h.01M11 12h.01M15 12h2"/></svg>
            <span class="name">Tokens</span>
        </button>
        <button type="button" class="row kind" :class="{on: (kind_now === 'logline'), open: (kind_now === 'logline')}" title="Where every line of every machine flows" @click="logline_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/><path d="M17 15v6M14.5 18.5L17 21l2.5-2.5"/></svg>
            <span class="name">Logline</span>
            <span class="muted" :title="(logline_count + ' of ' + state.remotes.length + ' remotes send their logs')">{{ state.logline === null || state.logline === undefined ? 'not set' : logline_count + ' sending' }}</span>
        </button>
        <button type="button" class="row kind" :class="{on: (kind_now === 'authwall'), open: (kind_now === 'authwall')}" title="How visitors sign in: the wall a door asks first" @click="authwall_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>
            <span class="name">Authwall</span>
            <span class="muted" :title="(guarded_count + ' door names behind a wall')">{{ guarded_count }}</span>
        </button>
        <button type="button" class="row kind" :class="{on: (kind_now === 'load-tests'), open: (kind_now === 'load-tests')}" title="k6 sent at a service: how it holds up under many users" @click="load_tests_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><path d="M4 20h16"/></svg>
            <span class="name">Load tests</span>
            <span class="muted">{{ (state.load_tests === undefined) ? 0 : state.load_tests.length }}</span>
        </button>
        <button type="button" class="row kind" :class="{on: (kind_now === 'map'), open: (kind_now === 'map')}" @click="map_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="6" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7.2 6.5c5 .5 5 4.5 9.6 5.2M7.2 17.5c5-.5 5-4.5 9.6-5.2"/></svg>
            <span class="name">Map</span>
        </button>
        <div class="rail-gap"/>
        <button type="button" class="row foot" :class="{on: editor_open}" @click="editor_show">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l4 4"/></svg>
            <span class="name">Config</span>
        </button>
    </nav>
    <section>
        <config-editor v-if="editor_open" :theme="theme" @close="editor_open = false" @saved="poll"/>
        <volumes-pane v-else-if="volumes_open" :state="state" :remote="list_remote" @only="list_remote = $event" @remote="remote_select_named" @select="select_named"/>
        <secrets-form v-else-if="secrets_open"/>
        <tokens-form v-else-if="tokens_open"/>
        <networking-pane v-else-if="networking_open" :key="networking_key" :state="state"/>
        <article v-else-if="forwards_open" id="detail" class="form"><forwards-section :state="state"/></article>
        <health-pane v-else-if="health_open" :state="state" @remote="remote_select_named" @select="select_named"/>
        <logline-pane v-else-if="logline_open" :state="state" @remote="remote_logs_show" @select="select_named"/>
        <authwall-pane v-else-if="authwall_open" :state="state" @create="create" @doors="networking_show" @select="select_named"/>
        <load-tests-pane v-else-if="load_tests_open" :state="state" @remote="remote_select_named" @select="select_named"/>
        <map-pane v-else-if="map_open" :state="state" @remote="remote_select_named" @select="select_named"/>
        <addresses-pane v-else-if="addresses_open" :state="state" :remote="list_remote" @doors="networking_show" @only="list_remote = $event" @select="select_named"/>
        <remotes-pane v-else-if="remotes_open" :state="state" @create="remote_new" @disks="remote_disks_show" @doors="addresses_of_remote" @folders="volumes_of_remote" @join="join_open" @select="remote_select_named" @services="services_of_remote"/>
        <join-form v-else-if="join_form_open" :key="join_key" :join="join_original" @close="join_form_open = false" @saved="poll"/>
        <remote-form v-else-if="remote_form_open" :key="remote_form_key" :original="null" @close="remote_form_open = false" @saved="remote_saved"/>
        <service-form v-else-if="form_open" :key="form_key" :remotes="state.remotes" :names="state.services.map(v => v.name)" :original="null" :source="form_source" :remote="form_remote" :control="state.control" :port="state.listen.port" :redir="null" @close="form_open = false" @saved="form_saved"/>
        <remote-page v-else-if="(selected_remote !== null)" :key="(selected_remote.name + '-' + remote_key)" :view="selected_remote" :remotes="state.remotes" :services="remote_services" :control="state.control" :tab="remote_tab" :theme="theme" :served="(state.agent_built === undefined ? null : state.agent_built)" :logline="(state.logline === undefined ? null : state.logline)" :terminal="remote_terminal_now" :prefer="terminal_last" :files_path="remote_files_paths[selected_remote.name]" @files_path="remote_files_paths[selected_remote.name] = $event" @create="create" @list="remotes_show" @logline="logline_show" @tab="remote_tab_pick" @terminal="remote_terminal_pick" @saved="remote_saved" @select="select" @service="service_settings"/>
        <service-page v-else-if="(selected !== null)" :view="selected" :logline="(state.logline === undefined ? null : state.logline)" :busy="busy[selected.name]" :port="state.listen.port" :remotes="state.remotes" :names="state.services.map(v => v.name)" :tab="service_tab" :theme="theme" @list="home_show" @tab="tab_pick" @clone="clone" @pull="pull" @remote="remote_select_named" @restart="restart" @saved="form_saved" @start="start" @stop="stop" @update="update"/>
        <services-pane v-else :state="state" :remote="list_remote" @create="create" @only="list_remote = $event" @select="select_named"/>
    </section>
    <find-palette v-if="find_open" :state="state" @close="find_open = false" @pick="find_pick"/>
</main>
`,
    components: {'addresses-pane': addresses_pane, 'authwall-pane': authwall_pane, 'config-editor': config_editor, 'find-palette': find_palette, 'forwards-section': forwards_section, 'health-pane': health_pane, 'join-form': join_form, 'load-tests-pane': load_tests_pane, 'logline-pane': logline_pane, 'map-pane': map_pane, 'networking-pane': networking_pane, 'remote-form': remote_form, 'remote-page': remote_page, 'remotes-pane': remotes_pane, 'secrets-form': secrets_form, 'service-form': service_form, 'service-page': service_page, 'services-pane': services_pane, 'tokens-form': tokens_form, 'volumes-pane': volumes_pane, dot},
    data: function () {
        return {
            state: null,
            selected_name: null,
            remote_name: null,
            busy: {},
            theme: document.documentElement.dataset.theme,
            skin: (localStorage.getItem('serviceman.skin') || ''),
            skins: [],
            skin_menu: false,
            editor_open: false,
            form_open: false,
            // A service the new-service form starts from — the Clone button fills it
            form_source: null,
            form_remote: null,
            remote_form_open: false,
            // The tab of the remote page, kept the same way service_tab is
            remote_tab: 'overview',
            // The folder each machine's File Manager shows, by machine: in the address, so a reload
            // and a link come back to it
            remote_files_paths: {},
            // The terminal last open in each machine's Shell tab, by machine; and the one last open
            // on any, which another machine opens too when it has one of that name
            remote_terminals: {},
            terminal_last: null,
            // The next address replaces the current one in the history instead of adding a step
            route_replace: false,
            // Bumped on every click in the rail, so the pane is built again and its fields
            // start from what serviceman knows — even when the same machine is picked twice
            remote_key: 0,
            // The same, for the two forms: opening one twice must not show what the last one
            // was left holding
            form_key: 0,
            remote_form_key: 0,
            join_form_open: false,
            secrets_open: false,
            tokens_open: false,
            logline_open: false,
            health_open: false,
            authwall_open: false,
            load_tests_open: false,
            secrets_count: '',
            volumes_open: false,
            volumes_count: '',
            networking_open: false,
            forwards_open: false,
            networking_key: 0,
            remotes_open: false,
            addresses_open: false,
            map_open: false,
            // The one machine Services, Storage or Addresses is narrowed to, from its card
            list_remote: null,
            // What the rail's Storage and Secrets rows hold, read with their counts
            volumes: [],
            secret_names: [],
            // The Ctrl K box, over whatever is open
            find_open: false,

            join_original: null,
            join_key: 0,
            // The tab of the service page. It is the app's, not the page's, so the tab picked
            // on one service is the tab the next one opens on.
            service_tab: 'overview',
            // The first address the page writes replaces the one it was opened on, so landing
            // on / and being sent to the first service is not a step to go back through
            routed: false,
            // Whether the name the address asked for has been looked for in what serviceman
            // knows. A name that is not there falls back to the first service, once.
            route_checked: false,
            answering: true,
        };
    },
    computed: {
        // What is wrong now, as the last look found it (problems_check), the oldest first
        problems: function () {
            return (((this.state === null) || (this.state.problems === undefined)) ? [] : this.state.problems);
        },
        // The Health row's word: what is wrong, else what to look at, else that all is well
        health_tally: function () {
            const counts = (((this.state === null) || (this.state.health === undefined)) ? null : this.state.health.counts);
            const warn = ((counts === null) ? 0 : counts.warn);
            if (this.problems.length > 0) {
                return {state: 'bad', text: `${this.problems.length} ${(this.problems.length === 1) ? 'problem' : 'problems'}`, title: this.problems.map(v => v.subject).join('\n')};
            }
            if (warn > 0) {
                return {state: 'warn', text: `${warn} to look at`, title: `${warn} ${(warn === 1) ? 'thing works' : 'things work'}, but ${(warn === 1) ? 'asks' : 'ask'} for a look`};
            }
            if ((counts === null) || (counts.ok === 0)) {
                return {state: 'muted', text: '', title: 'Nothing set up yet'};
            }
            return {state: 'muted', text: 'all well', title: 'Nothing is wrong that serviceman can see'};
        },
        summary: function () {
            if (this.answering === false) {
                return 'serviceman is not answering';
            }
            if (this.state === null) {
                return 'reading…';
            }
            const running = this.state.services.filter(v => v.phase === 'running').length;
            const count = this.state.services.length;
            const items = [`${count} ${plural(count, 'service', 'services')}`, `${running} up`];
            if (this.state.remotes.length > 1) {
                items.push(`${this.state.remotes.filter(v => v.phase === 'online').length}/${this.state.remotes.length} remotes online`);
            }
            items.push(`serviceman up ${format_ms(this.state.now - this.state.started_at)}`);
            return items.join(' · ');
        },
        selected: function () {
            if (this.state === null) {
                return null;
            }
            return this.state.services.find(v => v.name === this.selected_name) || null;
        },
        // The address for what is open now. The panes are answered in the order they cover each
        // other on the page, which is the order the template asks about them in.
        route: function () {
            if (this.editor_open) {
                return '/config';
            }
            const only = ((this.list_remote === null) ? '' : `?remote=${encodeURIComponent(this.list_remote)}`);
            if (this.volumes_open) {
                return `/storage${only}`;
            }
            if (this.secrets_open) {
                return '/secrets';
            }
            if (this.tokens_open) {
                return '/tokens';
            }
            if (this.networking_open) {
                return '/networking';
            }
            if (this.forwards_open) {
                return '/forwards';
            }
            if (this.logline_open) {
                return '/logline';
            }
            if (this.health_open) {
                return '/health';
            }
            if (this.authwall_open) {
                return '/authwall';
            }
            if (this.load_tests_open) {
                return '/load-tests';
            }
            if (this.addresses_open) {
                return `/addresses${only}`;
            }
            if (this.map_open) {
                return '/map';
            }
            if (this.remotes_open) {
                return '/remotes';
            }
            if (this.join_form_open) {
                return '/join';
            }
            if (this.remote_form_open) {
                return '/remotes/new';
            }
            if (this.form_open) {
                return '/services/new';
            }
            if (this.selected_name !== null) {
                const tail = ((this.service_tab_now === 'overview') ? '' : `/${this.service_tab_now}`);
                return `/services/${encodeURIComponent(this.selected_name)}${tail}`;
            }
            if (this.remote_name !== null) {
                const tail = ((this.remote_tab_now === 'overview') ? '' : `/${this.remote_tab_now}`);
                const item = (((this.remote_tab_now === 'shell') && (this.remote_terminal_now !== null)) ? `/${encodeURIComponent(this.remote_terminal_now)}` : '');
                const folder = this.remote_files_paths[this.remote_name];
                const query = (((this.remote_tab_now === 'files') && (folder !== undefined)) ? `?path=${encodeURIComponent(folder)}` : '');
                return `/remotes/${encodeURIComponent(this.remote_name)}${tail}${item}${query}`;
            }
            return ((only === '') ? '/' : `/services${only}`);
        },
        // The row of the rail that holds what is open: a service page is under Services, the
        // door rules under Addresses, a machine and its forms under Remotes
        kind_now: function () {
            if (this.editor_open) {
                return 'config';
            }
            if (this.volumes_open) {
                return 'storage';
            }
            if (this.secrets_open) {
                return 'secrets';
            }
            if (this.tokens_open) {
                return 'tokens';
            }
            if (this.networking_open) {
                return 'doors';
            }
            if (this.forwards_open) {
                return 'forwards';
            }
            if (this.logline_open) {
                return 'logline';
            }
            if (this.health_open) {
                return 'health';
            }
            if (this.authwall_open) {
                return 'authwall';
            }
            if (this.load_tests_open) {
                return 'load-tests';
            }
            if (this.addresses_open) {
                return 'addresses';
            }
            if (this.map_open) {
                return 'map';
            }
            if (this.remotes_open || this.join_form_open || this.remote_form_open || (this.remote_name !== null)) {
                return 'remotes';
            }
            return 'services';
        },
        // The rail's trees read in the order of the names they show: title where there is one,
        // numbers as numbers, so speedtest/phone comes before speedtest/server and item2 before item10
        rail_services: function () {
            return this.state.services.slice().sort((a, b) => rail_compare(a.title || a.name, b.title || b.name));
        },
        // Every name a machine's door answers, on every machine
        // Machines whose lines go to Logline
        logline_count: function () {
            return this.state.remotes.filter(v => v.logline.logs === 'all').length;
        },
        // Door names with a wall in front of them
        guarded_count: function () {
            return this.state.remotes.reduce((sum, remote) => sum + Object.values((remote.inbound === undefined) ? {} : remote.inbound).filter(vv => (typeof vv === 'object') && (vv.auth !== undefined)).length, 0);
        },
        forwards_count: function () {
            return ((this.state.forwards === undefined) ? 0 : this.state.forwards.length);
        },
        doors_count: function () {
            return this.state.remotes.reduce((sum, remote) => sum + Object.keys((remote.inbound === undefined) ? {} : remote.inbound).length, 0);
        },
        rail_remotes: function () {
            return this.state.remotes.slice().sort((a, b) => rail_compare(a.title || a.name, b.title || b.name));
        },
        rail_secrets: function () {
            return this.secret_names.slice().sort(rail_compare);
        },
        // The addresses under the rail's Addresses row, by name; each opens the service it reaches
        rail_addresses: function () {
            const out = [];
            for (const service of this.state.services) {
                for (const host of service.publish.hosts) {
                    out.push({key: `${service.name} ${host}`, address: host, service: service.name});
                }
            }
            for (const remote of this.state.remotes) {
                const rule_by_host = ((remote.inbound === undefined) ? {} : remote.inbound);
                for (const host of Object.keys(rule_by_host)) {
                    out.push({key: `${remote.name} ${host}`, address: host, service: rule_by_host[host].service});
                }
            }
            out.sort((a, b) => rail_compare(a.address, b.address));
            return out;
        },
        // The folders under Storage; each opens the service that keeps it
        rail_folders: function () {
            const out = [];
            for (const item of this.volumes) {
                if (item.used_by.length === 0) {
                    continue;
                }
                out.push({key: `${item.machine}/${item.name}`, name: item.name, service: item.used_by[0].service, title: `on ${item.machine} · kept for ${item.used_by.map(v => v.service).join(', ')}`});
            }
            out.sort((a, b) => rail_compare(a.name, b.name));
            return out;
        },
        // The item picked in the rail's tree, so it can be brought into view when it is not.
        // The rail is drawn with the first status, so that counts as a change too.
        rail_picked: function () {
            return `${(this.state === null) ? '' : 'drawn'} ${this.kind_now} ${this.selected_name} ${this.remote_name}`;
        },
        remotes_offline: function () {
            return this.state.remotes.filter(v => v.phase !== 'online').length;
        },
        // Every name a request arrives on: what the services publish and what the doors carry in
        addresses_count: function () {
            let out = 0;
            for (const service of this.state.services) {
                out += service.publish.hosts.length;
            }
            for (const remote of this.state.remotes) {
                out += Object.keys((remote.inbound === undefined) ? {} : remote.inbound).length;
            }
            return out;
        },
        skin_title: function () {
            const found = this.skins.find(v => v.name === this.skin);
            return ((found === undefined) ? 'Classic' : found.title);
        },
        // The tab the page can actually show for the picked service — the address says this
        // one, not the remembered wish
        service_tab_now: function () {
            if (this.selected === null) {
                return 'overview';
            }
            return (tab_allowed(this.selected, this.service_tab) ? this.service_tab : 'overview');
        },
        remote_tab_now: function () {
            if (this.selected_remote === null) {
                return 'overview';
            }
            return (remote_tab_allowed(this.selected_remote, this.remote_tab) ? this.remote_tab : 'overview');
        },
        // The terminal named for the remote open now; one picked on another machine is not its
        remote_terminal_now: function () {
            if ((this.remote_name === null) || (this.remote_terminals[this.remote_name] === undefined)) {
                return null;
            }
            return this.remote_terminals[this.remote_name];
        },
        selected_remote: function () {
            if (this.state === null) {
                return null;
            }
            return this.state.remotes.find(v => v.name === this.remote_name) || null;
        },
        remote_services: function () {
            if (this.selected_remote === null) {
                return [];
            }
            // A service names a machine, or a kind of machine: #gpu is every machine with the tag
            const view = this.selected_remote;
            return this.state.services.filter(v => v.remotes.some(vv => (vv.startsWith('#') ? view.tags.includes(vv.slice(1)) : vv === view.name)));
        },
    },
    watch: {
        // A picked item that is out of the rail's view is scrolled to the middle of it; one that
        // is in view stays where it is, so the rail does not jump under the pointer
        rail_picked: function () {
            const self = this;
            this.$nextTick(function () {
                const rail = self.$refs.rail;
                const on = ((rail === undefined) ? null : rail.querySelector('.rail-tree .row.on'));
                if (on === null) {
                    return;
                }
                const box = rail.getBoundingClientRect();
                const row = on.getBoundingClientRect();
                if ((row.top < box.top) || (row.bottom > box.bottom)) {
                    on.scrollIntoView({block: 'center'});
                }
            });
        },
        // The address follows what is open. It is written here rather than at each of the
        // fourteen places that open something, and it is only ever a mirror of them: nothing
        // reads it back except a reload, the back button, and a link somebody was sent.
        // Until the first status is in, the page cannot tell which tabs a machine has and would
        // write its overview over the address it was opened on.
        route: function (path) {
            if (this.state === null) {
                return;
            }
            if (path === window.location.pathname + window.location.search) {
                this.routed = true;
                this.route_replace = false;
                return;
            }
            if (this.routed && (this.route_replace === false)) {
                window.history.pushState(null, '', path);
                return;
            }
            this.routed = true;
            this.route_replace = false;
            window.history.replaceState(null, '', path);
        },
    },
    methods: {
        phase_short,
        // What the rail says on the right of a row
        rail_text: function (view) {
            return phase_short(view);
        },
        // A fresh link has no number yet, so it is not given one
        latency_text: function (view) {
            if (view.phase !== 'online') {
                return 'offline';
            }
            return ((view.latency_ms === null) ? 'measuring…' : `${view.latency_ms}ms`);
        },
        tick: async function () {
            await this.poll();
            setTimeout(() => this.tick(), POLL_MS);
        },
        // Opens what the address names. Nothing here asks serviceman for anything: the panes
        // that need something fetch it themselves, which is why this can run before the first
        // status has come back.
        route_open: function (route) {
            this.panes_close();
            this.list_remote = route.remote;
            if (route.kind === 'home') {
                this.selected_name = null;
                this.remote_name = null;
                return;
            }
            if (route.kind === 'services') {
                if (route.name === '') {
                    this.selected_name = null;
                    this.remote_name = null;
                    return;
                }
                if (route.name === 'new') {
                    this.create();
                    return;
                }
                this.selected_name = route.name;
                this.remote_name = null;
                this.service_tab = (['settings', 'logs', 'shell'].includes(route.tab) ? route.tab : 'overview');
                return;
            }
            if (route.kind === 'remotes') {
                if (route.name === '') {
                    this.remotes_open = true;
                    return;
                }
                if (route.name === 'new') {
                    this.remote_new();
                    return;
                }
                this.remote_name = route.name;
                if ((route.path !== null) && (route.path !== undefined)) {
                    this.remote_files_paths[route.name] = route.path;
                }
                this.selected_name = null;
                this.remote_key++;
                // The Ports tab is part of Firewall now; an address from before still opens it
                const tab = ((route.tab === 'ports') ? 'firewall' : route.tab);
                this.remote_tab = (['configure', 'files', 'docker', 'firewall', 'logs', 'processes', 'disks', 'packages', 'settings', 'shell', 'install'].includes(tab) ? tab : 'overview');
                if ((route.tab === 'shell') && (route.item !== '')) {
                    this.remote_terminals = Object.assign({}, this.remote_terminals, {[route.name]: route.item});
                    this.terminal_last = route.item;
                }
                return;
            }
            if (route.kind === 'config') {
                this.editor_open = true;
                return;
            }
            if (route.kind === 'storage') {
                this.volumes_open = true;
                return;
            }
            if (route.kind === 'secrets') {
                this.secrets_open = true;
                return;
            }
            if (route.kind === 'tokens') {
                this.tokens_open = true;
                return;
            }
            if (route.kind === 'networking') {
                this.networking_open = true;
                return;
            }
            if (route.kind === 'forwards') {
                this.forwards_open = true;
                return;
            }
            if (route.kind === 'logline') {
                this.logline_open = true;
                return;
            }
            // The Problems page became a part of Health: an old address still finds them
            if ((route.kind === 'health') || (route.kind === 'problems')) {
                this.health_open = true;
                return;
            }
            if (route.kind === 'authwall') {
                this.authwall_open = true;
                return;
            }
            if (route.kind === 'load-tests') {
                this.load_tests_open = true;
                return;
            }
            if (route.kind === 'addresses') {
                this.addresses_open = true;
                return;
            }
            if (route.kind === 'map') {
                this.map_open = true;
                return;
            }

            if (route.kind === 'join') {
                this.join_open();
            }
        },
        poll: async function () {
            try {
                const answer = await fetch('/api/v1/status', {cache: 'no-store'});
                // Signed out, or the owner's token changed: the page itself asks for it again
                if (answer.status === 401) {
                    window.location.reload();
                    return;
                }
                const loaded = await answer.json();
                if (Array.isArray(loaded.services) === false) {
                    throw new Error('the answer carries no services');
                }
                this.state = loaded;
                this.answering = true;
                this.secrets_count_read();
                this.volumes_count_read();
                this.route_settle();
            }
            catch {
                this.answering = false;
            }
        },
        // Nothing picked is the front page. A name the address asked for that serviceman does
        // not have goes there too, but only the once — a service being renamed under an open
        // form is not a reason to jump somewhere else.
        route_settle: function () {
            if (this.route_checked) {
                return;
            }
            this.route_checked = true;
            // What was asked for is settled below, and that settling replaces the address it
            // came from. Everything after it is a step of the visitor's own, which the back
            // button must be able to take — so pushing begins once this has flushed.
            const self = this;
            this.$nextTick(function () {
                self.routed = true;
            });
            if ((this.selected_name === null) && (this.remote_name === null)) {
                return;
            }
            const known = ((this.selected_name === null)
                ? this.state.remotes.some(v => v.name === this.remote_name)
                : this.state.services.some(v => v.name === this.selected_name));
            if (known === false) {
                this.home_show();
            }
        },
        // The join block holds a token, so it is read from the config and not from the status,
        // which every page on this machine may ask for
        volumes_show: function () {
            this.panes_close();
            this.volumes_open = true;
        },
        select_named: function (name) {
            const found = this.state.services.find(v => v.name === name);
            if (found !== undefined) {
                this.select(found);
            }
        },
        volumes_count_read: async function () {
            try {
                const answer = await fetch('/api/v1/volumes', {cache: 'no-store'});
                const body = await answer.json();
                this.volumes_count = ((body.volumes.length === 0) ? 'none' : String(body.volumes.length));
                this.volumes = body.volumes;
            }
            catch {
                this.volumes_count = '';
                this.volumes = [];
            }
        },
        secrets_show: function () {
            this.panes_close();
            this.secrets_open = true;
        },
        tokens_show: function () {
            this.panes_close();
            this.tokens_open = true;
        },
        logline_show: function () {
            this.panes_close();
            this.logline_open = true;
        },
        health_show: function () {
            this.panes_close();
            this.health_open = true;
        },
        authwall_show: function () {
            this.panes_close();
            this.authwall_open = true;
        },
        load_tests_show: function () {
            this.panes_close();
            this.load_tests_open = true;
        },
        // A remote's row on the Logline page: its Logs tab
        remote_logs_show: function (name) {
            this.remote_tab = 'logs';
            this.remote_select_named(name);
        },
        networking_show: function () {
            this.panes_close();
            this.networking_key++;
            this.networking_open = true;
        },
        forwards_show: function () {
            this.panes_close();
            this.forwards_open = true;
        },
        remotes_show: function () {
            this.panes_close();
            this.remote_name = null;
            this.selected_name = null;
            this.remotes_open = true;
        },
        addresses_show: function () {
            this.panes_close();
            this.addresses_open = true;
        },
        map_show: function () {
            this.panes_close();
            this.map_open = true;
        },
        // The Disk line of a machine's card: its Disks tab
        remote_disks_show: function (name) {
            this.remote_tab = 'disks';
            this.remote_select_named(name);
        },
        // A count on a machine's card: the list of that kind, holding only what the machine carries
        services_of_remote: function (name) {
            this.home_show();
            this.list_remote = name;
        },
        volumes_of_remote: function (name) {
            this.volumes_show();
            this.list_remote = name;
        },
        addresses_of_remote: function (name) {
            this.addresses_show();
            this.list_remote = name;
        },
        find_show: function () {
            this.find_open = true;
        },
        // Ctrl K from anywhere, and / from anywhere that is not taking text
        find_key: function (event) {
            if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k')) {
                event.preventDefault();
                this.find_open = (this.state !== null);
                return;
            }
            const target = event.target;
            const typing = (target.closest('input, textarea, select, [contenteditable], .ace_editor, .xterm') !== null);
            if ((event.key === '/') && (typing === false) && (event.ctrlKey === false) && (event.metaKey === false) && (event.altKey === false)) {
                event.preventDefault();
                this.find_open = (this.state !== null);
            }
        },
        find_pick: function (target) {
            this.find_open = false;
            if (target.kind === 'remote') {
                this.remote_select_named(target.name);
                return;
            }
            if (target.kind === 'storage') {
                this.volumes_show();
                return;
            }
            this.select_named(target.name);
        },
        // The front page: nothing picked, nothing open — every service under its machine
        home_show: function () {
            this.panes_close();
            this.selected_name = null;
            this.remote_name = null;
        },
        secrets_count_read: async function () {
            try {
                const answer = await fetch('/api/v1/secrets', {cache: 'no-store'});
                const body = await answer.json();
                this.secrets_count = ((body.secrets.length === 0) ? 'none' : String(body.secrets.length));
                this.secret_names = body.secrets.map(v => v.name);
            }
            catch {
                this.secrets_count = '';
                this.secret_names = [];
            }
        },
        join_open: async function () {
            const loaded = await config_read();
            this.panes_close();
            this.join_original = (JSON.parse(loaded.text).join || null);
            this.join_key++;
            this.join_form_open = true;
            this.secrets_open = false;
        },
        // One page at a time: whatever is open closes before the next one opens. The service
        // tab is not a pane — it stays picked across all of this.
        panes_close: function () {
            this.editor_open = false;
            this.join_form_open = false;
            this.secrets_open = false;
            this.tokens_open = false;
            this.volumes_open = false;
            this.form_open = false;
            this.remote_form_open = false;
            this.networking_open = false;
            this.forwards_open = false;
            this.logline_open = false;
            this.health_open = false;
            this.authwall_open = false;
            this.load_tests_open = false;
            this.remotes_open = false;
            this.addresses_open = false;
            this.map_open = false;
            this.list_remote = null;
        },
        tab_pick: function (tab) {
            this.service_tab = tab;
        },
        remote_tab_pick: function (tab) {
            this.remote_tab = tab;
        },
        // `replace` is a terminal the Shell tab opened by itself, which is no step to go back to
        remote_terminal_pick: function (event) {
            this.route_replace = event.replace;
            const terminals = Object.assign({}, this.remote_terminals);
            if (event.name === null) {
                delete terminals[this.remote_name];
            }
            else {
                terminals[this.remote_name] = event.name;
                this.terminal_last = event.name;
            }
            this.remote_terminals = terminals;
        },
        // A service that has to be told where it runs before its machine can go: opened where
        // that is said, which is its settings
        service_settings: function (name) {
            this.service_tab = 'settings';
            this.select_named(name);
        },
        editor_show: function () {
            this.panes_close();
            this.editor_open = true;
        },
        select: function (view) {
            this.panes_close();
            this.selected_name = view.name;
            this.remote_name = null;
            this.remote_key++;
        },
        remote_select_named: function (name) {
            const found = this.state.remotes.find(v => v.name === name);
            if (found !== undefined) {
                this.remote_select(found);
            }
        },
        agent_current,
        remote_select: function (view) {
            this.panes_close();
            this.remote_name = view.name;
            this.selected_name = null;
            this.remote_key++;
        },
        remote_new: function () {
            this.panes_close();
            this.remote_form_key++;
            this.remote_form_open = true;
        },
        remote_saved: async function (name) {
            await this.poll();
            if (name !== null) {
                this.remote_name = name;
                this.selected_name = null;
            }
        },
        // From a machine's page the new service runs on that machine
        create: function (remote) {
            this.panes_close();
            this.form_source = null;
            this.form_remote = ((remote === undefined) ? null : remote);
            this.form_key++;
            this.form_open = true;
        },
        clone: async function (view) {
            const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
            const config = JSON.parse(loaded.text);
            this.form_source = config.services.find(v => v.name === view.name) || null;
            this.form_remote = null;
            this.form_key++;
            this.form_open = (this.form_source !== null);
        },
        start: function (view) {
            this.action(view, 'start');
        },
        update: function (view) {
            this.action(view, 'update');
        },
        pull: function (view) {
            this.action(view, 'pull');
        },
        restart: function (view) {
            this.action(view, 'restart');
        },
        stop: function (view) {
            this.action(view, 'stop');
        },
        action: async function (view, action) {
            this.busy[view.name] = true;
            try {
                await fetch(`/api/v1/services/${encodeURIComponent(view.name)}/${action}`, {method: 'POST'});
                await this.poll();
            }
            catch {
                // serviceman went while it was answering. The header already says so, and the
                // next poll shows whether the service did what it was asked.
                this.answering = false;
            }
            finally {
                this.busy[view.name] = false;
            }
        },
        // Saving ends on the service that was saved — which is where the answer to "did that
        // work" is: the phase, what it is doing, what it printed, and its address as a link.
        // A service just taken away leaves the front page.
        form_saved: async function (name) {
            await this.poll();
            if ((name === null) || (name === undefined)) {
                this.home_show();
                return;
            }
            this.selected_name = name;
            this.remote_name = null;
        },
        theme_toggle: function () {
            this.theme = ((this.theme === 'dark') ? 'light' : 'dark');
            document.documentElement.dataset.theme = this.theme;
            localStorage.setItem('serviceman.theme', this.theme);
        },
        skins_load: async function () {
            try {
                const answer = await fetch('/api/v1/skins', {cache: 'no-store'});
                this.skins = (await answer.json()).skins;
            }
            catch {
                // No answer means no picker; the page stays classic
                this.skins = [];
            }
        },
        skin_choose: function (name) {
            this.skin_menu = false;
            this.skin_pick(name);
        },
        skin_pick: function (name) {
            this.skin = name;
            if (name === '') {
                localStorage.removeItem('serviceman.skin');
            }
            else {
                localStorage.setItem('serviceman.skin', name);
            }
            let link = document.getElementById('skin-css');
            if (name === '') {
                if (link !== null) {
                    link.remove();
                }
                return;
            }
            if (link === null) {
                link = document.createElement('link');
                link.id = 'skin-css';
                link.rel = 'stylesheet';
                document.head.appendChild(link);
            }
            link.href = `/skins/${encodeURIComponent(name)}/skin.css`;
        },
    },
    created: function () {
        this.route_open(route_from_path(window.location.pathname, window.location.search));
        window.addEventListener('popstate', () => this.route_open(route_from_path(window.location.pathname, window.location.search)));
        this.skins_load();
        this.tick();
        window.addEventListener('keydown', this.find_key);
    },
};

const page = createApp(app);

// Every table that folds what does not fit draws with it, the modules' tables too
page.component('fold-table', fold_table);

// One broken view never takes the whole page down; polling carries on. But a page that fails
// to draw and says nothing is a page that looks stuck, so the error is put on the page itself
// — outside the app, because a render that throws cannot draw its own bad news.
page.config.errorHandler = function (error, instance, where) {
    console.error(error);
    trouble_show(`${(error && error.message) ? error.message : String(error)} (${where})`);
};
window.addEventListener('error', function (error) {
    trouble_show(error.message);
});
window.addEventListener('unhandledrejection', function (event) {
    trouble_show((event.reason && event.reason.message) ? event.reason.message : String(event.reason));
});

// The last thing that went wrong on this page, at the top of it, with the one way out
function trouble_show(text)
{
    let box = document.getElementById('trouble');
    if (box === null) {
        box = document.createElement('div');
        box.id = 'trouble';
        const note = document.createElement('span');
        const reload = document.createElement('button');
        reload.type = 'button';
        reload.textContent = 'Reload';
        reload.addEventListener('click', function () {
            location.reload();
        });
        box.appendChild(note);
        box.appendChild(reload);
        document.body.prepend(box);
    }
    box.firstChild.textContent = `The page hit an error and may not be drawing: ${text}`;
}

// Nothing on this page is picked up and dragged: a link or a picture caught by a quick second
// click starts a browser drag, and Chrome on Wayland can hold that drag — and with it every
// click and key — until the page is reloaded. A file dropped in from outside is another
// matter, and is not stopped by this.
document.addEventListener('dragstart', function (event) {
    event.preventDefault();
});

page.mount('#app');

function phase_short(view)
{
    if ((view.doing !== null) && (view.doing !== undefined)) {
        return 'fetching';
    }
    if ((view.phase === 'running') && view.policy.instances && (view.policy.instances.max > 1)) {
        return `${view.instances_running}/${view.policy.instances.max}`;
    }
    if ((view.phase === 'running') && (view.stop_in_ms !== null)) {
        return format_ms(view.stop_in_ms);
    }
    return view.phase;
}

function policy_text(view)
{
    const items = [];
    if (view.policy.start === 'always') {
        items.push('always on');
    }
    else if (view.policy.stop_after_idle_ms === null) {
        items.push('starts on demand, stays up');
    }
    else {
        items.push(`starts on demand, sleeps after ${format_ms(view.policy.stop_after_idle_ms)} idle`);
    }
    if (view.policy.instances.max > 1) {
        items.push(`${view.policy.instances.min || 1}–${view.policy.instances.max} instances`);
    }
    if (view.policy.concurrency !== null) {
        items.push(`${view.policy.concurrency} ${plural(view.policy.concurrency, 'request', 'requests')} each`);
    }
    if ((view.policy.request_timeout_ms !== null) && (view.type !== 'shell')) {
        items.push(`${format_ms(view.policy.request_timeout_ms)} request timeout`);
    }
    if (view.type === 'shell') {
        items.push(`restart ${view.policy.restart}`);
    }
    return items.join(' · ');
}

// Names the way a person sorts them: case aside, and the digits in them as numbers
function rail_compare(a, b)
{
    return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});
}

function plural(count, one, many)
{
    return ((count === 1) ? one : many);
}

function ace_theme(theme)
{
    return ((theme === 'dark') ? 'ace/theme/github_dark' : 'ace/theme/github_light_default');
}

function icon_html(name)
{
    if ((name === undefined) || (overview_icons[name] === undefined)) {
        return '';
    }
    return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">${overview_icons[name]}</svg>`;
}
