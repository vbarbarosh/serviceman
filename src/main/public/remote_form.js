import agent_url_of from './agent_url_of.js';
import entry_from_form from './entry_from_form.js';
import format_ms_ago from './format_ms_ago.js';
import machine_icons from './machine_icons.js';
import settled from './settled.js';
import size_words from './size_words.js';
import state_pill from './state_pill.js';
import state_read from './state_read.js';
import step_frame from './step_frame.js';
import to_clipboard from './to_clipboard.js';

const TOKEN_BYTES = 32;
// A remote's name, as the config takes it
const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
// How often the Connect step asks whether its agent has dialled in
const JOIN_EVERY_MS = 2000;

// How a machine may be drawn on the Canvas, and what each one is
const KINDS = [
    {kind: 'server', label: 'server', words: 'a rack box, on all day'},
    {kind: 'laptop', label: 'laptop', words: 'a lid that closes, away at times'},
    {kind: 'home', label: 'home computer', words: 'a desk tower, on when someone is home'},
];

// Adding a machine that carries services, without touching the config text: a new one step by
// step, its name, then the lines to run there while the page waits for its agent; a machine
// that exists, a card a setting, each saved alone
const remote_form = {
    template: `
<article id="detail" class="form rf">
    <step-frame v-if="(original === null)" title="New remote" :steps="steps" :step="step" :mode="mode" :can_next="next_ok.ok" :next_title="next_ok.why" :busy="busy" :create_label="create_label" @step="step_go" @mode="mode = $event" @cancel="cancel_new" @create="create_click">
        <template #name>
            <div class="sf-fields">
                <div class="sf-field">
                    <label for="rf-name-new">Name</label>
                    <input id="rf-name-new" ref="name" v-model.trim="model.name" class="sf-mono" placeholder="vps2" :class="{wrong: ((model.name !== '') && (name_ok.ok === false))}" :disabled="(saved_name !== null)" spellcheck="false" @keydown.enter="step_go(1)">
                    <p v-if="((model.name !== '') && (name_ok.ok === false))" class="sf-hint bad">{{ name_ok.why }}</p>
                    <p v-else-if="(saved_name !== null)" class="sf-hint">Kept as <b>{{ saved_name }}</b>, with a token of its own; its page's Settings changes it.</p>
                    <p v-else class="sf-hint">small letters, digits, <code>-</code> and <code>_</code></p>
                </div>
                <div class="sf-field">
                    <label for="rf-title-new">Title on this page</label>
                    <input id="rf-title-new" v-model.trim="model.title" placeholder="Hetzner, Falkenstein" :disabled="(saved_name !== null)" spellcheck="false">
                    <p class="sf-hint">optional</p>
                </div>
            </div>
        </template>
        <template #connect>
            <p v-if="(saved_name === null)" class="sf-info"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>Create remote keeps it with a token of its own; then the two lines to run there are here, and the page waits for its agent.</span></p>
            <p v-else-if="(agent_url === null)" class="sf-info"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>The config gives agents a socket file and no port: its page's <b>Install</b> tab says how to bring it there.</span></p>
            <template v-else>
                <div v-for="(line, index) of lines" :key="index" class="sf-code">
                    <span class="sf-code-no">{{ index + 1 }}</span>
                    <code :title="line.shown">{{ line.shown }}</code>
                    <button type="button" @click="line_copy(index)"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>{{ (copied_line === index) ? 'Copied' : 'Copy' }}</button>
                </div>
                <div v-if="(joined === null)" class="sf-waiting" role="status">
                    <span class="spin"/>
                    <span><b>Waiting for {{ saved_name }} to dial in…</b><span class="muted">This page moves on by itself once it does. It needs node and nothing else; its page's Install tab keeps it up across reboots.</span></span>
                </div>
            </template>
        </template>
        <template #connected>
            <template v-if="(joined !== null)">
                <div class="sf-here">
                    <span class="sf-here-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg></span>
                    <span>
                        <span class="sf-here-name">{{ saved_name }}<state-pill tone="run" text="online"/></span>
                        <span class="muted"><span v-if="(model.title !== '')">{{ model.title }} ·</span><span>{{ joined_ago }}</span></span>
                    </span>
                </div>
                <div class="sf-specs">
                    <div v-for="item of specs" :key="item.label" class="sf-spec">
                        <span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/>{{ item.label }}</span>
                        <b>{{ item.text }}</b>
                    </div>
                </div>
            </template>
            <p v-else class="sf-hint">{{ (saved_name === null) ? 'Not made yet.' : 'Not connected yet: it shows here once its agent dials in.' }}</p>
        </template>
        <template #summary>
            <p class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg><span class="mono">{{ model.name || 'no name yet' }}</span></p>
            <p class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>a token of its own</span></p>
            <p class="sum-line"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>{{ (joined !== null) ? 'connected' : ((saved_name === null) ? 'not made yet' : 'not connected yet') }}</span></p>
        </template>
        <template #note>
            <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
    </step-frame>
    <template v-else>
    <!-- A machine's Settings, as a service's are: a card a setting, read until its Edit. The card
         opened stays where it stands, across the row, the others stepping back; its foot says the
         change and what Save does, and saves that setting alone -->
    <div class="svc-cards grid rf-cards">
        <div v-for="card of cards" :key="card.id" :id="('rf-' + card.id)" class="card svc-sec" :class="{open: (open === card.id), dim: ((open !== '') && (open !== card.id))}" @keydown.esc="card_cancel">
            <div class="svc-head">
                <b><svg v-if="(open === card.id)" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l4 4"/></svg>{{ card.title }}</b>
                <span v-if="((open === card.id) && (changes.length > 0))" class="tag svc-changed">{{ (changes.length === 1) ? '1 change' : (changes.length + ' changes') }}</span>
                <span v-if="(open !== card.id)" class="svc-sum">
                    <span :class="{mono: card.mono, muted: card.none}">{{ card.value }}</span>
                    <span>{{ card.says }}</span>
                </span>
                <span v-if="(open !== card.id)" class="list-right">
                    <template v-if="(card.id === 'access')">
                        <button type="button" :disabled="(open !== '')" @click="click_copy"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>{{ (copied ? 'Copied' : 'Copy') }}</button>
                        <button type="button" :disabled="(open !== '')" @click="access_another">Another one</button>
                    </template>
                    <button v-else type="button" :disabled="((open !== '') || ((card.id === 'kind') && (kind === null)))" @click="card_open(card.id)">Edit</button>
                </span>
            </div>
            <template v-if="(open === card.id)">
                <p class="muted rf-says">{{ card.open_says }}</p>
                <div v-if="(card.id === 'name')" class="rf-field">
                    <input id="rf-name" v-model.trim="model.name" class="sf-mono" :class="{wrong: (name_wrong !== '')}" placeholder="vps1" spellcheck="false" aria-label="Name" @keydown.enter.prevent="card_save">
                    <p v-if="(name_wrong !== '')" class="bad">{{ name_wrong }}</p>
                    <p v-else class="muted">Lowercase letters, digits, <code>-</code> and <code>_</code>.</p>
                </div>
                <div v-else-if="(card.id === 'title')" class="rf-field">
                    <input id="rf-title" v-model.trim="model.title" placeholder="Hetzner, Falkenstein" spellcheck="false" aria-label="Title" @keydown.enter.prevent="card_save">
                    <p class="muted">Left empty, its name stands for it.</p>
                </div>
                <div v-else-if="(card.id === 'kind')" class="kind-tiles three" role="radiogroup" aria-label="Drawn as">
                    <button v-for="item of KINDS" :key="item.kind" type="button" role="radio" class="kind-tile" :class="{on: (kind_pick === item.kind)}" :aria-checked="(kind_pick === item.kind)" @click="kind_pick = item.kind">
                        <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="MACHINE_ICONS[item.kind]"/></span>
                        <b>a {{ item.label }}</b>
                        <span class="muted">{{ item.words }}</span>
                    </button>
                </div>
                <div v-else class="rf-field">
                    <div class="line">
                        <input id="rf-token" v-model.trim="model.token" class="rf-token secret" spellcheck="false" autocomplete="off" aria-label="Token" @keydown.enter.prevent="card_save">
                        <button type="button" @click="click_copy"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/></svg>{{ (copied ? 'Copied' : 'Copy') }}</button>
                        <button type="button" @click="click_another_one">Another one</button>
                    </div>
                </div>
                <!-- The open card's foot: the change alone, what Save does, its own Cancel and Save -->
                <div class="svc-foot">
                    <div class="svc-foot-says">
                        <p v-if="(changes.length === 0)" class="muted">Nothing changed yet</p>
                        <p v-else class="svc-foot-change rf-change"><b>{{ (changes.length === 1) ? '1 change' : (changes.length + ' changes') }}:</b> <span v-for="item of changes" :key="item">{{ item }}</span></p>
                        <p v-if="(foot.text !== '')" :class="(foot.bad ? 'bad' : 'muted')">{{ foot.text }}</p>
                    </div>
                    <div class="svc-foot-acts">
                        <button type="button" :disabled="busy" @click="card_cancel">Cancel</button>
                        <button type="button" class="primary" :disabled="(save_ok === false)" @click="card_save"><span v-if="busy" class="spin"/>{{ busy ? 'saving…' : 'Save' }}</button>
                    </div>
                </div>
            </template>
        </div>
    </div>
    <!-- Taking it away, apart at the end: what still runs there keeps it, and is said first -->
    <div class="card svc-sec svc-remove" :class="{dim: (open !== '')}">
        <div class="svc-head">
            <b>Remove {{ original.name }}</b>
            <span v-if="(removing === false)" class="svc-sum">
                <span v-if="(named_by.length === 0)">Forgets the machine; what runs there keeps running, and its agent takes itself out of systemd.</span>
                <span v-else>Forgets the machine; {{ named_words.what }} and {{ named_words.keep }} it until {{ named_words.until }}.</span>
            </span>
            <span v-else class="svc-sum"><span class="svc-warn">Forget {{ original.name }}? What runs there keeps running; nothing on it is deleted.</span></span>
            <span class="list-right">
                <button v-if="(removing === false)" type="button" class="danger" :disabled="((open !== '') || (named_by.length > 0))" :title="((named_by.length > 0) ? (named_words.what + ': ' + named_words.until + ' first') : '')" @click="removing = true">Remove…</button>
                <template v-else>
                    <button type="button" class="danger" :disabled="busy" @click="remove">Forget it</button>
                    <button type="button" @click="removing = false">Keep it</button>
                </template>
            </span>
        </div>
        <p v-if="((open === '') && (note !== ''))" class="bad rf-remove-note">{{ note }}</p>
        <div v-if="(blockers.length > 0)" class="rf-remove-by">
            <span class="muted">Services keeping it:</span>
            <button v-for="name of blockers" :key="name" type="button" @click="$emit('service', name)">{{ name }}</button>
        </div>
    </div>
    </template>
</article>
`,
    components: {'state-pill': state_pill, 'step-frame': step_frame},
    // control, tailnet: where a new agent dials, for the lines a new machine is given; named_by:
    // what in the config names a machine that exists, [{kind, name}] (remote_named_by)
    props: ['original', 'control', 'tailnet', 'named_by'],
    emits: ['close', 'saved', 'service', 'service_here'],
    data: function () {
        return {
            KINDS,
            MACHINE_ICONS: machine_icons,
            // How the Canvas draws it, null until read; the one picked while Drawn as is open
            kind: null,
            kind_pick: null,
            // The card opened with its Edit: 'name', 'title', 'kind', 'access', or '' for none
            open: '',
            model: {
                name: (this.original === null) ? '' : this.original.name || '',
                title: (this.original === null) ? '' : this.original.title || '',
                token: (this.original === null) ? token_make() : this.original.token || '',
                // No longer set here, for now: carried so saving this form keeps the ones it has
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
            // The line of Connect just copied
            copied_line: null,
            // A new one: the step open, how the form is shown; its name once it is kept, and what
            // its agent said once it dialled in
            step: 0,
            mode: 'steps',
            saved_name: null,
            joined: null,
            join_timer: null,
        };
    },
    computed: {
        steps: function () {
            return [
                {key: 'name', name: 'Name', question: 'What do you call this machine?', says: 'A service names its machine by this.', answer: (this.saved_name === null) ? '' : this.saved_name},
                {key: 'connect', name: 'Connect', question: (this.saved_name === null) ? 'Connect it' : `Run these two lines on ${this.saved_name}`, says: 'As the user that will run its services; the agent then dials in by itself.', answer: (this.joined === null) ? '' : 'agent dialled in'},
                {key: 'connected', name: 'Connected', question: (this.joined === null) ? 'Connected' : `${this.saved_name} is here`, says: '', answer: ''},
            ];
        },
        // Whether the step open can go on: a name first, then its agent dialled in
        next_ok: function () {
            if (this.step === 0) {
                return this.name_ok;
            }
            return (this.joined === null) ? {ok: false, why: 'Waiting for its agent to dial in'} : {ok: true, why: ''};
        },
        // The two lines to run there, each as shown, its token cut short, and as copied
        lines: function () {
            const token = this.model.token;
            const short = (token.length > 12) ? `${token.slice(0, 6)}…${token.slice(-4)}` : token;
            return this.lines_text.split('\n').map(v => ({text: v, shown: v.replace(token, short)}));
        },
        // When its agent dialled in, by serviceman's clock
        joined_ago: function () {
            const at = this.joined.connected_at;
            return ((at === null) || (at === undefined)) ? 'dialled in' : `dialled in ${format_ms_ago(Math.max(0, Date.now() - at))}`;
        },
        // What it said of itself as it dialled in: its system, cores, memory and agent
        specs: function () {
            const machine = ((this.joined.machine === undefined) || (this.joined.machine === null)) ? {} : this.joined.machine;
            const mem = machine.mem;
            return [
                {label: 'System', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>', text: machine.os || machine.platform || '—'},
                {label: 'CPU', icon: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>', text: (machine.cpu === undefined) ? '—' : `${machine.cpu.count} ${(machine.cpu.count === 1) ? 'core' : 'cores'}`},
                {label: 'Memory', icon: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 11v2M11 11v2M15 11v2"/>', text: ((mem === undefined) || (mem.total === null)) ? '—' : `${(mem.free === null) ? '' : `${size_words(mem.free)} of `}${size_words(mem.total)}${(mem.free === null) ? '' : ' free'}`},
                {label: 'Agent', icon: '<path d="M12 19V5M6 11l6-6 6 6"/>', text: this.joined.agent_version || '—'},
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
        create_label: function () {
            if (this.saved_name === null) {
                return 'Create remote';
            }
            return (this.joined === null) ? 'Done' : 'Put a service on it';
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
        // A machine's cards: what each is set to, what it is for at rest, and once opened
        cards: function () {
            const name = this.original.name;
            const title = this.original.title || '';
            const kind = KINDS.find(v => (v.kind === this.kind));
            const says = {
                name: 'how the services name it; its agent dials in under it',
                title: 'shown on this page and the Canvas',
                access: 'the token its agent proves itself with; keep it like an ssh key',
            };
            return [
                {id: 'name', title: 'Name', value: name, mono: true, none: false, says: says.name, open_says: says.name},
                {id: 'title', title: 'Title', value: (title === '') ? 'none' : title, mono: false, none: (title === ''), says: says.title, open_says: says.title},
                {id: 'kind', title: 'Drawn as', value: (kind === undefined) ? 'reading…' : `a ${kind.label}`, mono: false, none: (kind === undefined), says: 'how the Canvas draws it', open_says: `how the Canvas draws ${name}`},
                {id: 'access', title: 'Access', value: '••••••••••••••••', mono: true, none: false, says: says.access, open_says: says.access},
            ];
        },
        // The change of the open card, as its foot says it: was → now; a token is never shown
        changes: function () {
            const original = this.original;
            if (this.open === 'name') {
                return (this.model.name === original.name) ? [] : [`${original.name} → ${this.model.name || 'none'}`];
            }
            if (this.open === 'title') {
                const was = original.title || '';
                return (this.model.title === was) ? [] : [`${was || 'none'} → ${this.model.title || 'none'}`];
            }
            if (this.open === 'kind') {
                return (this.kind_pick === this.kind) ? [] : [`a ${kind_label(this.kind)} → a ${kind_label(this.kind_pick)}`];
            }
            if (this.open === 'access') {
                return (this.model.token === (original.token || '')) ? [] : ['a new token'];
            }
            return [];
        },
        // What is wrong with the name typed, or ''
        name_wrong: function () {
            if (this.model.name === '') {
                return 'A name first';
            }
            return RE_NAME.test(this.model.name) ? '' : 'Lowercase letters, digits, - and _ only, starting with a letter or a digit.';
        },
        // What in the config names it, in words: {what: 'notes and shop run on it', keep: 'keep',
        // until: 'they move'}; a service runs on it, anything else names it
        named_words: function () {
            const named = this.named_by;
            const one = (named.length === 1);
            const services = named.every(v => (v.kind === 'service'));
            const names = named.map(v => ((v.kind === 'service') ? v.name : `the ${v.kind} ${v.name}`));
            const list = (names.length < 2) ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
            if (services) {
                return {what: `${list} ${one ? 'runs' : 'run'} on it`, keep: (one ? 'keeps' : 'keep'), until: (one ? 'it moves' : 'they move')};
            }
            return {what: `${list} ${one ? 'names' : 'name'} it`, keep: (one ? 'keeps' : 'keep'), until: (one ? 'it names another machine' : 'they name another machine')};
        },
        // What Save does to the machine as the open card stands, or what keeps it from saving
        foot: function () {
            if (this.note !== '') {
                return {text: this.note, bad: this.bad};
            }
            if (this.changes.length === 0) {
                return {text: '', bad: false};
            }
            if (this.open === 'name') {
                if (this.name_wrong !== '') {
                    return {text: this.name_wrong, bad: true};
                }
                if (this.named_by.length > 0) {
                    const words = this.named_words;
                    return {text: `Not while ${words.what}: a new name waits until ${words.until}.`, bad: true};
                }
                return {text: `Renames it here; its agent dials in again as ${this.model.name}. Nothing restarts.`, bad: false};
            }
            if (this.open === 'title') {
                return {text: 'Only how this page and the Canvas name it: nothing restarts.', bad: false};
            }
            if (this.open === 'kind') {
                return {text: 'Only how the Canvas draws it: nothing restarts.', bad: false};
            }
            if (this.model.token === '') {
                return {text: 'A token first: Another one makes one.', bad: true};
            }
            return {text: `Its agent keeps the old token: once this is saved, ${this.original.name} cannot dial in until it is given the new one, with the line its Install tab has.`, bad: false};
        },
        // Save is pressed only when it would keep something
        save_ok: function () {
            if (this.busy || (this.changes.length === 0)) {
                return false;
            }
            if (this.open === 'name') {
                return (this.name_wrong === '') && (this.named_by.length === 0);
            }
            return (this.open !== 'access') || (this.model.token !== '');
        },
    },
    methods: {
        // Next from its name keeps it, with its token, so its agent can dial in; Connected is
        // reached once it has
        step_go: async function (index) {
            if ((index > this.step) && (this.next_ok.ok === false)) {
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
                        if (self.step === 1) {
                            self.step = 2;
                        }
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
        // Edit: the card opens across its row, its field taking the keys
        card_open: function (id) {
            this.report('', false);
            this.removing = false;
            this.kind_pick = this.kind;
            this.open = id;
            this.$nextTick(function () {
                const found = this.$el.querySelector(`#rf-${id} input, #rf-${id} [role="radio"][aria-checked="true"]`);
                if (found !== null) {
                    found.focus();
                }
            });
        },
        // Cancel, or Esc: the card closes as it was saved
        card_cancel: function () {
            if (this.busy) {
                return;
            }
            const id = this.open;
            this.model.name = this.original.name || '';
            this.model.title = this.original.title || '';
            this.model.token = this.original.token || '';
            this.kind_pick = this.kind;
            this.open = '';
            this.report('', false);
            this.$nextTick(function () {
                const found = (id === '') ? null : this.$el.querySelector(`#rf-${id} .list-right button`);
                if (found !== null) {
                    found.focus();
                }
            });
        },
        card_save: async function () {
            if (this.save_ok === false) {
                return;
            }
            if (this.open === 'kind') {
                await this.kind_save();
                return;
            }
            await this.entry_save();
        },
        // Another one on the card at rest: Access opens with a new token, saved only by its Save
        access_another: function () {
            this.card_open('access');
            this.model.token = token_make();
        },
        // Drawn as another kind: kept for the Canvas on every page; it is not the config's, so
        // nothing reloads
        kind_save: async function () {
            this.busy = true;
            this.report('', false);
            try {
                const answer = await fetch(`/api/v1/canvas/machines/${encodeURIComponent(this.original.name)}`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({kind: this.kind_pick})});
                if (answer.ok === false) {
                    this.report((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`, true);
                    return;
                }
                this.kind = this.kind_pick;
                this.open = '';
            }
            catch {
                this.report('the answer never came back: Save again', true);
            }
            finally {
                this.busy = false;
            }
        },
        line_copy: async function (index) {
            if (await to_clipboard(this.lines[index].text)) {
                this.copied_line = index;
                setTimeout(this.copied_forget, 1500);
                return;
            }
            this.report('the clipboard would not take it', true);
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
            this.copied_line = null;
        },
        // The open card's Save for its name, title or token: the page reads the entry again once
        // it is kept, and the card stands closed with what it now says
        entry_save: async function () {
            this.busy = true;
            this.report('', false);
            try {
                // The entry the config file has, changed where this card changed it: its log
                // folders, and whatever else this form does not show, stay as they were
                const written = json_from_remote(this.model);
                const remote = entry_from_form(this.original, this.seen, written, {});
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.original.name)}`, {method: 'PUT', body: JSON.stringify({remote})});
                const outcome = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    this.report(outcome.error || `serviceman answered ${answer.status}`, true);
                    return;
                }
                this.$emit('saved', this.model.name);
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

// A kind as the cards say it: 'home' is a home computer
function kind_label(kind)
{
    const found = KINDS.find(v => (v.kind === kind));
    return (found === undefined) ? kind : found.label;
}

// The same thing openssl rand -hex 32 gives you, made here so the token never travels
function token_make()
{
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    return Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('');
}

export default remote_form;
