import agent_current from './agent_current.js';
import apt_all_section from './apt_all_section.js';
import data_table from './data_table.js';
import format_bytes from './format_bytes.js';
import format_ms from './format_ms.js';
import is_name_in_title from './is_name_in_title.js';
import remote_dot from './remote_dot.js';
import remote_state_text from './remote_state_text.js';
import remote_unanswered_said from './remote_unanswered_said.js';
import share_level from './share_level.js';
import tailnet_name_of from './tailnet_name_of.js';

// Each machine's icon, as the Canvas draws it: the inside of a 24x24 stroked svg
const ICONS = {
    server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19l-2-4h-15z"/>',
    home: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

// Every machine, a row each, in one table: its tags, what it is, how full its memory and disks
// are, what it carries, and how it stands, with an update tag when its agent is behind. A click
// on a row opens the machine; what is wrong with one is said under its row.
const remotes_pane = {
    template: `
<article id="detail" class="list">
    <div class="list-head">
        <h1>Remotes</h1>
        <span class="muted">{{ remotes.length }}</span>
        <div class="list-acts">
            <button v-if="(apt_open === false)" type="button" :disabled="(apt_count === 0)" :title="((apt_count === 0) ? 'Nothing waits to be installed on the machines shown' : 'apt-get update and upgrade on each of them, at once')" @click="apt_open = true">{{ ((apt_count === 0) ? 'No updates' : ('Install updates on ' + apt_count)) }}</button>
            <button type="button" @click="$emit('join')">{{ state.join === null ? 'Let machines join' : 'Machines may join' }}</button>
            <button type="button" class="primary" @click="$emit('create')">+ New remote</button>
        </div>
    </div>
    <div class="list-tools">
        <input v-model.trim="filter" type="search" placeholder="find a machine" aria-label="Find a machine by its name, hostname, tailnet name or tag" spellcheck="false">
        <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
            <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
            {{ chip.label }}
            <span class="muted">{{ chip.count }}</span>
        </button>
    </div>
    <apt-all-section v-if="apt_open" :remotes="shown" :answering="answering" @close="apt_open = false" @configure="$emit('configure', $event)"/>
    <data-table class="machines-table" :columns="columns" :rows="cards" row_key="name" :empty="empty_text" :on_row="(row => $emit('select', row.name))" :marks="false">
        <template #cell="{row, column}">
            <span v-if="(column.key === 'name')" class="machine-name">
                <svg class="dt-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="row.icon"/>
                <button type="button" class="link" title="The machine's page" @click="$emit('select', row.name)"><b>{{ row.title }}</b></button>
                <code v-if="row.name_shown" class="muted">{{ row.name }}</code>
                <code v-if="(row.tailnet !== null)" class="tailnet-name" :title="('Its name on your tailnet, as Tailscale says: ' + row.tailnet)">{{ row.tailnet }}</code>
            </span>
            <span v-else-if="(column.key === 'tags')" class="row-of">
                <span v-for="tag of row.tags" :key="tag" class="tag">#{{ tag }}</span>
            </span>
            <span v-else-if="(column.key === 'system')">{{ row.system }}</span>
            <span v-else-if="(bar_of(row, column.key) !== null)" class="load" :title="bar_of(row, column.key).text">
                <span class="meter" :class="bar_of(row, column.key).level"><i :style="{width: (Math.max(2, bar_of(row, column.key).percent) + '%')}"/></span>
                <button v-if="bar_of(row, column.key).disks" type="button" class="link" title="Every disk of this machine, with its inodes" @click="$emit('disks', row.name)">{{ bar_of(row, column.key).percent }}%</button>
                <span v-else>{{ bar_of(row, column.key).percent }}%</span>
            </span>
            <span v-else-if="((column.key === 'memory') || (column.key === 'disk'))" class="muted">—</span>
            <!-- Its services open their own list, holding only what this machine carries -->
            <template v-else-if="(column.key === 'services')">
                <button v-if="(row.services > 0)" type="button" class="link" title="Only the services on this machine" @click="$emit('services', row.name)">{{ row.services }}</button>
                <span v-else class="muted">0</span>
            </template>
            <span v-else-if="(column.key === 'state')" class="dt-state">
                <span class="dot" :class="row.dot"/>{{ row.pill }}
                <span v-if="(row.agent === false)" class="tag waiting" title="It runs an older agent than this host serves: its page says how it updates">update</span>
            </span>
        </template>
        <!-- What is wrong with a machine, under its row: since when it is away, what waits for
             it, what it refused -->
        <template #below="{row}">
            <div v-if="(row.troubles.length > 0) || (row.online === false)" class="machine-notes">
                <p v-if="(row.online === false)" class="muted">{{ row.away_text }}</p>
                <p v-for="line of row.troubles" :key="line" class="alert">{{ line }}</p>
            </div>
        </template>
    </data-table>
</article>
`,
    components: {'apt-all-section': apt_all_section, 'data-table': data_table},
    props: ['state', 'answering'],
    emits: ['configure', 'create', 'disks', 'doors', 'folders', 'join', 'select', 'services'],
    data: function () {
        return {filter: '', show: 'all', apt_open: false};
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
                const words = [remote.name, remote.title || '', (machine === null) ? '' : machine.hostname, tailnet_name_of(machine)].concat(remote.tags).join(' ').toLowerCase();
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
        // Name and state never fold; the rest fold where the pane is narrow, the tags first
        columns: function () {
            return [
                {key: 'name', label: 'Name', wraps: true},
                {key: 'tags', label: 'Tags', fold: 1, hide: v => (v.tags.length === 0)},
                {key: 'system', label: 'System', fold: 2, hide: v => (v.system === '')},
                {key: 'memory', label: 'Memory', fold: 4},
                {key: 'disk', label: 'Disk', fold: 3},
                {key: 'services', label: 'Svc', fold: 5, align: 'right'},
                {key: 'state', label: 'State'},
            ];
        },
        // How the Canvas draws each machine, by its name
        kind_by_name: function () {
            const machines = ((this.state.canvas === undefined) || (this.state.canvas === null)) ? [] : this.state.canvas.machines;
            return Object.fromEntries(machines.map(v => [v.name, v.kind]));
        },
        empty_text: function () {
            return (this.remotes.length === 0) ? 'No remotes yet. A remote is a machine with an agent that dials in; a service runs on one.' : 'Nothing matches.';
        },
    },
    methods: {
        bar_of: function (card, key) {
            const found = card.bars.find(v => v.key === key);
            return (found === undefined) ? null : found;
        },
        card_of: function (remote, machine) {
            const online = (remote.phase === 'online');
            const services = this.services_of(remote);
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
            const unanswered = remote_unanswered_said(remote);
            if (unanswered !== '') {
                troubles.push(unanswered);
            }
            return {
                name: remote.name,
                remote,
                icon: ICONS[this.kind_by_name[remote.name]] || ICONS.server,
                tags: remote.tags,
                title: remote.title || remote.name,
                name_shown: is_name_in_title(remote.title, remote.name) === false,
                // Its name on the tailnet, beside the one serviceman gives it; null for none
                tailnet: (tailnet_name_of(machine) === '') ? null : tailnet_name_of(machine),
                online,
                // running, waiting while its answers do not come, failed while it is away
                dot: remote_dot(remote),
                pill: remote_state_text(remote),
                agent: agent_current(remote, this.state.agent_built),
                troubles,
                bars: (online && (machine !== null)) ? this.bars_of(machine) : [],
                away_text: this.away_text(remote, services),
                services: services.length,
                // What it is: its system and its cores, as it said them last
                system: (machine === null) ? '' : [machine.os || machine.platform || '', (machine.cpu === undefined) ? '' : `${machine.cpu.count} CPU`].filter(v => v !== '').join(', '),
            };
        },
        bars_of: function (machine) {
            const out = [];
            // How busy the cores are, as the machine measures it; the load average is beside it,
            // for it counts what waits on disk too and is not a share of the cores
            if ((machine.cpu_busy !== undefined) && (machine.cpu_busy !== null)) {
                const busy = Math.round(machine.cpu_busy*100);
                const load = (machine.load === null) ? '' : ` · load ${machine.load.toFixed(2)}`;
                out.push({key: 'cpu', label: 'CPU', percent: busy, level: share_level(busy/100), text: `${busy}% busy${load}`});
            }
            // Free memory it does not say (no stats yet, servermon silent) is no bar, as with CPU
            if ((machine.mem.total > 0) && (machine.mem.free !== null)) {
                const used = Math.round((1 - machine.mem.free/machine.mem.total)*100);
                out.push({key: 'memory', label: 'Memory', percent: used, level: share_level(used/100), text: `${format_bytes(machine.mem.free)} of ${format_bytes(machine.mem.total)} free`});
            }
            // Every disk together, the way CPU is every core: used over what there is. An agent
            // that does not count its disks yet is the one it lives on.
            const disks = ((machine.disks === undefined) || (machine.disks === null)) ? disks_from_disk(machine.disk) : machine.disks;
            if ((disks !== null) && (disks.total > 0)) {
                const percent = Math.round(disks.used/disks.total*100);
                const over = (disks.count > 1) ? ` · ${disks.count} disks` : '';
                out.push({key: 'disk', label: 'Disk', percent, level: share_level(percent/100), text: `${format_bytes(disks.used)} of ${format_bytes(disks.total)} used${over}`, disks: true});
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
    },
    created: function () {
        this.apt_running_find();
    },
};

function disks_from_disk(disk)
{
    if ((disk.total === null) || (disk.free === null)) {
        return null;
    }
    return {count: 1, total: disk.total, used: disk.total - disk.free};
}

export default remotes_pane;
