// A PHP file dropped on Apps, in a small window over it: its name and the machine it runs on.
// serviceman makes it an app folder of its own there, run in its PHP image by PHP's own server,
// every request going to the file; the first start on a machine makes that image, a minute or
// two. An Adminer is said so: its Data tab gives it the database it opens on. Run it sends it;
// Cancel, Esc or a click beside the window puts it away with nothing sent.
const RE_ADMINER = /\bnamespace\s+Adminer\s*;/;

const app_php_add = {
    template: `
<div class="dt-window" @click.self="close">
<div class="app-settings" role="dialog" aria-modal="true" aria-label="A PHP app">
    <div class="app-settings-head">
        <h2>A PHP app</h2>
        <button type="button" class="app-settings-x" title="Close: nothing is sent (Esc)" aria-label="Close" @click="close">×</button>
    </div>
    <div class="app-settings-body">
        <p class="muted app-settings-says"><code>{{ file.name }}</code> runs on a machine of yours, in PHP 8.4 with the drivers of MySQL and PostgreSQL; its first start there makes that image, a minute or two.</p>
        <p v-if="adminer" class="muted app-settings-says">It is Adminer: give it a database in its Data tab, and it opens on it, logged in, for whoever its wall lets in.</p>
        <label class="app-settings-row">
            <span class="app-settings-label">Name</span>
            <input ref="name" v-model.trim="name" placeholder="adminer" spellcheck="false" autocomplete="off" maxlength="63" :disabled="busy" @keyup.enter="add">
        </label>
        <p class="muted app-settings-says">opens at <code>{{ host }}</code></p>
        <label class="app-settings-row">
            <span class="app-settings-label">Runs on</span>
            <select v-model="remote" :disabled="busy">
                <option value="" disabled>Pick a machine…</option>
                <option v-for="item of machines" :key="item.value" :value="item.value" :disabled="item.disabled">{{ item.label }}</option>
            </select>
        </label>
        <p v-if="(machines.every(v => v.disabled))" class="muted app-settings-says">No machine can run it now: it needs one online, with docker.</p>
    </div>
    <div class="app-settings-foot">
        <button type="button" class="primary" :disabled="(busy || (name === '') || (remote === ''))" @click="add">{{ (busy ? 'Sending…' : 'Run it') }}</button>
        <button type="button" :disabled="busy" @click="close">Cancel</button>
        <span class="app-settings-note" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
</div>
</div>
`,
    emits: ['close', 'made'],
    props: {
        // The .php file dropped or picked; every machine; the names every service has; the part
        // of an app's name after its own, beside serviceman's (localhost); its name from the file
        file: {type: Object, required: true},
        remotes: {type: Array, required: true},
        names: {type: Array, required: true},
        suffix: {type: String, required: true},
        named: {type: String, required: true},
    },
    data: function () {
        // remote: the first machine that can run it, picked for you
        const free = this.remotes.find(v => (v.phase === 'online') && (v.machine !== null) && (v.machine !== undefined) && (v.machine.docker !== null));
        return {name: this.named, remote: (free === undefined) ? '' : free.name, adminer: false, busy: false, note: '', bad: false};
    },
    computed: {
        // A machine runs it online, with docker; the others are said, greyed
        machines: function () {
            return this.remotes.map(function (v) {
                let why = '';
                if (v.phase !== 'online') {
                    why = ' · offline';
                }
                else if ((v.machine === null) || (v.machine === undefined) || (v.machine.docker === null)) {
                    why = ' · no docker';
                }
                return {value: v.name, label: (v.title || v.name) + why, disabled: (why !== '')};
            });
        },
        host: function () {
            return `${(this.name === '') ? 'name' : this.name.replace(/_/g, '-')}.${this.suffix}`;
        },
    },
    // Esc puts the window away, wherever the focus went, while nothing is being sent
    mounted: async function () {
        const self = this;
        this.escape_listener = function (event) {
            if ((event.key === 'Escape') && (self.busy === false)) {
                self.close();
            }
        };
        document.addEventListener('keydown', this.escape_listener);
        this.$refs.name.focus();
        this.adminer = RE_ADMINER.test(await this.file.text());
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
            if (this.busy || (this.name === '') || (this.remote === '')) {
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
                const url = `/api/v1/apps/${encodeURIComponent(this.name)}/php?remote=${encodeURIComponent(this.remote)}&file=${encodeURIComponent(this.file.name)}`;
                const answer = await fetch(url, {method: 'PUT', body: this.file});
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

export default app_php_add;
