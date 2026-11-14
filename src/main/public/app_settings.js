import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';

// The service a new public address is protected with unless another is picked: one called this
const WALL_NAME = 'authwall';

// An app's settings, in a small window over the Apps page: its name and its public addresses,
// and nothing more. One Save writes them: the name first, so the addresses are written for the
// name it has now (serviceman moves the ones it had with it); Cancel, Esc or a click beside the
// window puts it away with nothing written. The rest of the service is on its own page, linked
// at the foot.
const app_settings = {
    template: `
<div class="dt-window" @click.self="close">
<div class="app-settings" role="dialog" aria-modal="true" :aria-label="('Settings of ' + app.name)">
    <div class="app-settings-head">
        <h2>{{ app.title || app.name }}</h2>
        <button type="button" class="app-settings-x" title="Close: nothing is written (Esc)" aria-label="Close" @click="close">×</button>
    </div>
    <label class="app-settings-row">
        <span class="app-settings-label">Name</span>
        <input ref="name" v-model.trim="name" spellcheck="false" autocomplete="off" maxlength="63" :disabled="busy" @keyup.enter="save">
    </label>
    <p class="muted app-settings-says">opens at <code>{{ host_after }}</code></p>
    <div class="app-settings-row">
        <span class="app-settings-label">Public address</span>
        <div class="app-pub">
            <ul v-if="(kept.length > 0)" class="app-pub-list">
                <li v-for="row of kept" :key="(row.machine + ' ' + row.host)">
                    <span class="app-pub-what"><a :href="('https://' + row.host)" target="_blank" rel="noopener"><code>{{ row.host }}</code></a> <span class="muted">through {{ row.title }}{{ (row.auth === null ? '' : ' · behind ' + row.auth) }}{{ (row.off ? ' · set aside' : '') }}</span></span>
                    <button type="button" class="app-pub-drop" :disabled="busy" :title="('Take ' + row.host + ' away when you save')" @click="drop(row)">remove</button>
                </li>
            </ul>
            <p v-for="row of by_domain" :key="(row.machine + ' ' + row.host)" class="muted app-pub-also">also <code>{{ row.host }}</code> through {{ row.title }}, as every app under <code>{{ row.pattern }}</code></p>
            <input v-model.trim="fresh.host" class="app-pub-host" placeholder="name.example.com" spellcheck="false" autocomplete="off" aria-label="A new public address" :disabled="busy" @keyup.enter="save">
            <div v-if="(fresh.host !== '')" class="app-pub-how">
                <select v-model="fresh.machine" aria-label="Through the door of" :disabled="busy">
                    <option value="">through the door of…</option>
                    <option v-for="item of machines" :key="item.value" :value="item.value">through {{ item.label }}</option>
                </select>
                <select v-model="fresh.auth" aria-label="Protected by" :disabled="busy">
                    <option value="">protected by nothing</option>
                    <option v-for="item of walls" :key="item" :value="item">protected by {{ item }}</option>
                </select>
            </div>
        </div>
    </div>
    <div class="app-settings-foot">
        <button type="button" class="primary" :disabled="(busy || (changed === false))" @click="save">{{ (busy ? 'Saving…' : 'Save') }}</button>
        <button type="button" :disabled="busy" @click="close">Cancel</button>
        <span class="app-settings-note" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        <a class="app-settings-more" :href="('/services/' + encodeURIComponent(current))" @click.prevent="$emit('more', current)">its service page</a>
    </div>
</div>
</div>
`,
    emits: ['close', 'saved', 'more'],
    props: {
        app: {type: Object, required: true},
        // Every machine, with the door rules of each (inbound); the names of every service
        remotes: {type: Array, required: true},
        names: {type: Array, required: true},
        host: {type: String, required: true},
    },
    data: function () {
        // current: its name in the config, the new one once a rename is in (a Save that stopped
        // after it does not rename twice); gone: the public addresses taken away, written on Save
        return {name: this.app.name, current: this.app.name, gone: [], fresh: {host: '', machine: '', auth: ''}, busy: false, note: '', bad: false};
    },
    computed: {
        // Every name a machine's door answers for this app, by a rule of its own
        rules: function () {
            const out = [];
            for (const item of this.remotes) {
                const inbound = ((item.inbound === undefined) || (item.inbound === null)) ? {} : item.inbound;
                for (const host of Object.keys(inbound)) {
                    const rule = (typeof inbound[host] === 'string') ? {service: inbound[host]} : inbound[host];
                    if ((rule.service === this.app.name) || (rule.service === this.current)) {
                        out.push({machine: item.name, title: item.title || item.name, host, off: (rule.off === true), auth: ((rule.auth === undefined) || (rule.auth === null)) ? null : rule.auth});
                    }
                }
            }
            return out;
        },
        kept: function () {
            return this.rules.filter(v => this.gone.includes(v) === false);
        },
        // The names a door's rule of "*" gives this app: its own addresses under that rule's
        // pattern. That rule is every app's, so it is said here and changed on Doors.
        by_domain: function () {
            const out = [];
            const own = this.app.publish.hosts.map(v => v.split('/')[0]);
            for (const item of this.remotes) {
                const inbound = ((item.inbound === undefined) || (item.inbound === null)) ? {} : item.inbound;
                for (const pattern of Object.keys(inbound)) {
                    const rule = (typeof inbound[pattern] === 'string') ? {service: inbound[pattern]} : inbound[pattern];
                    if (rule.service !== '*') {
                        continue;
                    }
                    for (const host of own.filter(v => (v === pattern) || (pattern.startsWith('*.') && v.endsWith(pattern.slice(1)) && (v.length > pattern.length - 1)))) {
                        out.push({machine: item.name, title: item.title || item.name, pattern, host});
                    }
                }
            }
            return out;
        },
        // Its address once the new name is saved: one made of its name follows it
        host_after: function () {
            const old_label = this.app.name.replace(/_/g, '-');
            const new_label = this.name.replace(/_/g, '-');
            return ((new_label !== '') && this.host.startsWith(`${old_label}.`)) ? `${new_label}${this.host.slice(old_label.length)}` : this.host;
        },
        machines: function () {
            return this.remotes.map(v => ({value: v.name, label: v.title || v.name}));
        },
        // Any other service may stand in front; the one called authwall first
        walls: function () {
            const others = this.names.filter(v => v !== this.app.name);
            return others.filter(v => v === WALL_NAME).concat(others.filter(v => v !== WALL_NAME));
        },
        fresh_host: function () {
            return this.fresh.host.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
        },
        changed: function () {
            return (this.name !== this.current) || (this.gone.length > 0) || (this.fresh_host !== '');
        },
    },
    watch: {
        // A new address goes through the door that answers most names already, the one that is the
        // front of these machines, and behind authwall where there is one
        'fresh.host': function (now, was) {
            if ((was === '') && (now !== '') && (this.fresh.machine === '')) {
                this.fresh.machine = front_of(this.remotes);
                this.fresh.auth = this.walls.includes(WALL_NAME) ? WALL_NAME : '';
            }
        },
    },
    // Esc puts the window away, wherever the focus went, while nothing is being written
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
        drop: function (row) {
            this.gone.push(row);
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        save: async function () {
            if ((this.changed === false) || this.busy) {
                return;
            }
            const host = this.fresh_host;
            if ((host !== '') && ((/^[a-z0-9*][a-z0-9.-]*\.[a-z0-9-]+$/.test(host) === false) || (this.fresh.machine === ''))) {
                this.report((this.fresh.machine === '') ? 'Pick the machine whose door answers the address.' : `${host} is no address: a name such as notes.example.com`, true);
                return;
            }
            this.busy = true;
            this.report('', false);
            const name = this.name;
            try {
                if (name !== this.current) {
                    await this.rename(name);
                    this.current = name;
                }
                // The rules each machine loses and gains, written machine by machine
                const machines = new Set(this.gone.map(v => v.machine));
                if (host !== '') {
                    machines.add(this.fresh.machine);
                }
                for (const machine of machines) {
                    const gone = this.gone.filter(v => v.machine === machine).map(v => v.host);
                    const fresh = this.fresh;
                    const problem = await door_rules_write(machine, function (inbound) {
                        for (const item of gone) {
                            delete inbound[item];
                        }
                        if ((host !== '') && (fresh.machine === machine)) {
                            inbound[host] = door_rule_value(name, false, fresh.auth);
                        }
                    });
                    if (problem !== null) {
                        throw new Error(problem);
                    }
                }
            }
            catch (error) {
                this.busy = false;
                this.report(error.message, true);
                this.$emit('saved', null);
                return;
            }
            this.busy = false;
            this.$emit('saved', name);
            this.$emit('close');
        },
        // The service as the config has it, under its new name: serviceman moves its files, the
        // address made of its name, its door rules, its secrets and its tokens with it
        rename: async function (name) {
            const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
            const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === this.current);
            if (entry === undefined) {
                throw new Error(`${this.current} is not in the config any more`);
            }
            const answer = await fetch(`/api/v1/services/${encodeURIComponent(this.current)}`, {method: 'PUT', body: JSON.stringify({service: Object.assign({}, entry, {name})})});
            if (answer.ok === false) {
                throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
            }
        },
    },
};

// The machine whose door answers the most names: the front of the others
function front_of(remotes)
{
    let out = '';
    let most = -1;
    for (const item of remotes) {
        const count = Object.keys(((item.inbound === undefined) || (item.inbound === null)) ? {} : item.inbound).length;
        if (count > most) {
            out = item.name;
            most = count;
        }
    }
    return out;
}

export default app_settings;
