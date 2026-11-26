import app_data_tab from './app_data_tab.js';
import door_rule_value from './door_rule_value.js';
import door_rules_write from './door_rules_write.js';
import wall_select from './wall_select.js';

// The service a new public address is protected with unless another is picked: one called this
const WALL_NAME = 'authwall';

// An app's settings, in a small window over the Apps page, on two tabs. Settings: its name, its
// socket for an app on one, the wall it is behind, and its public addresses, and nothing more. One
// Save writes them: the name and the wall first, in one change of its service, so the addresses
// are written for the name it has now (serviceman moves the ones it had with it); Cancel, Esc or a
// click beside the window puts it away with nothing written. Data: what the app is given, each row
// one variable of its env, kept as it changes (app_data_tab.js). The rest of the service is on its
// own page, linked at the foot.
//
// Behind a wall, every visitor signs in before anything of the app answers, at every address it
// has: its own beside serviceman's, and every name a machine's door gives it. Each team may have
// a wall of its own; the list's last option opens the Authwall page to make one.
const app_settings = {
    template: `
<div class="dt-window" @click.self="close">
<div class="app-settings" :class="{wide: (tab === 'data')}" role="dialog" aria-modal="true" :aria-label="('Settings of ' + app.name)">
    <div class="app-settings-head">
        <h2>{{ app.title || app.name }}</h2>
        <button type="button" class="app-settings-x" :title="((tab === 'settings') ? 'Close: nothing is written (Esc)' : 'Close (Esc)')" aria-label="Close" @click="close">×</button>
    </div>
    <div class="tabs app-settings-tabs">
        <button type="button" class="tab" :class="{on: (tab === 'settings')}" @click="click_settings">Settings</button>
        <button type="button" class="tab" :class="{on: (tab === 'data')}" @click="click_data">Data</button>
    </div>
    <div class="app-settings-body">
        <template v-if="(tab === 'settings')">
            <label class="app-settings-row">
                <span class="app-settings-label">Name</span>
                <input ref="name" v-model.trim="name" spellcheck="false" autocomplete="off" maxlength="63" :disabled="busy" @keyup.enter="save">
            </label>
            <p class="muted app-settings-says">opens at <code>{{ host_after }}</code></p>
            <p v-if="(tailnet !== '')" class="muted app-settings-says">on every device of your tailnet at <a :href="tailnet" target="_blank" rel="noopener"><code>{{ tailnet }}</code></a><span v-if="(https_off !== null)" class="app-http-why"> · http only: {{ https_off.why }}</span></p>
            <div v-if="(app.socket !== null)" class="app-settings-row">
                <span class="app-settings-label">Socket</span>
                <div class="app-socket-how">
                    <select v-model="where" aria-label="Where its socket is" :disabled="busy">
                        <option value="">in serviceman's own {{ folder }}/ folder</option>
                        <option v-for="item of machines" :key="item.value" :value="item.value">on {{ item.label }}</option>
                    </select>
                    <input v-model.trim="socket" class="app-socket-path" :placeholder="socket_default" spellcheck="false" autocomplete="off" aria-label="The file its app listens on" :disabled="busy" @keyup.enter="save">
                </div>
            </div>
            <div class="app-settings-row">
                <span class="app-settings-label">Sign-in</span>
                <div class="app-wall-pick">
                    <wall-select v-model="pick" :walls="walls" :none="(from_apps ? ('as every app: behind ' + app.auth) : 'open: no sign-in')" :self="app.name" :disabled="busy" @create="$emit('walls')"/>
                    <p class="muted app-settings-says">{{ ((wall === null) ? 'anyone may open it' : 'every visitor signs in first, at every address') }}</p>
                </div>
            </div>
            <div class="app-settings-row">
                <span class="app-settings-label">Public address</span>
                <div class="app-pub">
                    <ul v-if="(kept.length > 0)" class="app-pub-list">
                        <li v-for="row of kept" :key="(row.machine + ' ' + row.host)">
                            <span class="app-pub-what"><a :href="('https://' + row.host)" target="_blank" rel="noopener"><code>{{ row.host }}</code></a> <span class="muted">through {{ row.title }}{{ (behind_of(row) === null ? '' : ' · behind ' + behind_of(row)) }}{{ (row.off ? ' · set aside' : '') }}</span></span>
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
                        <select v-if="(wall === null)" v-model="fresh.auth" aria-label="Protected by" :disabled="busy">
                            <option value="">protected by nothing</option>
                            <option v-for="item of guards" :key="item" :value="item">protected by {{ item }}</option>
                        </select>
                    </div>
                </div>
            </div>
        </template>
        <app-data-tab v-else :app="app" :host="host" @new_database="$emit('new_database', $event)"/>
    </div>
    <div class="app-settings-foot">
        <template v-if="(tab === 'settings')">
            <button type="button" class="primary" :disabled="(busy || (changed === false))" @click="save">{{ (busy ? 'Saving…' : 'Save') }}</button>
            <button type="button" :disabled="busy" @click="close">Cancel</button>
            <span class="app-settings-note" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
        </template>
        <template v-else>
            <button type="button" @click="close">Close</button>
            <span class="muted">each change kept as it is made</span>
        </template>
        <a class="app-settings-more" :href="('/services/' + encodeURIComponent(current))" @click.prevent="$emit('more', current)">its service page</a>
    </div>
</div>
</div>
`,
    components: {'app-data-tab': app_data_tab, 'wall-select': wall_select},
    emits: ['close', 'saved', 'more', 'new_database', 'walls'],
    props: {
        app: {type: Object, required: true},
        // Every machine, with the door rules of each (inbound); the names of every service
        remotes: {type: Array, required: true},
        names: {type: Array, required: true},
        host: {type: String, required: true},
        // Its own port on serviceman's tailnet name, https://serviceman.tail1234.ts.net:3400/, or ''
        tailnet: {type: String, default: ''},
        // Why that link is http, {why, fix, link}, as Health says it; null while it is https
        https_off: {type: Object, default: null},
        // The folder serviceman keeps its own things in, as its owner sees it: data
        folder: {type: String, required: true},
        // walls_of(state), for the Sign-in list
        walls: {type: Array, required: true},
    },
    data: function () {
        // current: its name in the config, the new one once a rename is in (a Save that stopped
        // after it does not rename twice); gone: the public addresses taken away, written on
        // Save; where and socket: an app on a socket's place and file, as its card says them
        const where = ((this.app.socket === null) || (this.app.remotes.length === 0)) ? '' : this.app.remotes[0];
        const socket = (this.app.socket === null) ? '' : this.app.socket_said;
        // pick: the wall of its own, as the list says it now, '' for none; one Apps puts in front
        // of every app is not its own, and is not written into it
        const pick = ((this.app.auth === null) || (this.app.auth === undefined) || (this.app.auth_from === 'apps')) ? '' : this.app.auth;
        return {tab: 'settings', name: this.app.name, current: this.app.name, gone: [], fresh: {host: '', machine: '', auth: ''}, where, socket, where_was: where, socket_was: socket, pick, pick_was: pick, busy: false, note: '', bad: false};
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
        // What may stand in front of a new address: any other service, the one called authwall
        // first
        guards: function () {
            const others = this.names.filter(v => v !== this.app.name);
            return others.filter(v => v === WALL_NAME).concat(others.filter(v => v !== WALL_NAME));
        },
        fresh_host: function () {
            return this.fresh.host.toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
        },
        socket_default: function () {
            return (this.where === '') ? `${this.folder}/sockets/${this.current}.sock` : `~/${this.current}.sock`;
        },
        socket_changed: function () {
            return (this.app.socket !== null) && ((this.where !== this.where_was) || (this.socket !== this.socket_was));
        },
        // The wall it will stand behind: its own pick, or else the one Apps puts in front of every
        // app; null for none
        wall: function () {
            if (this.pick !== '') {
                return this.pick;
            }
            return this.from_apps ? this.app.auth : null;
        },
        // Its wall is the one Apps puts in front of every app, not a box of its own
        from_apps: function () {
            return (this.app.auth_from === 'apps');
        },
        changed: function () {
            return (this.name !== this.current) || (this.pick !== this.pick_was) || (this.gone.length > 0) || (this.fresh_host !== '') || this.socket_changed;
        },
    },
    watch: {
        // A new address goes through the door that answers most names already, the one that is the
        // front of these machines, and behind authwall where there is one
        'fresh.host': function (now, was) {
            if ((was === '') && (now !== '') && (this.fresh.machine === '')) {
                this.fresh.machine = front_of(this.remotes);
                this.fresh.auth = this.guards.includes(WALL_NAME) ? WALL_NAME : '';
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
        click_settings: function () {
            this.tab = 'settings';
        },
        click_data: function () {
            this.tab = 'data';
        },
        close: function () {
            if (this.busy === false) {
                this.$emit('close');
            }
        },
        drop: function (row) {
            this.gone.push(row);
        },
        // The wall an address is behind as it will be: the app's own, or the one Apps puts in
        // front of every app, or else the address's own
        behind_of: function (row) {
            return (this.wall !== null) ? this.wall : row.auth;
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
                if ((name !== this.current) || (this.pick !== this.pick_was)) {
                    await this.service_write(name);
                    this.current = name;
                    this.pick_was = this.pick;
                }
                if (this.socket_changed) {
                    await this.socket_write();
                    this.where_was = this.where;
                    this.socket_was = this.socket;
                }
                // The rules each machine loses and gains, written machine by machine
                const machines = new Set(this.gone.map(v => v.machine));
                if (host !== '') {
                    machines.add(this.fresh.machine);
                }
                for (const machine of machines) {
                    const gone = this.gone.filter(v => v.machine === machine).map(v => v.host);
                    // Behind its own wall, a new address is behind it too, and stays so if the pick
                    // is cleared one day
                    const fresh = Object.assign({}, this.fresh, (this.pick !== '') ? {auth: this.pick} : {});
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
        // An app on a socket's new place or file, under the name it has now; one left empty is
        // the one named after it there
        socket_write: async function () {
            const socket = (this.socket === '') ? this.socket_default : this.socket;
            const answer = await fetch(`/api/v1/apps/${encodeURIComponent(this.current)}/socket`, {method: 'PUT', body: JSON.stringify({socket, remote: this.where})});
            if (answer.ok === false) {
                throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
            }
        },
        // The service as the config has it, under its new name and behind its wall or not: on a
        // rename serviceman moves its files, the address made of its name, its door rules, its
        // secrets and its tokens with it
        service_write: async function (name) {
            const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
            const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === this.current);
            if (entry === undefined) {
                throw new Error(`${this.current} is not in the config any more`);
            }
            const service = Object.assign({}, entry, {name});
            if (this.pick !== '') {
                service.auth = this.pick;
            }
            else {
                delete service.auth;
            }
            const answer = await fetch(`/api/v1/services/${encodeURIComponent(this.current)}`, {method: 'PUT', body: JSON.stringify({service})});
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
