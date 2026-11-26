// A new app on a socket, in a small window over Apps: its name, where its program listens
// (serviceman's own data/ folder unless a machine is picked) and the socket file there. serviceman answers the app's address by passing every
// request into that file; nothing is started, the app is its own to run. Add sends it; Cancel,
// Esc or a click beside the window puts it away with nothing sent.
const app_socket_add = {
    template: `
<div class="dt-window" @click.self="close">
<div class="app-settings" role="dialog" aria-modal="true" aria-label="An app on a socket">
    <div class="app-settings-head">
        <h2>An app on a socket</h2>
        <button type="button" class="app-settings-x" title="Close: nothing is sent (Esc)" aria-label="Close" @click="close">×</button>
    </div>
    <div class="app-settings-body">
        <p class="muted app-settings-says">Your app listens on a socket file; serviceman answers the app's address by passing every request into that file.</p>
        <label class="app-settings-row">
            <span class="app-settings-label">Name</span>
            <input ref="name" v-model.trim="name" placeholder="agency" spellcheck="false" autocomplete="off" maxlength="63" :disabled="busy" @keyup.enter="add">
        </label>
        <p class="muted app-settings-says">opens at <code>{{ host }}</code></p>
        <label class="app-settings-row">
            <span class="app-settings-label">Its socket is</span>
            <select v-model="remote" :disabled="busy">
                <option value="">in serviceman's own {{ folder }}/ folder</option>
                <option v-for="item of machines" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
        </label>
        <label class="app-settings-row">
            <span class="app-settings-label">Socket</span>
            <input v-model.trim="socket" :placeholder="socket_default" spellcheck="false" autocomplete="off" :disabled="busy" @keyup.enter="add">
        </label>
        <p v-if="(remote === '')" class="muted app-settings-says">a file in serviceman's own <code>{{ folder }}/</code>, the folder <code>bin/run</code> gives its container: your app listens on it there</p>
        <p v-else class="muted app-settings-says">the file your app listens on{{ (remote ? ', on ' + remote : '') }}; <code>~</code> is the home of the user its agent runs as</p>
    </div>
    <div class="app-settings-foot">
        <button type="button" class="primary" :disabled="(busy || (name === ''))" @click="add">{{ (busy ? 'Adding…' : 'Add') }}</button>
        <button type="button" :disabled="busy" @click="close">Cancel</button>
        <span class="app-settings-note" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</div>
</div>
`,
    emits: ['close', 'made'],
    props: {
        // Every machine; the names every service has; the part of an app's name after its own,
        // beside serviceman's (localhost); the folder serviceman keeps its own things in (data)
        remotes: {type: Array, required: true},
        names: {type: Array, required: true},
        suffix: {type: String, required: true},
        folder: {type: String, required: true},
    },
    data: function () {
        // remote: '' for serviceman's own data/ folder, where a new one starts, or a machine
        return {name: '', remote: '', socket: '', busy: false, note: '', bad: false};
    },
    computed: {
        machines: function () {
            return this.remotes.map(v => ({value: v.name, label: `on ${v.title || v.name}` + ((v.phase === 'online') ? '' : ' (offline)')}));
        },
        label: function () {
            return (this.name === '') ? 'name' : this.name.replace(/_/g, '-');
        },
        host: function () {
            return `${this.label}.${this.suffix}`;
        },
        // In serviceman's own folder on its side, in the agent's home on a machine
        socket_default: function () {
            return (this.remote === '') ? `${this.folder}/sockets/${this.label}.sock` : `~/${this.label}.sock`;
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
            if (this.busy || (this.name === '')) {
                return;
            }
            if (this.names.includes(this.name)) {
                this.note = `${this.name} is taken: pick another name`;
                this.bad = true;
                return;
            }
            const socket = (this.socket === '') ? this.socket_default : this.socket;
            this.busy = true;
            this.note = '';
            this.bad = false;
            try {
                const answer = await fetch(`/api/v1/apps/${encodeURIComponent(this.name)}/socket`, {method: 'PUT', body: JSON.stringify({socket, remote: this.remote})});
                const said = await answer.json().catch(() => ({}));
                if (answer.ok === false) {
                    throw new Error(said.error || `serviceman answered ${answer.status}`);
                }
                this.busy = false;
                this.$emit('made', Object.assign({}, said, {socket, remote: this.remote}));
            }
            catch (error) {
                this.busy = false;
                this.note = error.message;
                this.bad = true;
            }
        },
    },
};

export default app_socket_add;
