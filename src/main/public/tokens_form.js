import format_ms_ago from './format_ms_ago.js';
import to_clipboard from './to_clipboard.js';

// What each right lets a token do, in a few words
const RIGHTS_SAID = {
    status: 'its machines and what runs on them',
    metrics: 'the charts: CPU, memory, disk, network',
    processes: 'the process list',
    ports: 'the ports it listens on',
    disks: 'its disks and how full they are',
    packages: 'what is installed, and what waits to be',
    containers: 'its docker containers',
    files: 'the file manager, within the folders below and nothing above them',
    terminals: 'list, make, join and end its kept terminals: a shell on the machine',
};

// The tokens of the control door: each one for an agent or a program, with the machines it
// sees and what it may do with them. A token is shown once, when it is made; only its hash is
// kept, so a lost one is revoked and made again.
const tokens_form = {
    template: `
<article id="detail" class="form">
    <h1>Tokens</h1>
    <p class="muted">Each one lets an agent or a program do what you tick with the machines it names, through the control socket, with <code>Authorization: Bearer &lt;token&gt;</code>. It never touches the config, the secrets, the services or another machine. Yours, the owner's, is printed by <code>bin/owner-token</code>.</p>

    <dl v-if="(tokens.length > 0)">
        <template v-for="item of tokens" :key="item.id">
            <dt>{{ item.label }}</dt>
            <dd class="tk-row">
                <span class="muted">{{ item.remotes.length === 0 ? 'no machine' : item.remotes.join(', ') }} · {{ item.rights.join(', ') }}<template v-if="(item.folders.length > 0)"> in <code>{{ item.folders.join(', ') }}</code></template> · {{ used_text(item) }}</span>
                <template v-if="(going !== item.id)">
                    <button type="button" @click="going = item.id">Revoke…</button>
                </template>
                <template v-else>
                    <span>Revoke {{ item.label }}? It stops working at once, and whoever uses it is refused.</span>
                    <button type="button" class="danger" :disabled="busy" @click="revoke(item)">Revoke</button>
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
        <label>Rights</label>
        <div class="tk-checks">
            <label v-for="right of rights" :key="right" class="check"><input type="checkbox" :value="right" v-model="rights_chosen"> <span><b>{{ right }}</b> {{ said_of(right) }}</span></label>
        </div>
        <template v-if="rights_chosen.includes('files')">
            <label for="tk-folders">Folders</label>
            <div>
                <textarea id="tk-folders" v-model="folders" rows="3" placeholder="~/visual-agency&#10;~/notes" spellcheck="false"></textarea>
                <p class="muted">One a line, the same on each of its machines; <code>~</code> is that machine's home. A folder not there yet is made when something is first written into it. A link inside that leads out is refused too.</p>
            </div>
        </template>
    </div>
    <div v-if="(made !== null)" class="tk-made">
        <p><b>{{ made.label }}</b>: copy it now, it is not shown again.</p>
        <div class="tk-made-row">
            <code>{{ made.token }}</code>
            <button type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
        </div>
    </div>
    <div class="actions">
        <button type="button" class="primary" :disabled="(busy || label === '' || rights_chosen.length === 0 || (rights_chosen.includes('files') && folders_list.length === 0))" @click="make">Make the token</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</article>
`,
    emits: [],
    data: function () {
        return {
            tokens: [],
            rights: [],
            remotes: [],
            label: '',
            remotes_chosen: [],
            rights_chosen: ['status'],
            folders: '',
            // The token just made, the one time it is shown: {label, token}
            made: null,
            copied: false,
            // The one whose "Revoke" has been pressed and not yet answered for
            going: '',
            busy: false,
            bad: false,
            note: '',
        };
    },
    computed: {
        folders_list: function () {
            return this.folders.split('\n').map(v => v.trim()).filter(v => (v !== ''));
        },
    },
    methods: {
        load: async function () {
            const answer = await fetch('/api/v1/tokens', {cache: 'no-store'});
            const body = await answer.json();
            this.tokens = body.tokens;
            this.rights = body.rights;
            this.remotes = body.remotes;
        },
        said_of: function (right) {
            return ((RIGHTS_SAID[right] === undefined) ? '' : RIGHTS_SAID[right]);
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
                const answer = await fetch('/api/v1/tokens', {method: 'POST', body: JSON.stringify({label: this.label, remotes: this.remotes_chosen, rights: this.rights_chosen, folders: this.folders_list})});
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
                this.folders = '';
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
                this.note = `${item.label} is revoked`;
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
