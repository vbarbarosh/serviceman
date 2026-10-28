import machine_drawing from './machine_drawing.js';
import settled from './settled.js';
import state_read from './state_read.js';

const TOKEN_BYTES = 32;

// How a machine may be drawn on the Canvas
const KINDS = [
    {kind: 'server', label: 'server'},
    {kind: 'laptop', label: 'laptop'},
    {kind: 'home', label: 'home computer'},
];

// Adding a machine that carries services, without touching the config text
const remote_form = {
    template: `
<article id="detail" class="form rf">
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
                    <input id="rf-token" v-model.trim="model.token" class="rf-token" spellcheck="false" autocomplete="off">
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
        <p class="muted">This host forgets {{ original.name }}. Whatever runs on that machine keeps running, and its agent keeps dialling until you stop it there.</p>
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
</article>
`,
    components: {'machine-drawing': machine_drawing},
    props: ['original'],
    emits: ['close', 'saved', 'service'],
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
            note: '',
            bad: false,
            busy: false,
            // Taking a machine away is asked for twice, the way taking a service away is
            removing: false,
            // The services keeping this machine, when it would not go
            blockers: [],
            copied: false,
        };
    },
    computed: {
        // A new token on a machine that exists locks its agent out until it is given the token
        token_changed: function () {
            return (this.original !== null) && (this.model.token !== (this.original.token || ''));
        },
    },
    methods: {
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
        click_copy: async function () {
            try {
                await navigator.clipboard.writeText(this.model.token);
                this.copied = true;
                setTimeout(this.copied_forget, 1500);
            }
            catch {
                this.report('the clipboard would not take it', true);
            }
        },
        copied_forget: function () {
            this.copied = false;
        },
        save: async function () {
            this.busy = true;
            try {
                const url = (this.original === null) ? '/api/v1/remotes' : `/api/v1/remotes/${encodeURIComponent(this.original.name)}`;
                const method = (this.original === null) ? 'POST' : 'PUT';
                const answer = await fetch(url, {method, body: JSON.stringify({remote: json_from_remote(this.model)})});
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
    mounted: function () {
        if (this.original !== null) {
            this.kind_read();
        }
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
