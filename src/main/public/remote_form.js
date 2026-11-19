import agent_url_of from './agent_url_of.js';
import entry_from_form from './entry_from_form.js';
import format_bytes from './format_bytes.js';
import machine_drawing from './machine_drawing.js';
import settled from './settled.js';
import snippet from './snippet.js';
import state_read from './state_read.js';
import step_frame from './step_frame.js';
import to_clipboard from './to_clipboard.js';

const TOKEN_BYTES = 32;
// A remote's name, as the config takes it
const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
// How often the Connect step asks whether its agent has dialled in
const JOIN_EVERY_MS = 2000;

// How a machine may be drawn on the Canvas
const KINDS = [
    {kind: 'server', label: 'server'},
    {kind: 'laptop', label: 'laptop'},
    {kind: 'home', label: 'home computer'},
];

// Adding a machine that carries services, without touching the config text: a new one step by
// step, its name, then the lines to run there while the page waits for its agent; a machine
// that exists, its settings in one form
const remote_form = {
    template: `
<article id="detail" class="form rf">
    <step-frame v-if="(original === null)" title="New remote" :steps="steps" :step="step" :mode="mode" :can_next="name_ok.ok" :next_title="name_ok.why" :busy="busy" :create_label="create_label" @step="step_go" @mode="mode = $event" @cancel="cancel_new" @create="create_click">
        <template #name>
            <div class="sf-fields">
                <input ref="name" v-model.trim="model.name" class="sf-big" placeholder="vps2" aria-label="Its name" :disabled="(saved_name !== null)" spellcheck="false" @keydown.enter="step_go(1)">
                <p v-if="((model.name !== '') && (name_ok.ok === false))" class="bad">{{ name_ok.why }}</p>
                <p v-else class="muted">Lowercase letters, digits, <code>-</code> and <code>_</code>. A service names its machine by this.</p>
                <div class="sf-grid">
                    <span class="rf-label">Tags</span>
                    <div class="rf-tags">
                        <span v-for="tag of tags_list" :key="tag" class="tag">#{{ tag }}<button v-if="(saved_name === null)" type="button" class="rf-tag-x" :aria-label="('Take #' + tag + ' away')" @click="tag_drop(tag)">×</button></span>
                        <input v-if="(saved_name === null)" v-model.trim="tag_typed" class="rf-tag-new" placeholder="+ tag" aria-label="A tag" spellcheck="false" @keydown.enter.prevent="tag_add" @keydown.space.prevent="tag_add" @keydown.,.prevent="tag_add" @blur="tag_add">
                        <span class="muted rf-tags-says">a service can ask for <code>#{{ tags_list[0] || 'eu' }}</code> instead of a name</span>
                    </div>
                    <label for="rf-title-new">Title on this page</label>
                    <input id="rf-title-new" v-model.trim="model.title" placeholder="Hetzner, Falkenstein — optional" :disabled="(saved_name !== null)" spellcheck="false">
                </div>
                <p v-if="(saved_name !== null)" class="muted">Kept as <b>{{ saved_name }}</b>, with a token of its own; its page's Settings changes it.</p>
            </div>
        </template>
        <template #connect>
            <div class="sf-fields">
                <template v-if="(saved_name === null)">
                    <p class="muted">Create remote keeps it with a token of its own; then the two lines to run there are here, and the page waits for its agent.</p>
                </template>
                <template v-else-if="(agent_url === null)">
                    <p class="muted">The config gives agents a socket file and no port: its page's <b>Install</b> tab says how to bring it there.</p>
                </template>
                <template v-else>
                    <p class="muted">On {{ saved_name }}, as you:</p>
                    <snip :text="lines_text" :secret="model.token"/>
                    <p class="muted">It needs node and nothing else; the token is its whole introduction. Its page's <b>Install</b> tab has the one-command install that keeps it up across reboots.</p>
                </template>
                <div v-if="((saved_name !== null) && (joined === null))" class="rf-wait" role="status"><span class="spin"/>Waiting for {{ saved_name }} to connect…</div>
                <div v-else-if="(joined !== null)" class="rf-joined" role="status">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>
                    <span><b>{{ saved_name }} is connected</b><small>{{ joined_text }}</small></span>
                </div>
            </div>
        </template>
        <template #summary>
            <div class="sum-head"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg><b>{{ model.name || 'no name yet' }}</b></div>
            <p v-if="(tags_list.length > 0)" class="sum-line"><span>{{ tags_list.map(v => ('#' + v)).join(' ') }}</span></p>
            <p class="sum-line"><span>a token of its own</span></p>
            <p class="sum-line muted"><span>{{ (joined !== null) ? 'connected' : ((saved_name === null) ? 'not made yet' : 'not connected yet') }}</span></p>
        </template>
        <template #note>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <div>
        <h1>{{ (original === null ? 'New remote' : 'Settings of ' + (original.title || original.name)) }}</h1>
        <p class="muted">A machine that runs services for this host. Its agent connects to this host and waits for orders, so that machine needs no open port and no public address.</p>
    </div>
    <section class="card rf-card">
        <div class="rf-head">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8z"/><circle cx="8" cy="8" r="1.3"/></svg>
            <b>Identity</b>
            <span class="muted">how this page and the services name it</span>
        </div>
        <div class="grid">
            <label for="rf-name">Name</label>
            <div>
                <input id="rf-name" v-model.trim="model.name" placeholder="vps1" spellcheck="false">
                <p class="muted">Lowercase letters, digits, <code>-</code> and <code>_</code>. A service names its remote by this.</p>
            </div>
            <label for="rf-title">Title</label>
            <div><input id="rf-title" v-model.trim="model.title" placeholder="shown on this page — optional" spellcheck="false"></div>
            <label for="rf-tags">Tags</label>
            <div>
                <input id="rf-tags" v-model.trim="model.tags" placeholder="gpu, eu — optional" spellcheck="false">
                <p class="muted">What this machine <em>is</em>. A service can ask for <code>#gpu</code> instead of a name, and every machine carrying the tag will do. The machine may add more with <code>--tag</code> when it connects; those are not written here.</p>
            </div>
        </div>
    </section>
    <!-- How it is drawn on the Canvas: not the config's, so a click keeps it at once -->
    <section v-if="(original !== null)" class="card rf-card">
        <div class="rf-head">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="11" height="8" rx="1.5"/><path d="M7 12v3M5 15h5"/><rect x="16" y="6" width="5" height="12" rx="1.2"/></svg>
            <b>Drawn as</b>
            <span class="muted">how the Canvas draws it; a click keeps it</span>
        </div>
        <div class="rf-kinds" role="radiogroup" aria-label="Drawn as">
            <button v-for="item of KINDS" :key="item.kind" type="button" role="radio" class="rf-kind" :class="{on: (kind === item.kind)}" :aria-checked="(kind === item.kind)" :disabled="(kind === null)" @click="kind_set(item.kind)">
                <svg viewBox="0 0 100 100" width="88" height="88" aria-hidden="true"><machine-drawing :kind="item.kind" light="green"/></svg>
                <span>{{ item.label }}</span>
            </button>
        </div>
        <p v-if="(kind_note !== '')" :class="(kind_bad ? 'bad' : 'muted')">{{ kind_note }}</p>
    </section>
    <section class="card rf-card">
        <div class="rf-head">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
            <b>Access</b>
            <span class="muted">what its agent proves itself with</span>
        </div>
        <div class="grid">
            <label for="rf-token">Token</label>
            <div>
                <div class="line">
                    <input id="rf-token" v-model.trim="model.token" class="rf-token secret" spellcheck="false" autocomplete="off">
                    <button type="button" @click="click_copy">{{ (copied ? 'Copied' : 'Copy') }}</button>
                    <button type="button" @click="click_another_one">Another one</button>
                </div>
                <p class="muted">It lets that machine run containers for you — keep it like an ssh key.</p>
                <p v-if="token_changed" class="alert">The agent on that machine still has the old token: once this is saved it cannot connect until it is given the new one — the Install tab has the command that does it.</p>
            </div>
        </div>
    </section>
    <section v-if="(original !== null)" class="card rf-card rf-danger">
        <div class="rf-head">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4L2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>
            <b>Remove this remote</b>
        </div>
        <p class="muted">This host forgets {{ original.name }}. Whatever runs on that machine keeps running. Its agent is told, stops and takes itself out of systemd there; nothing on that machine is deleted.</p>
        <div class="rf-remove">
            <button v-if="(removing === false)" type="button" class="danger" @click="removing = true">Remove…</button>
            <template v-else>
                <span>Forget {{ original.name }}?</span>
                <button type="button" class="danger" :disabled="busy" @click="remove">Forget it</button>
                <button type="button" @click="removing = false">Keep it</button>
            </template>
        </div>
        <div v-if="(blockers.length > 0)" class="rf-remove">
            <span class="muted">Services keeping it:</span>
            <button v-for="name of blockers" :key="name" type="button" @click="$emit('service', name)">{{ name }}</button>
        </div>
    </section>
    <div class="actions">
        <button type="button" class="primary" :disabled="busy" @click="save">Save</button>
        <button type="button" @click="$emit('close')">Cancel</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
    </template>
</article>
`,
    components: {'machine-drawing': machine_drawing, snip: snippet, 'step-frame': step_frame},
    // control, tailnet: where a new agent dials, for the lines a new machine is given
    props: ['original', 'control', 'tailnet'],
    emits: ['close', 'saved', 'service', 'service_here'],
    data: function () {
        return {
            KINDS,
            // How the Canvas draws it, null until read; what came of the last click
            kind: null,
            kind_note: '',
            kind_bad: false,
            model: {
                name: (this.original === null) ? '' : this.original.name || '',
                title: (this.original === null) ? '' : this.original.title || '',
                token: (this.original === null) ? token_make() : this.original.token || '',
                tags: (this.original === null) ? '' : (this.original.tags || []).join(', '),
                machine: (this.original === null) ? null : this.original.machine || null,
                // Not edited here — the Logs tab switches it. Carried so saving this form does not
                // quietly stop a machine's logs.
                logs: (this.original === null) ? 'off' : this.original.logs || 'off',
                // Not edited here — the Networking page owns it. Carried so saving this form
                // does not quietly take a machine's door away.
                inbound: (this.original === null) ? {} : this.original.inbound || {},
            },
            // What this form writes for the machine untouched, kept before a field is changed
            // (created); null for a new one
            seen: null,
            note: '',
            bad: false,
            busy: false,
            // Taking a machine away is asked for twice, the way taking a service away is
            removing: false,
            // The services keeping this machine, when it would not go
            blockers: [],
            copied: false,
            // A new one: the step open, how the form is shown, the tag being typed; its name once
            // it is kept, and what its agent said once it dialled in
            step: 0,
            mode: 'steps',
            tag_typed: '',
            saved_name: null,
            joined: null,
            join_timer: null,
        };
    },
    computed: {
        steps: function () {
            return [
                {key: 'name', name: 'Name', question: 'What do you call this machine?', answer: (this.saved_name === null) ? '' : this.saved_name},
                {key: 'connect', name: 'Connect', question: (this.saved_name === null) ? 'Connect it' : `Run this on ${this.saved_name}`, answer: (this.joined === null) ? '' : 'connected'},
            ];
        },
        name_ok: function () {
            if (this.saved_name !== null) {
                return {ok: true, why: ''};
            }
            if (this.model.name === '') {
                return {ok: false, why: 'A name first'};
            }
            if (RE_NAME.test(this.model.name) === false) {
                return {ok: false, why: 'Lowercase letters, digits, - and _ only, starting with a letter or a digit.'};
            }
            return {ok: true, why: ''};
        },
        tags_list: function () {
            return this.model.tags.split(',').map(v => v.trim().toLowerCase()).filter(v => v !== '');
        },
        create_label: function () {
            if (this.saved_name === null) {
                return 'Create remote';
            }
            return (this.joined === null) ? 'Done' : 'Put a service on it →';
        },
        // Where its agent dials: serviceman's name on the tailnet at its control port, or this
        // page's address; null where the config gives agents no port
        agent_url: function () {
            const port = ((this.control === undefined) || (this.control === null)) ? null : this.control.port;
            return (port === null) ? null : agent_url_of(this.tailnet, port);
        },
        lines_text: function () {
            return `curl -fsSL ${this.agent_url}/api/v1/agent.js -o serviceman-agent.js\nnode serviceman-agent.js --url ${this.agent_url} --token ${this.model.token}`;
        },
        // What it said of itself as it dialled in: its system, cores, memory, agent
        joined_text: function () {
            const machine = this.joined.machine;
            if ((machine === null) || (machine === undefined)) {
                return `agent ${this.joined.agent_version || ''}`.trim();
            }
            return [machine.os || machine.platform || '', (machine.cpu === undefined) ? '' : `${machine.cpu.count} CPU`, ((machine.mem === undefined) || (machine.mem.total === null)) ? '' : format_bytes(machine.mem.total), (this.joined.agent_version === undefined) ? '' : `agent ${this.joined.agent_version}`].filter(v => v !== '').join(' · ');
        },
        // A new token on a machine that exists locks its agent out until it is given the token
        token_changed: function () {
            return (this.original !== null) && (this.model.token !== (this.original.token || ''));
        },
    },
    methods: {
        tag_add: function () {
            const typed = this.tag_typed.replace(/^#/, '').replace(/,/g, '').trim().toLowerCase();
            this.tag_typed = '';
            if ((typed === '') || this.tags_list.includes(typed)) {
                return;
            }
            this.model.tags = this.tags_list.concat([typed]).join(', ');
        },
        tag_drop: function (tag) {
            this.model.tags = this.tags_list.filter(v => v !== tag).join(', ');
        },
        // Next from its name keeps it, with its token, so its agent can dial in
        step_go: async function (index) {
            if ((index > this.step) && (this.name_ok.ok === false)) {
                return;
            }
            if ((index === 1) && (this.saved_name === null)) {
                if (await this.save_new() === false) {
                    return;
                }
            }
            this.step = index;
        },
        // Create, Done or Put a service on it, as the step stands
        create_click: async function () {
            if (this.saved_name === null) {
                if ((this.name_ok.ok === false) || (await this.save_new() === false)) {
                    return;
                }
                if (this.mode === 'steps') {
                    this.step = 1;
                }
                return;
            }
            if (this.joined !== null) {
                this.$emit('service_here', this.saved_name);
                return;
            }
            this.$emit('saved', this.saved_name);
            this.$emit('close');
        },
        // Cancel once it is kept leaves it kept: its page shows it
        cancel_new: function () {
            if (this.saved_name !== null) {
                this.$emit('saved', this.saved_name);
            }
            this.$emit('close');
        },
        save_new: async function () {
            this.busy = true;
            this.report('', false);
            try {
                const answer = await fetch('/api/v1/remotes', {method: 'POST', body: JSON.stringify({remote: json_from_remote(this.model)})});
                const outcome = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    this.report(outcome.error || `serviceman answered ${answer.status}`, true);
                    return false;
                }
                this.saved_name = this.model.name;
                this.join_wait();
                return true;
            }
            catch {
                this.report('the answer never came back: its page shows whether it landed', true);
                return false;
            }
            finally {
                this.busy = false;
            }
        },
        // Asked every two seconds until its agent has dialled in
        join_wait: function () {
            const self = this;
            clearTimeout(this.join_timer);
            this.join_timer = setTimeout(async function () {
                try {
                    const found = (await state_read()).remotes.find(v => v.name === self.saved_name);
                    if ((found !== undefined) && (found.phase === 'online')) {
                        self.joined = found;
                        return;
                    }
                }
                catch {
                    // asked again
                }
                self.join_wait();
            }, JOIN_EVERY_MS);
        },
        // How the Canvas draws it now
        kind_read: async function () {
            try {
                const canvas = (await state_read()).canvas;
                const found = canvas.machines.find(v => (v.name === this.original.name));
                this.kind = (found === undefined) ? 'server' : found.kind;
            }
            catch {
                this.kind = 'server';
            }
        },
        // Drawn as another kind: kept at once, for the Canvas on every page
        kind_set: async function (kind) {
            const before = this.kind;
            this.kind = kind;
            this.kind_note = '';
            this.kind_bad = false;
            try {
                const answer = await fetch(`/api/v1/canvas/machines/${encodeURIComponent(this.original.name)}`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({kind})});
                if (answer.ok === false) {
                    throw new Error((await answer.json()).error);
                }
                this.kind_note = `kept: the Canvas draws ${this.original.name} as a ${KINDS.find(v => (v.kind === kind)).label}`;
            }
            catch (error) {
                this.kind = before;
                this.kind_bad = true;
                this.kind_note = `not kept: ${(error instanceof TypeError) ? 'the answer never came back' : error.message}`;
            }
        },
        click_another_one: function () {
            this.model.token = token_make();
        },
        // The field shows dots, so this is the way to take the token
        click_copy: async function () {
            if (await to_clipboard(this.model.token)) {
                this.copied = true;
                setTimeout(this.copied_forget, 1500);
                return;
            }
            this.report('the clipboard would not take it', true);
        },
        copied_forget: function () {
            this.copied = false;
        },
        save: async function () {
            this.busy = true;
            try {
                const url = (this.original === null) ? '/api/v1/remotes' : `/api/v1/remotes/${encodeURIComponent(this.original.name)}`;
                const method = (this.original === null) ? 'POST' : 'PUT';
                // The entry the config file has, changed where this form changed it: its log
                // folders, and whatever else this form does not show, stay as they were
                const written = json_from_remote(this.model);
                const remote = (this.original === null) ? written : entry_from_form(this.original, this.seen, written, {});
                const answer = await fetch(url, {method, body: JSON.stringify({remote})});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.$emit('saved', this.model.name);
                this.$emit('close');
            }
            catch {
                this.report('the answer never came back — checking whether it landed…', false);
                const name = this.model.name;
                const landed = await settled(async () => (await state_read()).remotes.some(v => v.name === name));
                if (landed === false) {
                    this.report('serviceman is not answering', true);
                    return;
                }
                this.$emit('saved', name);
                this.$emit('close');
            }
            finally {
                this.busy = false;
            }
        },
        remove: async function () {
            this.busy = true;
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.original.name)}`, {method: 'DELETE'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    // It is still there, and the reason is on the page: the buttons go back to
                    // asking rather than standing ready to be pressed again
                    this.removing = false;
                    this.blockers = Array.isArray(outcome.services) ? outcome.services : [];
                    this.report(outcome.error, true);
                    return;
                }
                this.$emit('saved', null);
                this.$emit('close');
            }
            catch {
                this.report('the answer never came back — checking whether it landed…', false);
                const name = this.original.name;
                const gone = await settled(async () => (await state_read()).remotes.some(v => v.name === name) === false);
                if (gone === false) {
                    this.report('serviceman is not answering', true);
                    return;
                }
                this.$emit('saved', null);
                this.$emit('close');
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
    created: function () {
        if (this.original !== null) {
            this.seen = json_from_remote(this.model);
        }
    },
    mounted: function () {
        if (this.original !== null) {
            this.kind_read();
            return;
        }
        this.$refs.name.focus();
    },
    unmounted: function () {
        clearTimeout(this.join_timer);
    },
};

function json_from_remote(model)
{
    const out = {name: model.name};
    if (model.title !== '') {
        out.title = model.title;
    }
    out.token = model.token;
    const tags = model.tags.split(',').map(v => v.trim().toLowerCase()).filter(v => v !== '');
    if (tags.length > 0) {
        out.tags = tags;
    }
    // A machine that added itself keeps saying which machine it is, so it takes this same entry
    // when it comes back
    if (model.machine !== null) {
        out.machine = model.machine;
    }
    if (Object.keys(model.inbound).length > 0) {
        out.inbound = model.inbound;
    }
    // Off is what an entry without it means, so off is not written
    if (model.logs === 'all') {
        out.logs = 'all';
    }
    return out;
}

// The same thing openssl rand -hex 32 gives you, made here so the token never travels
function token_make()
{
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    return Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('');
}

export default remote_form;
