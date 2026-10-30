import format_ms_ago from './format_ms_ago.js';
import to_clipboard from './to_clipboard.js';

// What each right lets a token do, in a few words
const RIGHTS_SAID = {
    status: 'its machines and what runs on them',
    metrics: 'the charts: CPU, memory, disk, network; the uptime by day',
    processes: 'the process list',
    ports: 'the ports it listens on',
    disks: 'its disks and how full they are',
    packages: 'what is installed, and what waits to be',
    containers: 'its docker containers',
    files: 'the file manager, within the folders below and nothing above them',
    terminals: 'list, make, join and end its kept terminals: a shell on the machine',
    versions: 'send a new version of an app folder on it, as a zip: curl -T app.zip',
    forwards: 'read and write the forwards between its machines: a way to what listens there, as ssh -L',
};

// The tokens of the control door: each one for an agent or a program, with the machines it
// sees and what it may do with them. A token is shown once, when it is made or given a new
// value by a rotation; only its hash is kept. What it may do is edited in place, the token
// staying the same.
const tokens_form = {
    template: `
<article id="detail" class="form">
    <h1>Tokens</h1>
    <p class="muted">Each one lets an agent or a program do what you tick with the machines it names, through the control socket, with <code>Authorization: Bearer &lt;token&gt;</code>. It never touches the secrets, another machine, the config but the forwards its forwards right writes between its machines, or a service but the one its versions right sends a new version to.</p>
    <p class="muted tk-row">
        <span>This page is signed in with the owner's token, which <code>bin/owner-token</code> prints.<template v-if="(owner_token_file !== null)"> Should it leak, delete <code>{{ owner_token_file }}</code> and restart serviceman: a new one is made, and every page signs in again.</template></span>
        <button type="button" @click="sign_out">Sign out</button>
    </p>

    <dl v-if="(tokens.length > 0)">
        <template v-for="item of tokens" :key="item.id">
            <dt>{{ item.label }}</dt>
            <dd class="tk-row">
                <span class="muted">{{ machines_text(item) }} · {{ item.rights.join(', ') }}<template v-if="(item.folders.length > 0)"> in <code>{{ item.folders.join(', ') }}</code></template><template v-if="(item.services.length > 0)"> of <code>{{ item.services.join(', ') }}</code></template> · {{ used_text(item) }}</span>
                <template v-if="(asking.id !== item.id)">
                    <button type="button" :disabled="busy" @click="edit_open(item)">Edit…</button>
                    <button type="button" :disabled="busy" @click="asking = {id: item.id, what: 'rotate'}">Rotate…</button>
                    <button type="button" :disabled="busy" @click="asking = {id: item.id, what: 'revoke'}">Revoke…</button>
                </template>
                <template v-else-if="(asking.what === 'rotate')">
                    <span>Rotate {{ item.label }}? It gets a new value with the same rights, and the one it has now stops working at once.</span>
                    <button type="button" class="primary" :disabled="busy" @click="rotate(item)">Rotate</button>
                    <button type="button" @click="asking = {id: '', what: ''}">Keep it</button>
                </template>
                <template v-else>
                    <span>Revoke {{ item.label }}? It stops working at once, and whoever uses it is refused.</span>
                    <button type="button" class="danger" :disabled="busy" @click="revoke(item)">Revoke</button>
                    <button type="button" @click="asking = {id: '', what: ''}">Keep it</button>
                </template>
            </dd>
        </template>
    </dl>
    <p v-else class="muted">None yet.</p>

    <h2 ref="form">{{ (editing === null) ? 'A new token' : ('Edit ' + editing.label) }}</h2>
    <p v-if="(editing !== null)" class="muted">The token stays the same: whoever holds it goes on with what is ticked here from the next request.</p>
    <div class="grid">
        <label for="tk-label">Label</label>
        <div><input id="tk-label" v-model.trim="label" placeholder="the agent of the notes project" spellcheck="false"></div>
        <label>Machines</label>
        <div class="tk-checks">
            <label class="check"><input type="checkbox" v-model="every"> <span><b>every machine</b> new ones too</span></label>
            <label v-for="name of remotes" :key="name" class="check" :class="{off: every}"><input type="checkbox" :value="name" v-model="remotes_chosen" :disabled="every"> {{ name }}</label>
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
        <template v-if="rights_chosen.includes('versions')">
            <label>Apps</label>
            <div class="tk-checks">
                <label v-for="name of services" :key="name" class="check"><input type="checkbox" :value="name" v-model="services_chosen"> {{ name }}</label>
                <span class="muted">{{ (services.length === 0) ? 'no app folder yet' : 'none ticked: every app folder on its machines' }}</span>
            </div>
        </template>
    </div>
    <div v-if="(made !== null)" class="tk-made">
        <p><b>{{ made.label }}</b>: copy it now, it is not shown again.</p>
        <div class="tk-made-row">
            <code>{{ made.token }}</code>
            <button type="button" @click="copy('token', made.token)">{{ (copied === 'token') ? 'Copied' : 'Copy' }}</button>
        </div>
        <p>For an agent's box, as its environment:</p>
        <div class="tk-made-row">
            <code>{{ env_line }}</code>
            <button type="button" @click="copy('env', env_line)">{{ (copied === 'env') ? 'Copied' : 'Copy' }}</button>
        </div>
        <p>To check it, on the machine serviceman runs on:</p>
        <div class="tk-made-row">
            <code>{{ check_line }}</code>
            <button type="button" @click="copy('check', check_line)">{{ (copied === 'check') ? 'Copied' : 'Copy' }}</button>
        </div>
    </div>
    <div class="actions">
        <button type="button" class="primary" :disabled="(busy || (ready === false))" @click="save">{{ (editing === null) ? 'Make the token' : 'Save the changes' }}</button>
        <button v-if="(editing !== null)" type="button" :disabled="busy" @click="form_reset">Cancel</button>
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
            // The app folders a versions right can be kept to
            services: [],
            socket: null,
            port: null,
            owner_token_file: null,
            // The token being changed, or null while the form makes a new one
            editing: null,
            label: '',
            every: false,
            remotes_chosen: [],
            rights_chosen: ['status'],
            folders: '',
            services_chosen: [],
            // The token just made or rotated, the one time it is shown: {label, token}
            made: null,
            copied: '',
            // The question a token's button asked and is not answered yet: {id, what}
            asking: {id: '', what: ''},
            busy: false,
            bad: false,
            note: '',
        };
    },
    computed: {
        folders_list: function () {
            return this.folders.split('\n').map(v => v.trim()).filter(v => (v !== ''));
        },
        ready: function () {
            return (this.label !== '') && (this.rights_chosen.length > 0) && ((this.rights_chosen.includes('files') === false) || (this.folders_list.length > 0));
        },
        env_line: function () {
            return `SERVICEMAN_TOKEN=${this.made.token}`;
        },
        // The status, asked through the socket when there is one, else the control port
        check_line: function () {
            const auth = `-H "Authorization: Bearer ${this.made.token}"`;
            if (this.socket !== null) {
                return `curl --unix-socket ${this.socket} ${auth} http://localhost/api/v1/status`;
            }
            return `curl ${auth} http://127.0.0.1:${this.port}/api/v1/status`;
        },
    },
    methods: {
        load: async function () {
            const answer = await fetch('/api/v1/tokens', {cache: 'no-store'});
            const body = await answer.json();
            this.tokens = body.tokens;
            this.rights = body.rights;
            this.remotes = body.remotes;
            this.services = body.services;
            this.socket = body.socket;
            this.port = body.port;
            this.owner_token_file = body.owner_token_file;
        },
        said_of: function (right) {
            return (RIGHTS_SAID[right] === undefined) ? '' : RIGHTS_SAID[right];
        },
        machines_text: function (item) {
            if (item.remotes.includes('*')) {
                return 'every machine';
            }
            return (item.remotes.length === 0) ? 'no machine' : item.remotes.join(', ');
        },
        used_text: function (item) {
            if (item.used_at === null) {
                return 'not used yet';
            }
            return `used ${format_ms_ago(Date.now() - Date.parse(item.used_at))}`;
        },
        // The form takes the token's fields, and the page goes to it
        edit_open: function (item) {
            this.editing = item;
            this.label = item.label;
            this.every = item.remotes.includes('*');
            this.remotes_chosen = item.remotes.filter(v => (v !== '*'));
            this.rights_chosen = item.rights.slice();
            this.folders = item.folders.join('\n');
            this.services_chosen = item.services.slice();
            this.made = null;
            this.note = '';
            this.bad = false;
            this.$nextTick(() => this.$refs.form.scrollIntoView({behavior: 'smooth', block: 'start'}));
        },
        form_reset: function () {
            this.editing = null;
            this.label = '';
            this.every = false;
            this.remotes_chosen = [];
            this.rights_chosen = ['status'];
            this.folders = '';
            this.services_chosen = [];
        },
        save: async function () {
            const body = {label: this.label, remotes: this.every ? ['*'] : this.remotes_chosen, rights: this.rights_chosen, folders: this.folders_list, services: this.services_chosen};
            const editing = this.editing;
            const loaded = await this.call((editing === null) ? '/api/v1/tokens' : `/api/v1/tokens/${editing.id}`, (editing === null) ? 'POST' : 'PUT', body);
            if (loaded === null) {
                return;
            }
            this.made = (editing === null) ? {label: loaded.item.label, token: loaded.token} : null;
            this.copied = '';
            this.note = (editing === null) ? '' : `${loaded.item.label} is saved`;
            this.form_reset();
            await this.load();
        },
        rotate: async function (item) {
            const loaded = await this.call(`/api/v1/tokens/${item.id}/rotate`, 'POST', null);
            if (loaded === null) {
                return;
            }
            this.asking = {id: '', what: ''};
            this.made = {label: loaded.item.label, token: loaded.token};
            this.copied = '';
            this.note = '';
            await this.load();
            this.$nextTick(() => this.$refs.form.scrollIntoView({behavior: 'smooth', block: 'start'}));
        },
        revoke: async function (item) {
            const loaded = await this.call(`/api/v1/tokens/${item.id}`, 'DELETE', null);
            if (loaded === null) {
                return;
            }
            this.asking = {id: '', what: ''};
            this.note = `${item.label} is revoked`;
            if ((this.editing !== null) && (this.editing.id === item.id)) {
                this.form_reset();
            }
            await this.load();
        },
        // One request of this page: its answer, or null with what went wrong said beside Save
        call: async function (url, method, body) {
            this.busy = true;
            this.bad = false;
            this.note = '';
            try {
                const answer = await fetch(url, (body === null) ? {method} : {method, body: JSON.stringify(body)});
                const loaded = await answer.json();
                if (answer.ok === false) {
                    this.bad = true;
                    this.note = loaded.error;
                    return null;
                }
                return loaded;
            }
            catch (error) {
                this.bad = true;
                this.note = error.message;
                return null;
            }
            finally {
                this.busy = false;
            }
        },
        copy: async function (what, text) {
            if (await to_clipboard(text)) {
                this.copied = what;
            }
        },
        sign_out: async function () {
            await fetch('/api/v1/session', {method: 'DELETE'});
            window.location.reload();
        },
    },
    created: function () {
        this.load();
    },
};

export default tokens_form;
