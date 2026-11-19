import CATEGORIES from './categories.js';
import data_table from './data_table.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import volumes from 'volumes/volumes.js';

// A folder's icon, the inside of a 24x24 stroked svg
const FOLDER_ICON = '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>';

// What survives a restart, and where it lives. There is no register apart from the services: a
// thing is kept because a service keeps it, and it is on the one machine that service runs on —
// which is why a service that keeps something may name one machine and no more.
const volumes_pane = {
    template: `
<article id="detail" class="list">
    <page-head category="storage" :count="volumes.length">
        <template #how>
            <p>Folders that survive a restart. A folder lives on one machine, so the service that keeps it runs there only. A service's own settings are where a path is added.</p>
        </template>
    </page-head>
    <data-table :columns="columns" :rows="rows" :row_key="row_key" framed title="Folders kept" :total="volumes.length" :foot="foot" :empty_icon="STORAGE_ICON" empty_title="Nothing is kept yet" empty="A folder kept for a service survives its restarts; a service's own settings are where a path is added.">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a folder, a service or a machine" aria-label="Find a folder by its path, its service or its machine" spellcheck="false">
            <span class="dt-chips">
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="$emit('only', (chip.value === '' ? null : chip.value))">
                    <span v-if="chip.away" class="dot failed"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="FOLDER_ICON" :name="row.name" :line="kind_text(row)" mono/>
            <button v-else-if="(column.key === 'on')" type="button" class="link" @click="$emit('remote', row.machine)">{{ remote_title(row.machine) }}</button>
            <template v-else-if="(column.key === 'kept')">
                <div v-for="user of row.used_by" :key="(user.service + user.at)" class="row-of">
                    <button type="button" class="link" @click="$emit('select', user.service)">{{ user.service }}</button>
                    <span class="muted">at <code>{{ user.at }}</code>{{ user.readonly ? ' · read only' : '' }}</span>
                </div>
            </template>
        </template>
    </data-table>
    <volumes :machines="volume_machines"/>
</article>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, volumes},
    // remote: the one machine the list is narrowed to, or null for all of them; the chips set it
    props: ['state', 'remote'],
    emits: ['only', 'remote', 'select'],
    data: function () {
        return {
            FOLDER_ICON,
            STORAGE_ICON: CATEGORIES.find(v => v.key === 'storage').icon,
            volumes: [],
            filter: '',
        };
    },
    computed: {
        // The table's columns, each that may fold with when: its kind first
        // The folder over its kind, the services it is kept for, its machine; on a phone the
        // services a line of their own
        columns: function () {
            return [
                {key: 'name', label: 'Folder'},
                {key: 'kept', label: 'Kept for', fold: 2, hide: v => (v.used_by.length === 0), phone: 'row'},
                {key: 'on', label: 'Machine', fold: 3},
            ];
        },
        // The footer: how many folders, on how many machines
        foot: function () {
            const machines = new Set(this.volumes.map(v => v.machine)).size;
            return [{text: `${this.volumes.length} ${(this.volumes.length === 1) ? 'folder' : 'folders'}`, tone: ''}, {text: `on ${machines} ${(machines === 1) ? 'machine' : 'machines'}`, tone: ''}];
        },
        show: function () {
            return ((this.remote === null) || (this.remote === undefined)) ? '' : this.remote;
        },
        chips: function () {
            const out = [{value: '', label: 'All machines', count: this.volumes.length, away: false}];
            for (const remote of this.state.remotes) {
                const count = this.volumes.filter(v => v.machine === remote.name).length;
                if (count > 0) {
                    out.push({value: remote.name, label: remote.title || remote.name, count, away: (remote.phase !== 'online')});
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
                const machine = remote.machine || {};
                out.push({name: remote.name, title: remote.title || remote.name, base: `/api/v1/remotes/${encodeURIComponent(remote.name)}/volumes`, offline: (remote.phase !== 'online'), user: machine.user});
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
        row_key: function (item) {
            return `${item.machine}/${item.name}`;
        },
        kind_text: function (item) {
            if (item.kind === 'kept') {
                return 'a folder under the agent';
            }
            if (item.kind === 'app') {
                return 'an app\'s own, kept through a new version';
            }
            return (item.kind === 'volume') ? 'a docker volume' : 'a folder';
        },
        remote_title: function (name) {
            const found = this.state.remotes.find(v => v.name === name);
            return (found === undefined) ? name : (found.title || found.name);
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
