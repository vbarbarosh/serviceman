import agent_url_of from './agent_url_of.js';
import snippet from './snippet.js';

// What the one command does, said under it; the other ways to put the agent on a machine, a tab each
const INSTALL_FACTS = ['needs node', 'its token kept beside it', 'up again after a reboot, where there is systemd'];
const INSTALL_WAYS = [{key: 'node', label: 'No node'}, {key: 'hand', label: 'By hand'}, {key: 'docker', label: 'Docker'}, {key: 'file', label: 'The file'}];
// A machine with no node cannot run the agent, and the whole of node it needs is one file.
// The archive is unpacked as it arrives and only bin/node is kept, in ~/bin; the install line
// prints the same command, for the machine's own processor, when it finds no node. Node 24, as
// agent_install_sh.js says why.
const NODE_TEXT = 'mkdir -p ~/bin && v=v24.22.3 && curl -fsSL https://nodejs.org/dist/$v/node-$v-linux-x64.tar.xz | tar -xJ -C ~/bin --strip-components=2 node-$v-linux-x64/bin/node';

// The one command that puts the agent on the machine, written with the address this page was
// opened on and the token from the config, in a card of its own: where it dials, its root half,
// the command and what it does. The other ways, for a machine where it cannot run (no node, by
// hand, docker, the file alone), in a second card, a tab each, one shown at a time, its steps
// numbered. Every field and command fills its card's width, a command wrapping inside its block.
const remote_install = {
    template: `
<article id="detail" class="ins">
    <p v-if="(door === null)" class="bad">The agent has no way in: the config gives the control page no port and no socket file.</p>
    <template v-else>
    <section class="card ins-card">
        <div class="ins-head">
            <h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg>Install the agent on {{ view.name }}</h2>
            <span class="muted">one command, run there as yourself</span>
        </div>
        <div class="ins-dials">
            <label for="ins-where">{{ (door.socket === null) ? 'It dials' : 'The socket file there' }}</label>
            <input id="ins-where" v-model.trim="typed" class="sf-mono" spellcheck="false" autocomplete="off">
            <span v-if="(doors.length > 1)" class="seg ins-doors" role="group" aria-label="How it dials">
                <button v-for="item of doors" :key="item.key" type="button" :class="{on: (item.key === door.key)}" :aria-pressed="(item.key === door.key)" @click="door_pick(item)">{{ item.label }}</button>
            </span>
            <p class="muted ins-hint">{{ door.hint }}</p>
            <p v-if="(door.socket !== null)" class="muted ins-hint">The socket file must be on that machine; this copies it there, and no port stays open on the two machines: <code>ssh -R {{ door_where }}:{{ door.socket }} {{ view.name }}</code></p>
            <label class="ins-root"><input v-model="root_half" type="checkbox"><span><b>Root half too</b> <span class="muted">for mounts, the firewall and updates; it asks your password once</span></span></label>
        </div>
        <snip :text="install_text" :secret="token" prompt primary/>
        <ul class="ins-facts">
            <li v-for="fact of FACTS" :key="fact"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>{{ fact }}</li>
        </ul>
    </section>
    <section class="card ins-card">
        <div class="ins-head">
            <h2><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-6 3-11 6"/></svg>Other ways</h2>
            <span class="muted">when the command cannot run there</span>
        </div>
        <div class="ins-tabs" role="tablist" aria-label="Other ways">
            <button v-for="item of WAYS" :key="item.key" type="button" role="tab" :class="{on: (item.key === way)}" :aria-selected="(item.key === way)" @click="way = item.key">{{ item.label }}</button>
        </div>
        <ol v-if="(way === 'node')" class="ins-steps">
            <li><p><b>Put node in ~/bin</b><span class="muted">one file: nothing is installed, nothing else touched</span></p><snip :text="node_text" prompt/></li>
            <li><p><b>Then the command above</b></p></li>
        </ol>
        <ol v-else-if="(way === 'hand')" class="ins-steps">
            <li><p><b>Fetch the agent</b><span class="muted">one file, beside you</span></p><snip :text="fetch_text" prompt/></li>
            <li><p><b>Run it</b><span class="muted">it dials, and keeps dialling until it is stopped</span></p><snip :text="run_text" :secret="token" prompt/></li>
        </ol>
        <ol v-else-if="(way === 'docker')" class="ins-steps">
            <li><p><b>Start it as a container</b><span class="muted">where that machine has docker</span></p><snip :text="docker_text" :secret="token" prompt/></li>
            <li><p><b>No image yet?</b><span class="muted">made from the repo, on that machine</span></p><snip text="docker build -f Dockerfile.agent -t serviceman-agent ." prompt/></li>
        </ol>
        <div v-else class="ins-file">
            <a class="button" href="/api/v1/agent.js" download><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Download the agent file</a>
            <span class="muted">serviceman-agent.js, one file: run it with node, as By hand says</span>
        </div>
    </section>
    </template>
</article>
`,
    components: {snip: snippet},
    props: ['view', 'control', 'tailnet'],
    data: function () {
        // way: the tab of Other ways shown
        return {token: null, door_key: null, typed: '', root_half: false, way: 'node', FACTS: INSTALL_FACTS, WAYS: INSTALL_WAYS};
    },
    computed: {
        token_text: function () {
            return (this.token === null) ? '<the token in the config>' : this.token;
        },
        // serviceman's own name on the tailnet, at its control port, where tailscale has given
        // it one; else what this page was opened on
        agent_url: function () {
            return agent_url_of(this.tailnet, this.control.port);
        },
        // The ways in that the config gives an agent: a port, a socket file, or the two of them.
        //
        // What is filled in is serviceman's own tailnet name, which every machine on the tailnet
        // reaches, or with none what this page was opened on. A machine off the tailnet may
        // reach this one by another name entirely, so it can be typed.
        doors: function () {
            const out = [];
            if (this.control.port !== null) {
                out.push({
                    key: 'http',
                    label: 'address',
                    socket: null,
                    mark: this.agent_url,
                    hint: `this serviceman, as ${this.view.name} reaches it`,
                });
            }
            if (this.control.socket !== null) {
                out.push({
                    key: 'socket',
                    label: 'socket file',
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
            return (this.typed === '') ? this.door.mark : this.typed;
        },
        door: function () {
            const picked = this.doors.find(v => v.key === this.door_key);
            if (picked !== undefined) {
                return picked;
            }
            return (this.doors.length === 0) ? null : this.doors[0];
        },
        // The whole install in one line, the way tailscale does it: fetch and run, with the token
        // given to the script instead of baked into it
        install_text: function () {
            const fetched = (this.door.socket === null)
                ? `curl -fsSL ${this.door_where}/api/v1/install.sh`
                : `curl -fsSL --unix-socket ${this.door_where} http://localhost/api/v1/install.sh`;
            const where = (this.door.socket === null) ? '' : ` --url ${this.door_url}`;
            const root = this.root_half ? ' --root' : '';
            return `${fetched} | sh -s -- --token ${this.token_text}${where}${root}`;
        },
        // The url the agent is given: a plain address, or a socket file as unix:///path
        door_url: function () {
            return (this.door.socket === null) ? this.door_where : `unix://${this.door_where}`;
        },
        // By hand, the two things the command does: the agent fetched, then run
        fetch_text: function () {
            return (this.door.socket === null)
                ? `curl -fsSL ${this.door_where}/api/v1/agent.js -o serviceman-agent.js`
                : `curl -fsSL --unix-socket ${this.door_where} http://localhost/api/v1/agent.js -o serviceman-agent.js`;
        },
        run_text: function () {
            return `node serviceman-agent.js --url ${this.door_url} --token ${this.token_text}`;
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
            this.typed = (this.door === null) ? '' : this.door.mark;
        },
        // The command is only worth copying with the real token in it, and the config has it
        token_read: async function () {
            if (this.view.phase === 'online') {
                return;
            }
            try {
                const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
                const found = (JSON.parse(loaded.text).remotes || []).find(v => v.name === this.view.name);
                this.token = (found === undefined) ? null : found.token;
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

export default remote_install;
