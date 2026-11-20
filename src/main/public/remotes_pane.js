import CATEGORIES from './categories.js';
import agent_current from './agent_current.js';
import clock_of from './clock_of.js';
import data_table from './data_table.js';
import format_bytes from './format_bytes.js';
import format_ms from './format_ms.js';
import machine_icons from './machine_icons.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import remote_dot from './remote_dot.js';
import remote_state_text from './remote_state_text.js';
import remote_unanswered_said from './remote_unanswered_said.js';
import share_level from './share_level.js';
import state_pill from './state_pill.js';
import tailnet_name_of from './tailnet_name_of.js';

// Every machine, a row each, in one table: what it is, how full its memory and disks are, what
// it carries, and how it stands, with an update tag when its agent is behind. A click on a row
// opens the machine; what is wrong with one is said under its row. Tags and letting machines
// join are not shown, for now: a machine keeps its tags, and a service still asks for them.
const remotes_pane = {
    template: `
<article id="detail" class="list">
    <page-head category="remotes" :count="remotes.length">
        <template #acts>
            <button type="button" title="What apt has waiting on each machine, and Install" @click="$emit('updates')">Updates</button>
            <button type="button" class="primary" @click="$emit('create')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New remote</button>
        </template>
    </page-head>
    <data-table class="machines-table" :columns="columns" :rows="cards" row_key="name" :row_class="(row => ((row.tone === '') ? [] : ('dt-' + row.tone)))" :on_row="(row => $emit('select', row.name))" :opens="(row => (row.notes.length > 0))" :marks="false" framed :total="remotes.length" :foot="foot" :empty_icon="REMOTES_ICON" empty_title="No machines yet" empty="A machine joins when its agent dials in: one line to run on it, and it shows up here with its memory, disk and services.">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a machine" aria-label="Find a machine by its name, hostname, tailnet name or tag" spellcheck="false">
            <span class="dt-chips">
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #empty_act><button type="button" class="primary" @click="$emit('create')"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New remote</button></template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="row.icon" :name="row.name" :line="row.line" :tone="row.tone"/>
            <span v-else-if="((column.key === 'system') && (row.system !== ''))">{{ row.system }}</span>
            <span v-else-if="(bar_of(row, column.key) !== null)" class="load" :title="bar_of(row, column.key).text">
                <span class="dt-ph-label">{{ bar_of(row, column.key).label }}</span>
                <span class="meter" :class="bar_of(row, column.key).level"><i :style="{width: (Math.max(2, bar_of(row, column.key).percent) + '%')}"/></span>
                <button v-if="bar_of(row, column.key).disks" type="button" class="link" title="Every disk of this machine, with its inodes" @click="$emit('disks', row.name)">{{ bar_of(row, column.key).percent }}%</button>
                <span v-else>{{ bar_of(row, column.key).percent }}%</span>
            </span>
            <span v-else-if="((column.key === 'cpu') || (column.key === 'memory') || (column.key === 'disk'))" class="muted"><span class="dt-ph-label">{{ ((column.key === 'cpu') ? 'CPU' : ((column.key === 'memory') ? 'Memory' : 'Disk')) }}</span>—</span>
            <!-- Its services open their own list, holding only what this machine carries -->
            <template v-else-if="(column.key === 'services')">
                <button v-if="(row.services > 0)" type="button" class="link" title="Only the services on this machine" @click="$emit('services', row.name)">{{ row.services }}</button>
                <span v-else class="muted">0</span>
            </template>
            <state-pill v-else-if="(column.key === 'state')" :tone="row.pill_tone" :text="row.pill"/>
        </template>
        <!-- What is wrong with a machine, whole, in its window: since when it is away, what
             waits for it, what it refused; its name on the tailnet -->
        <template #details="{row}">
            <template v-if="(row.notes.length > 0)">
                <dt>Notes</dt>
                <dd><p v-for="line of row.notes" :key="line" class="machine-note">{{ line }}</p></dd>
            </template>
            <template v-if="(row.tailnet !== null)">
                <dt>On the tailnet</dt>
                <dd><code>{{ row.tailnet }}</code></dd>
            </template>
        </template>
    </data-table>
</article>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, 'state-pill': state_pill},
    props: ['state', 'answering'],
    emits: ['create', 'disks', 'doors', 'folders', 'join', 'select', 'services', 'updates'],
    data: function () {
        return {filter: '', show: 'all', REMOTES_ICON: CATEGORIES.find(v => v.key === 'remotes').icon};
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
                {value: 'update', label: 'Update', phase: 'stopping', count: this.remotes.filter(v => this.update_waits(v)).length},
            ];
        },
        // The footer: how many machines, online, offline, and with an update waiting
        foot: function () {
            const all = this.remotes.length;
            const online = this.remotes.filter(v => v.phase === 'online').length;
            const update = this.remotes.filter(v => this.update_waits(v)).length;
            const out = [{text: `${all} ${(all === 1) ? 'machine' : 'machines'}`, tone: ''}, {text: `${online} online`, tone: ''}];
            if (online < all) {
                out.push({text: `${all - online} offline`, tone: 'bad'});
            }
            if (update > 0) {
                out.push({text: `${update} update waiting`, tone: 'warn'});
            }
            return out;
        },
        // The machines the chips and the filter leave
        shown: function () {
            const wanted = this.filter.toLowerCase();
            const show = this.show;
            const self = this;
            return this.remotes.filter(function (remote) {
                const online = (remote.phase === 'online');
                if (((show === 'online') && (online === false)) || ((show === 'offline') && online)) {
                    return false;
                }
                if ((show === 'update') && (self.update_waits(remote) === false)) {
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
        // Name and state never fold; the rest fold where the pane is narrow, the system first. On
        // a phone the system has a line, CPU, memory and disk a line each
        columns: function () {
            return [
                {key: 'name', label: 'Name'},
                {key: 'system', label: 'System', fold: 2, hide: v => (v.system === '')},
                {key: 'cpu', label: 'CPU', fold: 3, phone: 'row'},
                {key: 'memory', label: 'Memory', fold: 5, phone: 'row'},
                {key: 'disk', label: 'Disk', fold: 4, phone: 'row'},
                {key: 'services', label: 'Services', fold: 6, align: 'right', phone: 'hide'},
                {key: 'state', label: 'Status', phone: 'state'},
            ];
        },
        // How the Canvas draws each machine, by its name
        kind_by_name: function () {
            const machines = ((this.state.canvas === undefined) || (this.state.canvas === null)) ? [] : this.state.canvas.machines;
            return Object.fromEntries(machines.map(v => [v.name, v.kind]));
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
            const bars = (online && (machine !== null)) ? this.bars_of(machine) : [];
            const said = this.said_of(remote, troubles, unanswered, bars, services);
            return Object.assign({
                name: remote.name,
                remote,
                icon: machine_icons[this.kind_by_name[remote.name]] || machine_icons.server,
                tags: remote.tags,
                // Its name on the tailnet, beside the one serviceman gives it; null for none
                tailnet: (tailnet_name_of(machine) === '') ? null : tailnet_name_of(machine),
                online,
                // What is wrong, whole, for the row's window: since when it is away, then the rest
                notes: (online ? [] : [this.away_text(remote, services)]).concat(troubles),
                bars,
                services: services.length,
                // What it is: its system, as it said it last
                system: (machine === null) ? '' : (machine.os || machine.platform || ''),
            }, said);
        },
        // The line under its name and its pill: away, red, with what waits for it; something
        // wrong, red; an agent behind, not answering or a disk nearly full, orange; else its title
        said_of: function (remote, troubles, unanswered, bars, services) {
            // Online or offline, as drawn; how long its calls have waited when it does not answer
            const pill = (unanswered === '') ? ((remote.phase === 'online') ? 'online' : 'offline') : remote_state_text(remote);
            const pill_tone = {failed: 'bad', starting: 'busy', running: 'run'}[remote_dot(remote)] || 'idle';
            if (remote.phase !== 'online') {
                const since = ((remote.left_at === null) || (remote.left_at === undefined)) ? 'not linked since serviceman started' : `not linked since ${clock_of(remote.left_at)}`;
                const first = (services.length === 0) ? '' : (services[0].title || services[0].name);
                const waits = (services.length === 0) ? '' : ((services.length === 1) ? `; ${first} waits for it` : `; ${first} and ${services.length - 1} more wait for it`);
                return {line: since + waits, tone: 'bad', pill, pill_tone};
            }
            const hard = troubles.filter(v => v !== unanswered);
            if (hard.length > 0) {
                return {line: hard[0], tone: 'bad', pill, pill_tone: 'bad'};
            }
            if (unanswered !== '') {
                return {line: unanswered, tone: 'warn', pill, pill_tone};
            }
            if (this.update_waits(remote)) {
                return {line: `agent ${remote.agent_version || 'of an older build'}; a newer one waits`, tone: 'warn', pill: 'update waiting', pill_tone: 'busy'};
            }
            const full = bars.filter(v => (v.level === 'full') && (v.key !== 'cpu')).map(v => v.label.toLowerCase());
            if (full.length > 0) {
                return {line: `${full.join(' and ')} nearly full`, tone: 'warn', pill, pill_tone};
            }
            const title = ((remote.title === null) || (remote.title === undefined) || (remote.title === remote.name)) ? '' : remote.title;
            return {line: title, tone: '', pill, pill_tone};
        },
        // An online machine whose agent is behind the one this host serves: its update waits
        update_waits: function (remote) {
            return (remote.phase === 'online') && (agent_current(remote, this.state.agent_built) === false);
        },
        bars_of: function (machine) {
            const out = [];
            // How busy the cores are, as the machine measures it: the percent alone in the cell,
            // and how many cores on hover; the load average is beside it, for it counts what
            // waits on disk too and is not a share of the cores
            if ((machine.cpu_busy !== undefined) && (machine.cpu_busy !== null)) {
                const busy = Math.round(machine.cpu_busy*100);
                const cores = ((machine.cpu === undefined) || (machine.cpu === null) || (machine.cpu.count === undefined)) ? '' : ` of ${machine.cpu.count} ${(machine.cpu.count === 1) ? 'core' : 'cores'}`;
                const load = (machine.load === null) ? '' : ` · load ${machine.load.toFixed(2)}`;
                out.push({key: 'cpu', label: 'CPU', percent: busy, level: share_level(busy/100), text: `${busy}% busy${cores}${load}`});
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
