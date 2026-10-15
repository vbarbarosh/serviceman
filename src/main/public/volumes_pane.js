import fold_table from './fold_table.js';
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
    <fold-table v-slot="fold" class="card" :order="['kind', 'kept', 'on']">
        <table class="list-table">
            <thead>
                <tr>
                    <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                    <th>Folder</th>
                    <th data-fold="kind">Kind</th>
                    <th data-fold="on">On</th>
                    <th data-fold="kept">Kept for</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="item of rows" :key="row_key(item)">
                    <tr :class="{foldable: (fold.folded.length > 0), open: fold.is_open(row_key(item))}" @click="fold.toggle(row_key(item), $event)">
                        <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td class="wraps"><code>{{ item.name }}</code></td>
                        <td data-fold="kind" class="muted">{{ kind_text(item) }}</td>
                        <td data-fold="on"><button type="button" class="link" @click="$emit('remote', item.machine)">{{ remote_title(item.machine) }}</button></td>
                        <td data-fold="kept">
                            <div v-for="user of item.used_by" :key="(user.service + user.at)" class="row-of">
                                <button type="button" class="link" @click="$emit('select', user.service)">{{ user.service }}</button>
                                <span class="muted">at <code>{{ user.at }}</code>{{ user.readonly ? ' · read only' : '' }}</span>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="fold.is_open(row_key(item))" class="fold-more">
                        <td :colspan="fold.span">
                            <dl class="fold-details">
                                <template v-if="fold.folded.includes('kind')">
                                    <dt>Kind</dt>
                                    <dd class="muted">{{ kind_text(item) }}</dd>
                                </template>
                                <template v-if="fold.folded.includes('on')">
                                    <dt>On</dt>
                                    <dd><button type="button" class="link" @click="$emit('remote', item.machine)">{{ remote_title(item.machine) }}</button></dd>
                                </template>
                                <template v-if="(fold.folded.includes('kept') && item.used_by.length > 0)">
                                    <dt>Kept for</dt>
                                    <dd>
                                        <div v-for="user of item.used_by" :key="(user.service + user.at)">
                                            <button type="button" class="link" @click="$emit('select', user.service)">{{ user.service }}</button>
                                            <span class="muted"> at <code>{{ user.at }}</code>{{ user.readonly ? ' · read only' : '' }}</span>
                                        </div>
                                    </dd>
                                </template>
                            </dl>
                        </td>
                    </tr>
                </template>
                <tr v-if="(rows.length === 0)">
                    <td class="muted" :colspan="fold.span">{{ volumes.length === 0 ? 'Nothing is kept yet.' : 'Nothing matches.' }}</td>
                </tr>
            </tbody>
        </table>
    </fold-table>
    <volumes :machines="volume_machines"/>
</article>
`,
    components: {'fold-table': fold_table, volumes},
    // remote: the one machine the list is narrowed to, or null for all of them; the chips set it
    props: ['state', 'remote'],
    emits: ['only', 'remote', 'select'],
    data: function () {
        return {
            volumes: [],
            filter: '',
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
        row_key: function (item) {
            return `${item.machine}/${item.name}`;
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
