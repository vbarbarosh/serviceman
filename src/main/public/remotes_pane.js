import agent_current from './agent_current.js';
import agent_pill from './agent_pill.js';
import agent_pill_short from './agent_pill_short.js';
import apt_all_section from './apt_all_section.js';
import data_table from './data_table.js';
import format_bytes from './format_bytes.js';
import format_ms from './format_ms.js';
import is_name_in_title from './is_name_in_title.js';
import logline_link from './logline_link.js';
import logs_link from './logs_link.js';

const REMOTES_VIEW_KEY = 'serviceman.remotes_view';

// Cards, or a table with a row for each machine; the same things said in both
const REMOTES_VIEWS = [{value: 'cards', label: 'Cards'}, {value: 'table', label: 'Table'}];

// Every machine as a card, or as a row of a table: whether it is there, how loaded it is, and
// what it carries. An offline one says since when, and what waits for it.
const remotes_pane = {
    template: `
<article id="detail" class="list">
    <div class="list-head">
        <h1>Remotes</h1>
        <span class="muted">{{ remotes.length }}</span>
        <div class="list-acts">
            <button v-if="(apt_open === false)" type="button" :disabled="(apt_count === 0)" :title="((apt_count === 0) ? 'Nothing waits to be installed on the machines shown' : 'apt-get update and upgrade on each of them, at once')" @click="apt_open = true">{{ ((apt_count === 0) ? 'No updates' : ('Install updates on ' + apt_count)) }}</button>
            <button type="button" @click="$emit('join')">{{ state.join === null ? 'Let machines join' : 'Machines may join' }}</button>
            <button type="button" class="primary" @click="$emit('create')">+ Add remote</button>
        </div>
    </div>
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="filter by name, hostname, tag" spellcheck="false">
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
            <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
        <span class="list-right">
            <span class="muted">View</span>
            <span class="seg">
                <button v-for="option of views" :key="option.value" type="button" :class="{on: (view === option.value)}" @click="view_pick(option.value)">{{ option.label }}</button>
            </span>
        </span>
    </div>
    <apt-all-section v-if="apt_open" :remotes="shown" @close="apt_open = false" @configure="$emit('configure', $event)"/>
    <div v-if="(view === 'cards')" class="machines">
        <div v-for="card of cards" :key="card.name" class="card machine pick" :class="{away: (card.online === false)}" @click="$emit('select', card.name)">
            <div class="row-of">
                <span class="dot" :class="(card.online ? 'running' : 'failed')"/>
                <b>{{ card.title }}</b>
                <code v-if="card.name_shown" class="muted">{{ card.name }}</code>
                <span class="pill" :class="(card.online ? 'running' : 'failed')">{{ card.pill }}</span>
                <agent-pill :current="card.agent"/>
            </div>
            <p v-for="line of card.troubles" :key="line" class="alert">{{ line }}</p>
            <div v-if="(card.bars.length > 0)" class="bars">
                <template v-for="bar of card.bars" :key="bar.label">
                    <span class="muted">{{ bar.label }}</span>
                    <span class="meter"><i :style="{width: (bar.percent + '%')}"/></span>
                    <button v-if="bar.disks" type="button" class="link" title="Every disk of this machine, with its inodes" @click.stop="$emit('disks', card.name)">{{ bar.text }}</button>
                    <span v-else>{{ bar.text }}</span>
                </template>
            </div>
            <p v-if="(card.online === false)" class="muted">{{ card.away_text }}</p>
            <div class="row-of carries">
                <!-- Each count opens its own list, holding only what this machine carries -->
                <button v-if="(card.services > 0)" type="button" class="tag" title="Only the services on this machine" @click.stop="$emit('services', card.name)">{{ card.services_text }}</button>
                <span v-else class="tag">{{ card.services_text }}</span>
                <button v-if="(card.folders > 0)" type="button" class="tag" title="Only the folders kept on this machine" @click.stop="$emit('folders', card.name)">{{ card.folders_text }}</button>
                <span v-else class="tag">{{ card.folders_text }}</span>
                <button v-if="(card.doors > 0)" type="button" class="tag" title="Only the names this machine's door answers" @click.stop="$emit('doors', card.name)">{{ card.doors_text }}</button>
                <span v-else class="tag">{{ card.doors_text }}</span>
                <logs-link :url="card.logs_url" kind="remote"/>
                <span v-if="(card.uptime !== null)" :class="card.uptime.kind" :title="card.uptime.title">{{ card.uptime.share }} uptime</span>
                <span class="muted list-right">{{ card.machine_text }}</span>
            </div>
        </div>
        <p v-if="(cards.length === 0)" class="muted">{{ empty_text }}</p>
    </div>
    <!-- Name and state never fold; the rest fold where the pane is narrow, CPU last. The name
         opens the machine; a click on the row opens what folded. -->
    <data-table v-else class="machines-table" :columns="columns" :rows="cards" row_key="name" :empty="empty_text">
        <template #cell="{row, column}">
            <span v-if="(column.key === 'name')" class="machine-name">
                <span class="dot" :class="(row.online ? 'running' : 'failed')"/>
                <button type="button" class="link" title="The machine's page" @click="$emit('select', row.name)"><b>{{ row.title }}</b></button>
                <code v-if="row.name_shown" class="muted">{{ row.name }}</code>
            </span>
            <!-- A machine with no numbers says why across their empty cells: since when it is away,
                 what waits for it, what went wrong -->
            <span v-else-if="(column.key === 'state')" class="machine-state">
                <span class="pill" :class="(row.online ? 'running' : 'failed')">{{ row.pill }}</span>
                <template v-if="(row.bars.length === 0)">
                    <span v-if="(row.online === false)" class="muted">{{ row.away_text }}</span>
                    <span v-for="line of row.troubles" :key="line" class="bad">{{ line }}</span>
                </template>
            </span>
            <agent-pill-short v-else-if="(column.key === 'agent')" :current="row.agent"/>
            <span v-else-if="(bar_of(row, column.key) !== null)" class="load">
                <span class="meter"><i :style="{width: (bar_of(row, column.key).percent + '%')}"/></span>
                <button v-if="bar_of(row, column.key).disks" type="button" class="link" title="Every disk of this machine, with its inodes" @click="$emit('disks', row.name)">{{ bar_of(row, column.key).text }}</button>
                <span v-else>{{ bar_of(row, column.key).text }}</span>
            </span>
            <span v-else-if="((column.key === 'uptime') && (row.uptime !== null))" :class="row.uptime.kind" :title="row.uptime.title">{{ row.uptime.share }}</span>
            <!-- Each count opens its own list, holding only what this machine carries -->
            <template v-else-if="(column.key === 'services')">
                <button v-if="(row.services > 0)" type="button" class="tag" title="Only the services on this machine" @click="$emit('services', row.name)">{{ row.services }}</button>
                <span v-else class="muted">0</span>
            </template>
            <template v-else-if="(column.key === 'folders')">
                <button v-if="(row.folders > 0)" type="button" class="tag" title="Only the folders kept on this machine" @click="$emit('folders', row.name)">{{ row.folders }}</button>
                <span v-else class="muted">0</span>
            </template>
            <template v-else-if="(column.key === 'doors')">
                <button v-if="(row.doors > 0)" type="button" class="tag" title="Only the names this machine's door answers" @click="$emit('doors', row.name)">{{ row.doors }}</button>
                <span v-else class="muted">0</span>
            </template>
            <logs-link v-else-if="(column.key === 'logs')" :url="row.logs_url" kind="remote"/>
            <span v-else-if="(column.key === 'system')" class="muted">{{ row.machine_text }}</span>
        </template>
        <!-- A machine whose numbers fill its row has its troubles under it, as alerts -->
        <template #below="{row}">
            <div v-if="((row.bars.length > 0) && (row.troubles.length > 0))" class="machine-notes">
                <p v-for="line of row.troubles" :key="line" class="alert">{{ line }}</p>
            </div>
        </template>
    </data-table>
</article>
`,
    components: {'agent-pill': agent_pill, 'apt-all-section': apt_all_section, 'agent-pill-short': agent_pill_short, 'data-table': data_table, 'logs-link': logs_link},
    props: ['state'],
    emits: ['configure', 'create', 'disks', 'doors', 'folders', 'join', 'select', 'services'],
    data: function () {
        return {filter: '', show: 'all', volumes: [], view: remotes_view_read(), views: REMOTES_VIEWS, apt_open: false};
    },
    computed: {
        remotes: function () {
            return (this.state === null) ? [] : this.state.remotes;
        },
        chips: function () {
            const online = this.remotes.filter(v => v.phase === 'online').length;
            return [
                {value: 'all', label: 'All', phase: null, count: this.remotes.length},
                {value: 'online', label: 'Online', phase: 'running', count: online},
                {value: 'offline', label: 'Offline', phase: 'failed', count: this.remotes.length - online},
            ];
        },
        // The machines the chips and the filter leave
        shown: function () {
            const wanted = this.filter.toLowerCase();
            const show = this.show;
            return this.remotes.filter(function (remote) {
                const online = (remote.phase === 'online');
                if (((show === 'online') && (online === false)) || ((show === 'offline') && online)) {
                    return false;
                }
                const machine = (remote.machine === undefined) ? null : remote.machine;
                const words = [remote.name, remote.title || '', (machine === null) ? '' : machine.hostname].concat(remote.tags).join(' ').toLowerCase();
                return (wanted === '') || words.includes(wanted);
            });
        },
        cards: function () {
            return this.shown.map(v => this.card_of(v, (v.machine === undefined) ? null : v.machine));
        },
        // The machines shown with something to install that can be asked to install it now
        apt_count: function () {
            return this.shown.filter(function (remote) {
                const machine = (remote.machine === undefined) ? null : remote.machine;
                return (remote.phase === 'online') && (machine !== null) && (machine.can !== null) && machine.can.includes('apt') && (machine.updates !== null) && (machine.updates.pending > 0);
            }).length;
        },
        columns: function () {
            return [
                {key: 'name', label: 'Remote', wraps: true},
                {key: 'state', label: 'State', spread: v => (v.bars.length === 0) ? ['cpu', 'memory', 'disk'] : []},
                {key: 'cpu', label: 'CPU', fold: 10, hide: v => (this.bar_of(v, 'cpu') === null)},
                {key: 'memory', label: 'Memory', fold: 8, hide: v => (this.bar_of(v, 'memory') === null)},
                {key: 'disk', label: 'Disk', fold: 7, hide: v => (this.bar_of(v, 'disk') === null)},
                {key: 'uptime', label: 'Uptime', fold: 6, align: 'right', hide: v => (v.uptime === null)},
                {key: 'services', label: 'Services', fold: 9, align: 'right'},
                {key: 'folders', label: 'Folders', fold: 5, align: 'right'},
                {key: 'doors', label: 'Door names', fold: 4, align: 'right'},
                {key: 'logs', label: 'Logs', fold: 3, hide: v => (v.logs_url === null)},
                {key: 'agent', label: 'Agent', fold: 2, hide: v => (v.agent === null)},
                {key: 'system', label: 'System', fold: 1, hide: v => (v.machine_text === '')},
            ];
        },
        empty_text: function () {
            return (this.remotes.length === 0) ? 'No remotes yet. A remote is a machine with an agent that dials in; a service runs on one.' : 'Nothing matches.';
        },
    },
    methods: {
        view_pick: function (view) {
            this.view = view;
            remotes_view_write(view);
        },
        bar_of: function (card, key) {
            const found = card.bars.find(v => v.key === key);
            return (found === undefined) ? null : found;
        },
        card_of: function (remote, machine) {
            const online = (remote.phase === 'online');
            const services = this.services_of(remote);
            const folders = this.volumes.filter(v => v.machine === remote.name).length;
            const doors = Object.keys((remote.inbound === undefined) ? {} : remote.inbound).length;
            const troubles = [];
            if ((remote.error !== null) && (remote.error !== undefined)) {
                troubles.push(remote.error);
            }
            if (online && (machine !== null) && (machine.docker === null) && services.some(v => v.type === 'docker')) {
                troubles.push('No docker on this machine — its docker services cannot start');
            }
            if (online && (remote.update_refused !== null) && (remote.update_refused !== undefined)) {
                troubles.push(`The agent refused an update: ${remote.update_refused}`);
            }
            return {
                name: remote.name,
                title: remote.title || remote.name,
                name_shown: is_name_in_title(remote.title, remote.name) === false,
                online,
                pill: online ? `online · ${(remote.latency_ms === null) ? '…' : `${remote.latency_ms}ms`}` : 'offline',
                agent: agent_current(remote, this.state.agent_built),
                logs_url: logline_link(this.state.logline, 'remote', remote.name),
                troubles,
                bars: (online && (machine !== null)) ? this.bars_of(machine) : [],
                uptime: ((machine === null) || (machine.uptime_30d === undefined)) ? null : uptime_of(machine.uptime_30d),
                away_text: this.away_text(remote, services),
                services: services.length,
                folders,
                doors,
                services_text: `${services.length} ${(services.length === 1) ? 'service' : 'services'}`,
                folders_text: (folders === 0) ? 'no folders' : `${folders} ${(folders === 1) ? 'folder' : 'folders'}`,
                doors_text: (doors === 0) ? 'no door names' : `${doors} ${(doors === 1) ? 'door name' : 'door names'}`,
                machine_text: (online && (machine !== null)) ? [machine.os || machine.platform, machine.arch, `up ${format_ms(machine.uptime_ms)}`].join(' · ') : '',
            };
        },
        bars_of: function (machine) {
            const out = [];
            // How busy the cores are, as the machine measures it; the load average is beside it,
            // for it counts what waits on disk too and is not a share of the cores
            if ((machine.cpu_busy !== undefined) && (machine.cpu_busy !== null)) {
                const busy = Math.round(machine.cpu_busy*100);
                const load = (machine.load === null) ? '' : ` · load ${machine.load.toFixed(2)}`;
                out.push({key: 'cpu', label: 'CPU', percent: busy, text: `${busy}% busy${load}`});
            }
            if (machine.mem.total > 0) {
                const used = Math.round((1 - machine.mem.free/machine.mem.total)*100);
                out.push({key: 'memory', label: 'Memory', percent: used, text: `${format_bytes(machine.mem.free)} of ${format_bytes(machine.mem.total)} free`});
            }
            // Every disk together, the way CPU is every core: used over what there is. An agent
            // that does not count its disks yet is the one it lives on.
            const disks = ((machine.disks === undefined) || (machine.disks === null)) ? disks_from_disk(machine.disk) : machine.disks;
            if ((disks !== null) && (disks.total > 0)) {
                const percent = Math.round(disks.used/disks.total*100);
                const over = (disks.count > 1) ? ` · ${disks.count} disks` : '';
                out.push({key: 'disk', label: 'Disk', percent, text: `${format_bytes(disks.used)} of ${format_bytes(disks.total)} used${over}`, disks: true});
            }
            return out;
        },
        // A service names a machine, or a kind of machine: #gpu is every machine with the tag
        services_of: function (remote) {
            return this.state.services.filter(v => v.remotes.some(vv => vv.startsWith('#') ? remote.tags.includes(vv.slice(1)) : vv === remote.name));
        },
        away_text: function (remote, services) {
            // Nothing is kept of a machine over a restart: one not seen since says only that
            const seen = (remote.left_at === null) ? `Not connected since serviceman started ${format_ms(this.state.now - this.state.started_at)} ago.` : `Last seen ${format_ms(this.state.now - remote.left_at)} ago.`;
            if (services.length === 0) {
                return `${seen} Nothing is placed on it.`;
            }
            const names = services.map(v => v.title || v.name).join(', ');
            return `${seen} Waiting for it: ${names}.`;
        },
        // Machines being upgraded from here a moment ago are still being upgraded: their rows
        // are shown again, rather than a button to start them
        apt_running_find: async function () {
            try {
                const answer = await fetch('/api/v1/apt-upgrade', {cache: 'no-store'});
                const batch = (await answer.json()).batch;
                this.apt_open = this.apt_open || ((batch !== null) && (batch.ended_at === null));
            }
            catch {
                // The button is there to start them; the rows show once it is pressed
            }
        },
        volumes_load: async function () {
            try {
                const answer = await fetch('/api/v1/volumes', {cache: 'no-store'});
                this.volumes = (await answer.json()).volumes;
            }
            catch {
                this.volumes = [];
            }
        },
    },
    created: function () {
        this.volumes_load();
        this.apt_running_find();
    },
};

