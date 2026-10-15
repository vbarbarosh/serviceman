import volumes from 'volumes/volumes.js';

// What survives a restart, and where it lives. There is no register apart from the services: a
// thing is kept because a service keeps it, and it is on the one machine that service runs on —
// which is why a service that keeps something may name one machine and no more.
const volumes_pane = {
    template: `
<article id="detail" class="list">
    <div class="list-head">
        <h1>Storage</h1>
        <span class="muted">{{ volumes.length }}</span>
    </div>
    <p class="muted">Folders that survive a restart. A folder lives on one machine, so the service that keeps it runs there only. A service's own settings are where a path is added.</p>
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="filter by folder, service, machine" spellcheck="false">
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="$emit('only', (chip.value === '' ? null : chip.value))">
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
    </div>
    <ul class="fold-list">
        <li v-for="item of rows" :key="key_of(item)" :class="{open: is_open(item)}">
            <button type="button" class="fold-line" :aria-expanded="is_open(item)" @click="toggle(item)">
                <svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
                <b class="name" :title="item.name">{{ item.name }}</b>
                <span class="route muted" :title="users_text(item)">{{ users_text(item) }}</span>
                <span class="word muted" :title="remote_title(item.machine)">{{ remote_title(item.machine) }}</span>
            </button>
            <div v-if="is_open(item)" class="fold-details">
                <dl>
                    <dt>Folder</dt>
                    <dd><code>{{ item.name }}</code></dd>
                    <dt>Kind</dt>
                    <dd>{{ kind_text(item) }}</dd>
                    <dt>On</dt>
                    <dd><button type="button" class="link" @click="$emit('remote', item.machine)">{{ remote_title(item.machine) }}</button></dd>
                    <dt>Kept for</dt>
                    <dd v-if="(item.used_by.length === 0)" class="muted">no service keeps it now</dd>
                    <dd v-else>
                        <div v-for="user of item.used_by" :key="(user.service + user.at)">
                            <button type="button" class="link" @click="$emit('select', user.service)">{{ user.service }}</button>
                            <span class="muted"> at <code>{{ user.at }}</code>{{ user.readonly ? ' · read only' : '' }}</span>
                        </div>
                    </dd>
                </dl>
            </div>
        </li>
        <li v-if="(rows.length === 0)" class="muted empty">{{ volumes.length === 0 ? 'Nothing is kept yet.' : 'Nothing matches.' }}</li>
    </ul>
    <volumes :machines="volume_machines"/>
</article>
`,
    components: {volumes},
    // remote: the one machine the list is narrowed to, or null for all of them; the chips set it
    props: ['state', 'remote'],
    emits: ['only', 'remote', 'select'],
    data: function () {
        // `opened` is the folders whose details are shown, by machine and name
        return {
            volumes: [],
            filter: '',
            opened: {},
        };
    },
    computed: {
        show: function () {
            return (((this.remote === null) || (this.remote === undefined)) ? '' : this.remote);
        },
        chips: function () {
            const out = [{value: '', label: 'All remotes', count: this.volumes.length}];
            for (const remote of this.state.remotes) {
                const count = this.volumes.filter(v => v.machine === remote.name).length;
                if (count > 0) {
                    out.push({value: remote.name, label: (remote.title || remote.name), count});
                }
            }
            return out;
        },
        // The machines whose encrypted volumes the list shows: the one the chips chose, or all
        volume_machines: function () {
            const out = [];
            for (const remote of this.state.remotes) {
                if ((this.show !== '') && (remote.name !== this.show)) {
                    continue;
                }
                const machine = (remote.machine || {});
                out.push({name: remote.name, title: (remote.title || remote.name), base: `/api/v1/remotes/${encodeURIComponent(remote.name)}/volumes`, offline: (remote.phase !== 'online'), user: machine.user});
            }
            return out;
        },
        rows: function () {
            const wanted = this.filter.toLowerCase();
            const out = [];
            for (const item of this.volumes) {
                if ((this.show !== '') && (item.machine !== this.show)) {
                    continue;
                }
                const words = [item.name, item.machine, this.remote_title(item.machine)].concat(item.used_by.map(v => `${v.service} ${v.at}`)).join(' ').toLowerCase();
                if ((wanted !== '') && (words.includes(wanted) === false)) {
                    continue;
                }
                out.push(item);
            }
            return out;
        },
    },
    methods: {
        key_of: function (item) {
            return `${item.machine}/${item.name}`;
        },
        is_open: function (item) {
            return (this.opened[this.key_of(item)] === true);
        },
        toggle: function (item) {
            this.opened = Object.assign({}, this.opened, {[this.key_of(item)]: (this.is_open(item) === false)});
        },
        // Who keeps it, by name, for its one line; where each one mounts it is in the details
        users_text: function (item) {
            if (item.used_by.length === 0) {
                return 'kept for no service';
            }
            return `for ${item.used_by.map(v => v.service).join(', ')}`;
        },
        kind_text: function (item) {
            if (item.kind === 'kept') {
                return 'a folder under the agent';
            }
            return ((item.kind === 'volume') ? 'a docker volume' : 'a folder');
        },
        remote_title: function (name) {
            const found = this.state.remotes.find(v => v.name === name);
            return ((found === undefined) ? name : (found.title || found.name));
        },
        load: async function () {
            try {
                const answer = await fetch('/api/v1/volumes', {cache: 'no-store'});
                const body = await answer.json();
                this.volumes = body.volumes;
            }
            catch {
                this.volumes = [];
            }
        },
    },
    created: function () {
        this.load();
    },
};

export default volumes_pane;
