import data_table from './data_table.js';

// How often an open pane asks how the mounts stand: a mount on its way lands within seconds
const REFRESH_MS = 5000;
// What each state of a mount is called, and its dot
const STATES = {
    mounted: {label: 'mounted', dot: 'running'},
    telling: {label: 'on its way', dot: 'starting'},
    waiting: {label: 'waiting', dot: ''},
    busy: {label: 'in use', dot: 'stopping'},
    unmounted: {label: 'not mounted', dot: ''},
    not_empty: {label: 'not empty', dot: 'failed'},
    taken: {label: 'path taken', dot: 'failed'},
    cannot: {label: 'cannot mount', dot: 'failed'},
    gone: {label: 'no such machine', dot: 'failed'},
    error: {label: 'failed', dot: 'failed'},
};

// Shared folders: one folder, the same on every machine that mounts it, at a path of that
// machine's own, read-write or read-only. Their home is one VPS, where Redis keeps the names and
// Garage the bytes; each machine mounts them with juicefs, through its root half, and encrypts
// the bytes before they leave it. A change shows at once, marked on its way, until the machine
// says how it stands.
const shared_folders_pane = {
    template: `
<article id="detail" class="list shared-folders">
    <div class="list-head">
        <h1>Shared folders</h1>
        <span class="muted">{{ folders_count }}</span>
        <div class="list-acts">
            <button v-if="home_ready" type="button" class="primary" :disabled="(folder_form !== null)" @click="folder_form_begin">+ New folder</button>
        </div>
    </div>
    <p class="muted">A folder that is the same on every machine that mounts it, each at a path of its own, read-write or read-only. The files are encrypted on each machine before they leave it; their names stay in Redis on the home.</p>
    <div class="card sf-card sf-home">
        <template v-if="(view === null)">
            <p class="muted">{{ (load_error === '') ? 'reading…' : load_error }}</p>
        </template>
        <template v-else-if="((home === null) || (home.phase === 'failed'))">
            <p v-if="(home === null)">Shared folders need a home: one of your VPSes, where Redis keeps the names and Garage keeps the bytes, both in docker, reached over the tailnet.</p>
            <p v-else class="bad">Setting up the home on {{ home.title }} failed: {{ home.error }}</p>
            <div class="row-of sf-pick">
                <select v-model="home_pick" aria-label="The machine to be the home">
                    <option v-for="item of home_options" :key="item.value" :value="item.value" :disabled="item.disabled">{{ item.label }}</option>
                </select>
                <button type="button" class="primary" :disabled="((home_pick === '') || busy)" @click="home_set">{{ (home === null) ? 'Set up the home' : 'Try again' }}</button>
            </div>
            <p v-if="(home_options.every(v => v.disabled))" class="muted">No machine can be the home yet: it needs to be online, with docker, the agent's root half and a tailnet address.</p>
        </template>
        <template v-else-if="(home.phase === 'setting_up')">
            <div class="row-of svc-state">
                <span class="pill starting">setting up on {{ home.title }}</span>
                <span class="muted">pulling Redis and Garage, starting them, making the encrypted volume; a few minutes the first time</span>
            </div>
        </template>
        <dl v-else>
            <dt>Home</dt>
            <dd class="row-of">
                <span class="dot" :class="(home.online ? 'running' : 'failed')"/>
                <button type="button" class="link" @click="$emit('remote', home.remote)">{{ home.title }}</button>
                <span class="muted">{{ home.online ? '' : 'offline: folders stay mounted, but nothing new can be made' }}</span>
            </dd>
            <dt>Reached at</dt>
            <dd><code>{{ home.address }}</code><span class="muted"> · Redis :{{ home.redis_port }} · Garage :{{ home.s3_port }} · the tailnet only</span></dd>
            <dt>Encrypted</dt>
            <dd>the bytes, AES-256-GCM, on each machine before they leave it</dd>
        </dl>
    </div>
    <div v-if="(folder_form !== null)" class="card sf-card">
        <div class="row-of sf-form">
            <input ref="folder_name" v-model.trim="folder_form.name" placeholder="media" spellcheck="false" aria-label="The new folder's name" @keydown.enter="folder_create">
            <button type="button" class="primary" :disabled="busy" @click="folder_create">Make it</button>
            <button type="button" :disabled="busy" @click="folder_form = null">Cancel</button>
            <span class="muted">small letters, digits and hyphens</span>
        </div>
    </div>
    <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</p>
    <p v-if="(home_ready && (folders.length === 0) && (folder_form === null))" class="muted">No folders yet — <button type="button" class="link" @click="folder_form_begin">make the first one</button>.</p>
    <section v-for="folder of folders" :key="folder.name" class="sf-folder">
        <div class="list-head sf-head">
            <h2>
                <svg class="sf-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>
                {{ folder.name }}
            </h2>
            <span class="muted">{{ mounted_text(folder) }}</span>
            <div class="list-acts">
                <button type="button" :disabled="((mount_form !== null) || (machines_free(folder).length === 0))" :title="((machines_free(folder).length === 0) ? 'mounted on every machine already' : '')" @click="mount_form_begin(folder, null)">Mount on a machine…</button>
                <button type="button" :disabled="(folder.mounts.length > 0)" :title="((folder.mounts.length > 0) ? 'unmount it everywhere first' : '')" @click="delete_begin(folder)">Delete…</button>
            </div>
        </div>
        <div v-if="((delete_form !== null) && (delete_form.folder === folder.name))" class="card sf-card sf-delete">
            <p>Deleting <b>{{ folder.name }}</b> deletes every file in it. juicefs keeps them in its trash for a day, and then they are gone. Type its name to go on:</p>
            <div class="row-of sf-form">
                <input ref="delete_name" v-model.trim="delete_form.typed" :placeholder="folder.name" spellcheck="false" aria-label="The folder's name, typed again" @keydown.enter="folder_delete">
                <button type="button" class="danger" :disabled="((delete_form.typed !== folder.name) || busy)" @click="folder_delete">Delete {{ folder.name }}</button>
                <button type="button" :disabled="busy" @click="delete_form = null">Cancel</button>
            </div>
        </div>
        <div v-if="((mount_form !== null) && (mount_form.folder === folder.name))" class="card sf-card">
            <div class="row-of sf-form">
                <select v-model="mount_form.remote" :disabled="(mount_form.original !== null)" aria-label="The machine">
                    <option v-for="item of mount_options(folder)" :key="item.value" :value="item.value" :disabled="item.disabled">{{ item.label }}</option>
                </select>
                <input v-model.trim="mount_form.path" class="sf-path" placeholder="/srv/media" spellcheck="false" aria-label="The path on that machine" @keydown.enter="mount_save">
                <span class="sf-modes" role="group" aria-label="Mode">
                    <button type="button" class="chip" :class="{on: (mount_form.mode === 'rw')}" @click="mount_form.mode = 'rw'">read-write</button>
                    <button type="button" class="chip" :class="{on: (mount_form.mode === 'ro')}" @click="mount_form.mode = 'ro'">read-only</button>
                </span>
                <button type="button" class="primary" :disabled="((mount_form.remote === '') || (mount_form.path === '') || busy)" @click="mount_save">{{ (mount_form.original === null) ? 'Mount' : 'Save' }}</button>
                <button type="button" :disabled="busy" @click="mount_form = null">Cancel</button>
            </div>
            <p class="muted">A path that holds files is refused: the folder mounted there would hide them.</p>
        </div>
        <data-table :columns="columns" :rows="folder.mounts" :row_key="v => v.remote" :more="cell_more" actions_label="" empty="Not mounted anywhere yet.">
            <template #cell="{row, column}">
                <button v-if="(column.key === 'machine')" type="button" class="link" @click="$emit('remote', row.remote)">{{ row.title }}</button>
                <code v-else-if="(column.key === 'path')" :title="row.path">{{ row.path }}</code>
                <span v-else-if="(column.key === 'mode')" class="pill" :class="{running: (row.mode === 'rw')}">{{ (row.mode === 'rw') ? 'read-write' : 'read-only' }}</span>
                <span v-else-if="(column.key === 'state')" class="dt-state">
                    <span class="dot" :class="state_of(row).dot"/>
                    <span :class="{bad: (state_of(row).dot === 'failed')}">{{ state_label(row) }}</span>
                </span>
            </template>
            <template #below="{row}">
                <div v-if="(why_of(row) !== '')" class="sf-why" :class="((state_of(row).dot === 'failed') ? 'sf-why-bad' : 'muted')">{{ why_of(row) }}</div>
            </template>
            <template #actions="{row}">
                <button type="button" :disabled="((mount_form !== null) || (row.pending === true))" @click="mount_form_begin(folder, row)">Change</button>
                <button type="button" :disabled="(row.pending === true)" @click="mount_remove(folder, row)">Unmount</button>
            </template>
        </data-table>
    </section>
</article>
`,
    components: {'data-table': data_table},
    props: ['state'],
    emits: ['remote', 'changed'],
    data: function () {
        return {
            view: null,
            load_error: '',
            home_pick: '',
            folder_form: null,
            mount_form: null,
            delete_form: null,
            // Changes sent and not answered yet, by folder and machine: shown at once, marked
            // on their way, until the answer replaces them
            pending: {},
            busy: false,
            note: '',
            bad: false,
            timer: null,
        };
    },
    computed: {
        home: function () {
            return (this.view === null) ? null : this.view.home;
        },
        home_ready: function () {
            return (this.home !== null) && (this.home.phase === 'ready');
        },
        folders_count: function () {
            return (this.view === null) ? '' : this.view.folders.length;
        },
        // The folders as the page shows them: what serviceman said, with what was sent since
        folders: function () {
            if (this.view === null) {
                return [];
            }
            const out = [];
            for (const folder of this.view.folders) {
                const mounts = folder.mounts.slice();
                for (const key of Object.keys(this.pending)) {
                    const change = this.pending[key];
                    if (change.folder !== folder.name) {
                        continue;
                    }
                    const at = mounts.findIndex(v => v.remote === change.remote);
                    if (change.removed) {
                        if (at !== -1) {
                            mounts[at] = Object.assign({}, mounts[at], {state: 'telling', pending: true, leaving: true});
                        }
                        continue;
                    }
                    const row = {remote: change.remote, title: this.title_of(change.remote), path: change.path, mode: change.mode, state: 'telling', pending: true};
                    if (at === -1) {
                        mounts.push(row);
                    }
                    else {
                        mounts[at] = row;
                    }
                }
                out.push({name: folder.name, created: folder.created, mounts});
            }
            return out;
        },
        columns: function () {
            return [
                {key: 'machine', label: 'Machine'},
                {key: 'path', label: 'Path on it', clip: true, fold: 2},
                {key: 'mode', label: 'Mode', fold: 1},
                {key: 'state', label: 'State'},
            ];
        },
        home_options: function () {
            const out = [{value: '', label: 'Pick a VPS…', disabled: true}];
            for (const item of this.view.machines) {
                out.push({value: item.name, label: (item.home_why === null) ? item.title : `${item.title} — ${item.home_why}`, disabled: (item.home_why !== null)});
            }
            return out;
        },
    },
    mounted: function () {
        this.refresh();
        const self = this;
        this.timer = setInterval(function () {
            self.refresh();
        }, REFRESH_MS);
    },
    unmounted: function () {
        clearInterval(this.timer);
    },
    methods: {
        refresh: async function () {
            try {
                const answer = await fetch('/api/v1/shared-folders', {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok === false) {
                    throw new Error(body.error || `serviceman answered ${answer.status}`);
                }
                this.view = body;
                this.load_error = '';
            }
            catch (error) {
                this.load_error = `serviceman did not answer: ${error.message}`;
            }
        },
        // One change sent: its answer is the new view, or a refusal said under the head
        send: async function (method, url, body) {
            this.busy = true;
            try {
                const answer = await fetch(url, {method, headers: {'content-type': 'application/json'}, body: (body === undefined) ? undefined : JSON.stringify(body)});
                const said = await answer.json();
                if (answer.ok === false) {
                    this.note = said.error || `serviceman answered ${answer.status}`;
                    this.bad = true;
                    return false;
                }
                this.note = '';
                this.bad = false;
                this.$emit('changed');
                return true;
            }
            catch (error) {
                this.note = `serviceman did not answer: ${error.message}`;
                this.bad = true;
                return false;
            }
            finally {
                this.busy = false;
            }
        },
        home_set: async function () {
            if (await this.send('POST', '/api/v1/shared-folders/home', {remote: this.home_pick})) {
                await this.refresh();
            }
        },
        folder_form_begin: function () {
            this.folder_form = {name: ''};
            const self = this;
            this.$nextTick(function () {
                self.$refs.folder_name.focus();
            });
        },
        folder_create: async function () {
            if (await this.send('POST', '/api/v1/shared-folders/folders', {name: this.folder_form.name})) {
                this.folder_form = null;
                await this.refresh();
            }
        },
        delete_begin: function (folder) {
            this.delete_form = {folder: folder.name, typed: ''};
            const self = this;
            this.$nextTick(function () {
                self.$refs.delete_name[0].focus();
            });
        },
        folder_delete: async function () {
            const name = this.delete_form.folder;
            if (this.delete_form.typed !== name) {
                return;
            }
            if (await this.send('DELETE', `/api/v1/shared-folders/folders/${encodeURIComponent(name)}`, {name: this.delete_form.typed})) {
                this.delete_form = null;
                await this.refresh();
            }
        },
        mount_form_begin: function (folder, row) {
            const free = this.machines_free(folder);
            this.mount_form = {
                folder: folder.name,
                original: (row === null) ? null : row.remote,
                remote: (row === null) ? ((free.length === 0) ? '' : free[0].name) : row.remote,
                path: (row === null) ? `/srv/${folder.name}` : row.path,
                mode: (row === null) ? 'rw' : row.mode,
            };
        },
        // Shown on its way at once; the answer brings the machine's own word on it
        mount_save: async function () {
            const form = this.mount_form;
            const key = `${form.folder}/${form.remote}`;
            this.pending = Object.assign({}, this.pending, {[key]: {folder: form.folder, remote: form.remote, path: form.path, mode: form.mode, removed: false}});
            this.mount_form = null;
            const ok = await this.send('PUT', `/api/v1/shared-folders/folders/${encodeURIComponent(form.folder)}/mounts/${encodeURIComponent(form.remote)}`, {path: form.path, mode: form.mode});
            if (ok) {
                await this.refresh();
            }
            else {
                this.mount_form = form;
            }
            this.pending_drop(key);
        },
        mount_remove: async function (folder, row) {
            const key = `${folder.name}/${row.remote}`;
            this.pending = Object.assign({}, this.pending, {[key]: {folder: folder.name, remote: row.remote, removed: true}});
            if (await this.send('DELETE', `/api/v1/shared-folders/folders/${encodeURIComponent(folder.name)}/mounts/${encodeURIComponent(row.remote)}`)) {
                await this.refresh();
            }
            this.pending_drop(key);
        },
        pending_drop: function (key) {
            const pending = Object.assign({}, this.pending);
            delete pending[key];
            this.pending = pending;
        },
        // The machines a folder is not mounted on yet
        machines_free: function (folder) {
            if (this.view === null) {
                return [];
            }
            return this.view.machines.filter(v => folder.mounts.some(vv => vv.remote === v.name) === false);
        },
        mount_options: function (folder) {
            const machines = (this.mount_form.original === null) ? this.machines_free(folder) : this.view.machines.filter(v => v.name === this.mount_form.original);
            const out = [];
            for (const item of machines) {
                // A machine that is away now is told when it comes back
                const why = ((item.mount_why === null) || (item.phase !== 'online')) ? null : item.mount_why;
                out.push({value: item.name, label: (why === null) ? item.title : `${item.title} — ${why}`, disabled: (why !== null)});
            }
            return out;
        },
        mounted_text: function (folder) {
            const count = folder.mounts.filter(v => v.state === 'mounted').length;
            if (folder.mounts.length === 0) {
                return 'on no machine';
            }
            return `mounted on ${count} of ${folder.mounts.length}`;
        },
        state_of: function (row) {
            return (STATES[row.state] === undefined) ? STATES.error : STATES[row.state];
        },
        state_label: function (row) {
            return (row.leaving === true) ? 'unmounting…' : this.state_of(row).label;
        },
        // What a state that is not plain mounted has to say, on a line of its own under the row:
        // what holds it, or why it was refused, as the machine said it
        why_of: function (row) {
            if ((row.leaving === true) || (row.state === 'mounted') || (row.state === 'telling')) {
                return '';
            }
            if ((row.state === 'busy') && Array.isArray(row.users) && (row.users.length > 0)) {
                const names = Array.from(new Set(row.users.map(v => v.command))).slice(0, 3).join(', ');
                const now = (row.now === 'ro') ? 'read-only' : 'read-write';
                return ((row.now === undefined) || (row.now === null)) ? `In use by ${names}: it changes once they let go.` : `In use by ${names}: still ${now}, and changed once they let go.`;
            }
            return ((row.error === undefined) || (row.error === null)) ? '' : row.error;
        },
        cell_more: function (row, key) {
            return (key === 'path') && (row.path.length > 40);
        },
        title_of: function (name) {
            const found = (this.view === null) ? undefined : this.view.machines.find(v => v.name === name);
            return (found === undefined) ? name : found.title;
        },
    },
};

export default shared_folders_pane;