// The view last picked, for this viewer: a convenience, so a browser that keeps nothing gets cards
function remotes_view_read()
{
    try {
        const kept = localStorage.getItem(REMOTES_VIEW_KEY);
        return REMOTES_VIEWS.some(v => v.value === kept) ? kept : 'cards';
    }
    catch {
        return 'cards';
    }
}

function remotes_view_write(view)
{
    try {
        localStorage.setItem(REMOTES_VIEW_KEY, view);
    }
    catch {
        // kept for this pane only
    }
}

// The last 30 days as the machine counted them: the share up, red below 99%, and the days and
// downtime in its title; null before servermon's first line or from an agent before 1.22
function uptime_of(counted)
{
    if ((counted === null) || (counted.known_ms === 0)) {
        return null;
    }
    const days = Math.ceil(counted.known_ms/86400000);
    const share = (counted.down_ms === 0) ? '100%' : `${(Math.floor((1 - counted.down_ms/counted.known_ms)*1000)/10).toFixed(1)}%`;
    const down = (counted.down_ms === 0) ? 'never down' : `down ${format_ms(counted.down_ms)}`;
    return {share, kind: ((counted.down_ms/counted.known_ms) > 0.01) ? 'bad' : '', title: `The last ${days} ${(days === 1) ? 'day' : 'days'}: ${down}`};
}

function disks_from_disk(disk)
{
    if ((disk.total === null) || (disk.free === null)) {
        return null;
    }
    return {count: 1, total: disk.total, used: disk.total - disk.free};
}

export default remotes_pane;
