import format_ms_ago from './format_ms_ago.js';
import to_clipboard from './to_clipboard.js';

// What each read lets a token see, in a few words
const READS_SAID = {
    status: 'its machines and what runs on them',
    metrics: 'the charts: CPU, memory, disk, network',
    processes: 'the process list',
    ports: 'the ports it listens on',
    disks: 'its disks and how full they are',
    packages: 'what is installed, and what waits to be',
    containers: 'its docker containers',
};

// The tokens of the control door: each one for an agent or a program that may read some
// machines and nothing else. A token is shown once, when it is made; only its hash is kept,
// so a lost one is taken back and made again.
const tokens_form = {
    template: `
<article id="detail" class="form">
    <h1>Tokens</h1>
    <p class="muted">Each one lets an agent or a program read the machines it names, through the control socket, with <code>Authorization: Bearer &lt;token&gt;</code>. It cannot start, stop or change anything, open a shell or read a secret. Yours, the owner's, is printed by <code>bin/owner-token</code>.</p>

    <dl v-if="(tokens.length > 0)">
        <template v-for="item of tokens" :key="item.id">
            <dt>{{ item.label }}</dt>
            <dd class="tk-row">
                <span class="muted">{{ item.remotes.length === 0 ? 'no machine' : item.remotes.join(', ') }} · {{ item.reads.join(', ') }} · {{ used_text(item) }}</span>
                <template v-if="(going !== item.id)">
                    <button type="button" @click="going = item.id">Take it back…</button>
                </template>
                <template v-else>
                    <span>Take {{ item.label }} back? It stops working at once.</span>
                    <button type="button" class="danger" :disabled="busy" @click="revoke(item)">Take it back</button>
                    <button type="button" @click="going = ''">Keep it</button>
                </template>
            </dd>
        </template>
    </dl>
    <p v-else class="muted">None yet.</p>

    <h2>A new token</h2>
    <div class="grid">
        <label for="tk-label">Label</label>
        <div><input id="tk-label" v-model.trim="label" placeholder="the agent of the notes project" spellcheck="false"></div>
        <label>Machines</label>
        <div class="tk-checks">
            <label v-for="name of remotes" :key="name" class="check"><input type="checkbox" :value="name" v-model="remotes_chosen"> {{ name }}</label>
            <span v-if="(remotes.length === 0)" class="muted">no machine yet</span>
        </div>
        <label>Reads</label>
        <div class="tk-checks">
            <label v-for="read of reads" :key="read" class="check"><input type="checkbox" :value="read" v-model="reads_chosen"> <span><b>{{ read }}</b> {{ said_of(read) }}</span></label>
        </div>
    </div>
    <div v-if="(made !== null)" class="tk-made">
        <p><b>{{ made.label }}</b>: copy it now, it is not shown again.</p>
        <div class="tk-made-row">
            <code>{{ made.token }}</code>
            <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
        </div>
    </div>
    <div class="actions">
        <button type="button" class="primary" :disabled="(busy || label === '' || reads_chosen.length === 0)" @click="make">Make the token</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</article>
`,
    emits: [],
    data: function () {
        return {
            tokens: [],
            reads: [],
            remotes: [],
            label: '',
            remotes_chosen: [],
            reads_chosen: ['status'],
            // The token just made, the one time it is shown: {label, token}
            made: null,
            copied: false,
            // The one whose "Take it back" has been pressed and not yet answered for
            going: '',
            busy: false,
            bad: false,
            note: '',
        };
    },
    methods: {
        load: async function () {
            const answer = await fetch('/api/v1/tokens', {cache: 'no-store'});
            const body = await answer.json();
            this.tokens = body.tokens;
            this.reads = body.reads;
            this.remotes = body.remotes;
        },
        said_of: function (read) {
            return ((READS_SAID[read] === undefined) ? '' : READS_SAID[read]);
        },
        used_text: function (item) {
            if (item.used_at === null) {
                return 'not used yet';
            }
            return `used ${format_ms_ago(Date.now() - Date.parse(item.used_at))}`;
        },
        make: async function () {
            this.busy = true;
            this.bad = false;
            this.note = '';
            this.made = null;
            try {
                const answer = await fetch('/api/v1/tokens', {method: 'POST', body: JSON.stringify({label: this.label, remotes: this.remotes_chosen, reads: this.reads_chosen})});
                const loaded = await answer.json();
                if (answer.ok === false) {
                    this.bad = true;
                    this.note = loaded.error;
                    return;
                }
                this.made = {label: loaded.item.label, token: loaded.token};
                this.copied = false;
                this.label = '';
                this.remotes_chosen = [];
                await this.load();
            }
            catch (error) {
                this.bad = true;
                this.note = error.message;
            }
            finally {
                this.busy = false;
            }
        },
        revoke: async function (item) {
            this.busy = true;
            this.bad = false;
            try {
                const answer = await fetch(`/api/v1/tokens/${item.id}`, {method: 'DELETE'});
                if (answer.ok === false) {
                    this.bad = true;
                    this.note = (await answer.json()).error;
                    return;
                }
                this.note = `${item.label} is taken back`;
                this.going = '';
                await this.load();
            }
            catch (error) {
                this.bad = true;
                this.note = error.message;
            }
            finally {
                this.busy = false;
            }
        },
        copy: async function () {
            this.copied = await to_clipboard(this.made.token);
        },
    },
    created: function () {
        this.load();
    },
};

export default tokens_form;
