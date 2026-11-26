// A file browser, in a small window over Apps: serviceman's File Manager put on a machine of
// yours as an app of its own, over one folder there, a folder kept for it or one of that
// machine; it opens on that folder and never leaves it. Make it sends it; Cancel, Esc or a
// click beside the window puts it away with nothing sent.
const app_file_browser_add = {
    template: `
<div class="dt-window" @click.self="close">
<div class="app-settings" role="dialog" aria-modal="true" aria-label="A file browser">
    <div class="app-settings-head">
        <h2>A file browser</h2>
        <button type="button" class="app-settings-x" title="Close: nothing is sent (Esc)" aria-label="Close" @click="close">×</button>
    </div>
    <div class="app-settings-body">
        <p class="muted app-settings-says">serviceman's File Manager, on a machine of yours, over one folder there: it opens on it, and never leaves it.</p>
        <label class="app-settings-row">
            <span class="app-settings-label">Name</span>
            <input ref="name" v-model.trim="name" placeholder="files" spellcheck="false" autocomplete="off" maxlength="63" :disabled="busy" @keyup.enter="add">
        </label>
        <p class="muted app-settings-says">opens at <code>{{ host }}</code></p>
        <label class="app-settings-row">
            <span class="app-settings-label">Runs on</span>
            <select v-model="remote" :disabled="busy">
                <option value="" disabled>Pick a machine…</option>
                <option v-for="item of machines" :key="item.value" :value="item.value" :disabled="item.disabled">{{ item.label }}</option>
            </select>
        </label>
        <p v-if="(machines.every(v => v.disabled))" class="muted app-settings-says">No machine can run it now: it needs one online.</p>
        <label class="app-settings-row">
            <span class="app-settings-label">Its folder</span>
            <select v-model="from" :disabled="busy">
                <option value="kept">a folder kept for it</option>
                <option value="machine">a folder of the machine</option>
            </select>
        </label>
        <label v-if="(from === 'machine')" class="app-settings-row">
            <span class="app-settings-label">Path</span>
            <input v-model.trim="path" placeholder="/srv/photos" spellcheck="false" autocomplete="off" :disabled="busy" @keyup.enter="add">
        </label>
        <p class="muted app-settings-says">{{ folder_says }}</p>
        <p class="muted app-settings-says">Whoever opens it can read, change and delete everything in that folder: put it behind a wall in its Settings.</p>
    </div>
    <div class="app-settings-foot">
        <button type="button" class="primary" :disabled="(busy || (name === '') || (remote === '') || ((from === 'machine') && (path === '')))" @click="add">{{ (busy ? 'Sending…' : 'Make it') }}</button>
        <button type="button" :disabled="busy" @click="close">Cancel</button>
        <span class="app-settings-note" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</div>
</div>
`,
    emits: ['close', 'made'],
    props: {
        // Every machine; the names every service has; the part of an app's name after its own,
        // beside serviceman's (localhost)
        remotes: {type: Array, required: true},
        names: {type: Array, required: true},
        suffix: {type: String, required: true},
    },
    data: function () {
        // remote: the first machine online, picked for you; name: files, or files-2 when taken
        const free = this.remotes.find(v => v.phase === 'online');
        let name = 'files';
        for (let i = 2; this.names.includes(name); i++) {
            name = `files-${i}`;
        }
        return {name, remote: (free === undefined) ? '' : free.name, from: 'kept', path: '', busy: false, note: '', bad: false};
    },
    computed: {
        machines: function () {
            return this.remotes.map(v => ({value: v.name, label: (v.title || v.name) + ((v.phase === 'online') ? '' : ' · offline'), disabled: (v.phase !== 'online')}));
        },
        host: function () {
            return `${(this.name === '') ? 'name' : this.name.replace(/_/g, '-')}.${this.suffix}`;
        },
        folder_says: function () {
            if (this.from === 'kept') {
                return `a folder of its own in the agent's data/ on ${this.remote || 'that machine'}, made for it, which goes when the agent does`;
            }
            return 'a full path on that machine, made when it is not there; never one of the system\'s own';
        },
    },
    // Esc puts the window away, wherever the focus went, while nothing is being sent
    mounted: function () {
        const self = this;
        this.escape_listener = function (event) {
            if ((event.key === 'Escape') && (self.busy === false)) {
                self.close();
            }
        };
        document.addEventListener('keydown', this.escape_listener);
        this.$refs.name.focus();
    },
    unmounted: function () {
        document.removeEventListener('keydown', this.escape_listener);
    },
    methods: {
        close: function () {
            if (this.busy === false) {
                this.$emit('close');
            }
        },
        add: async function () {
            if (this.busy || (this.name === '') || (this.remote === '') || ((this.from === 'machine') && (this.path === ''))) {
                return;
            }
            if (this.names.includes(this.name)) {
                this.note = `${this.name} is taken: pick another name`;
                this.bad = true;
                return;
            }
            this.busy = true;
            this.note = '';
            this.bad = false;
            try {
                const body = {remote: this.remote, path: (this.from === 'kept') ? null : this.path};
                const answer = await fetch(`/api/v1/apps/${encodeURIComponent(this.name)}/file-browser`, {method: 'PUT', body: JSON.stringify(body)});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                this.busy = false;
                this.$emit('made', Object.assign({}, said, {remote: this.remote}));
            }
            catch (error) {
                this.busy = false;
                this.note = error.message;
                this.bad = true;
            }
        },
    },
};

export default app_file_browser_add;
