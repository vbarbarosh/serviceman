import agent_current from './agent_current.js';
import agent_pill_short from './agent_pill_short.js';
import clock_of from './clock_of.js';
import format_bps from './format_bps.js';
import format_bytes from './format_bytes.js';
import format_ms from './format_ms.js';
import link_test_panel from './link_test_panel.js';
import logline_link from './logline_link.js';
import machine_shares from './machine_shares.js';
import overview_card from './overview_card.js';
import overview_tile from './overview_tile.js';
import remote_charts from './remote_charts.js';
import remote_unanswered_said from './remote_unanswered_said.js';
import remote_uptime from './remote_uptime.js';
import services_pane from './services_pane.js';
import size_words from './size_words.js';
import to_clipboard from './to_clipboard.js';
import updates_lists from './updates_lists.js';

// How long the Copy button says it copied
const COPIED_MS = 1500;
const DAY_MS = 24*3600*1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A remote's Overview tab: its names, its uptime by day in one row, the numbers that move as
// tiles, the services it carries as a table, its history, what it is as cards, and the raw state
// folded away at the end; its name and state are the page's header. It is drawn again with every
// beat of the machine.
const remote_overview = {
    template: `
<article id="detail" class="ov-pane">
    <div class="ov">
        <p v-if="(unanswered_said !== '')" class="alert">{{ unanswered_said }}. What is below waits for it.</p>
        <p v-if="view.error" class="alert"><strong>Last error</strong> · {{ view.error }}</p>
        <p v-if="servermon_text" class="alert">{{ servermon_text }}</p>
        <!-- Its numbers at a glance, as drawn: CPU, memory, disk and how long it is up, or down;
             what else it measures (its heat, its battery, its link) after them -->
        <div v-if="(view.machine !== null)" class="ov-tiles">
            <overview-tile v-for="tile in tiles" :key="tile.label" :icon="tile.icon" :label="tile.label" :value="tile.value" :note="tile.note" :go="tile.go" :tab="tile.tab" :tone="tile.tone" @tab="tile_go">{{ tile.text }}<small v-if="(tile.unit !== undefined)">{{ tile.unit }}</small></overview-tile>
        </div>
        <link-test-panel v-if="((view.machine !== null) && link_test_open)" :view="view" @close="link_test_open = false"/>
        <services-pane :state="state" :remote="view.name" embedded @create="$emit('create')" @select="$emit('select_named', $event)"/>
        <remote-uptime v-if="(view.machine !== null)" :view="view" @tab="$emit('tab', $event)"/>
        <remote-charts v-if="(view.machine !== null)" :view="view" @tab="$emit('tab', $event)"/>
        <div class="ov-cards">
            <overview-card v-if="(view.machine !== null)" icon="monitor" title="Machine">
                <template #aside>{{ view.machine.hostname }}</template>
                <dt>System</dt>
                <dd>{{ (view.machine.os || view.machine.platform) }}</dd>
                <template v-if="view.machine.os">
                    <dt>Kernel</dt>
                    <dd>{{ view.machine.platform }} · {{ view.machine.arch }}</dd>
                </template>
                <template v-else>
                    <dt>Arch</dt>
                    <dd>{{ view.machine.arch }}</dd>
                </template>
                <template v-if="(view.machine.uptime_ms !== null)">
                    <dt>Up</dt>
                    <dd>{{ format_ms(view.machine.uptime_ms) }}</dd>
                </template>
                <template v-if="(view.machine.tailnet !== null) && (view.machine.tailnet !== undefined)">
                    <dt>Tailnet</dt>
                    <dd><code v-if="(view.machine.tailnet.name !== null)">{{ view.machine.tailnet.name }}</code><template v-if="((view.machine.tailnet.name !== null) && (view.machine.tailnet.ip !== null))"> · </template><code v-if="(view.machine.tailnet.ip !== null)">{{ view.machine.tailnet.ip }}</code></dd>
                </template>
                <template v-if="(addresses.length > 0)">
                    <dt>Addresses</dt>
                    <dd><template v-for="(address, i) in addresses" :key="address"><template v-if="(i > 0)"> · </template><code>{{ address }}</code></template></dd>
                </template>
                <dt>Docker</dt>
                <dd>
                    <span v-if="(view.machine.docker !== null)">{{ view.machine.docker }}</span>
                    <span v-else class="bad">none — a service on it cannot start</span>
                </dd>
            </overview-card>
            <overview-card v-if="(view.machine !== null)" icon="robot" title="Agent" tab="configure" go="Configure" @tab="$emit('tab', $event)">
                <template #aside>
                    {{ view.agent_version }}
                    <agent-pill-short :current="current"/>
                </template>
                <dt>Built</dt>
                <dd>{{ ((view.agent_built === null) ? 'before builds were dated' : view.agent_built) }}</dd>
                <dt>Node</dt>
                <dd>{{ view.machine.node }}</dd>
                <template v-if="(view.machine.user !== null)">
                    <dt>Runs as</dt>
                    <dd>{{ view.machine.user }}</dd>
                </template>
                <template v-if="(view.machine.can !== null)">
                    <dt>Root half</dt>
                    <dd>
                        <span v-if="view.machine.can.includes('root')">answers on this machine</span>
                        <span v-else class="muted">none — it does what its own user may do</span>
                    </dd>
                </template>
                <template v-if="view.update_refused">
                    <dt>Update</dt>
                    <dd><span class="bad">refused: {{ view.update_refused }}</span></dd>
                </template>
            </overview-card>
            <overview-card v-if="(updates !== null)" icon="download" title="Updates" tab="configure" go="Configure" @tab="$emit('tab', $event)">
                <template #aside>
                    <span v-if="((updates.pending === 0) && (lists !== null) && lists.old)" class="pill">lists {{ lists.days }} days old</span>
                    <span v-else-if="(updates.pending === 0)" class="pill running">up to date</span>
                    <span v-else-if="((updates.pending > 0) && (updates.security > 0))" class="pill failed">{{ updates.security }} security</span>
                    <span v-else-if="(updates.pending > 0)" class="pill starting">{{ updates.pending }} to install</span>
                </template>
                <dt>Waiting</dt>
                <dd>{{ updates_waiting }}</dd>
                <template v-if="(lists !== null)">
                    <dt>Lists</dt>
                    <dd :class="(lists.old ? 'bad' : '')" :title="(lists.old ? 'What was published since is not counted; Install fetches them first' : '')">fetched {{ lists.ago }}</dd>
                </template>
                <template v-if="updates.reboot">
                    <dt>Restart</dt>
                    <dd><span class="bad">an installed update wants one</span></dd>
                </template>
            </overview-card>
            <overview-card v-if="view.logline" icon="file" title="Logs" tab="logs" go="Logs" @tab="$emit('tab', $event)">
                <template #aside>
                    <span v-if="logs_sent" class="pill running">sent to Logline</span>
                    <span v-else class="pill">off</span>
                </template>
                <template v-if="(logs_sent === false)" #note><span class="muted">This machine's logs stay on it.</span></template>
                <template v-if="(logs_sent && view.logline.status)">
                    <dt>Sent</dt>
                    <dd>{{ view.logline.status.sent.lines.toLocaleString() }} lines</dd>
                    <dt>Waiting</dt>
                    <dd>{{ view.logline.status.waiting.lines.toLocaleString() }} lines</dd>
                </template>
                <template v-if="(logs_sent && view.logline.error)">
                    <dt>Error</dt>
                    <dd><span class="bad">{{ view.logline.error }}</span></dd>
                </template>
                <template v-if="logline_url">
                    <dt>Viewer</dt>
                    <dd><a :href="logline_url" target="_blank" rel="noopener">its lines, the last 24 hours ↗</a></dd>
                </template>
            </overview-card>
        </div>
        <details class="card ov-details" :open="raw_open">
            <summary @click.prevent="raw_toggle">Raw state<button type="button" class="ov-copy" @click.stop.prevent="raw_copy">{{ (copied ? 'Copied' : 'Copy') }}</button></summary>
            <pre v-if="raw_open">{{ raw }}</pre>
        </details>
    </div>
</article>
`,
    components: {'agent-pill-short': agent_pill_short, 'link-test-panel': link_test_panel, 'overview-card': overview_card, 'overview-tile': overview_tile, 'remote-charts': remote_charts, 'remote-uptime': remote_uptime, 'services-pane': services_pane},
    // state: the whole status, for the table of the services on it
    props: ['view', 'state', 'served', 'logline'],
    emits: ['create', 'select_named', 'tab'],
    data: function () {
        // The raw state stays open while the pane is drawn again with every beat of the machine
        return {raw_open: false, copied: false, copied_timer: null, link_test_open: false};
    },
    computed: {
        // Its calls waiting for answers while its link stays up, in words; '' while it answers
        unanswered_said: function () {
            return remote_unanswered_said(this.view);
        },
        // The numbers come from servermon on that machine: when they cannot, it says why, above them
        servermon_text: function () {
            const machine = this.view.machine;
            if ((this.view.phase !== 'online') || (machine === null) || (machine.servermon === null)) {
                return null;
            }
            if (machine.servermon.state === 'off') {
                return 'No numbers: servermon does not run here, as the agent keeps no log folder (SERVICEMAN_LOG_DIR).';
            }
            if (machine.servermon.state === 'silent') {
                const last_at = machine.servermon.last_at;
                return `No numbers: servermon ${(last_at === null) ? 'has written nothing yet' : `has been silent since ${last_at.replace('T', ' ').slice(0, 19)}`}. The agent starts it again within a minute.`;
            }
            return null;
        },
        // CPU, memory, disk and how long it is up; while it is not linked, what each last said
        // and how long it is down, red
        tiles: function () {
            const view = this.view;
            const machine = view.machine;
            const shares = machine_shares(machine);
            const online = (view.phase === 'online');
            const at = online ? '' : ` at ${clock_of(view.left_at)}`;
            const out = [];
            const cpu = shares.cpu;
            const load = (machine.load === null) ? '' : ` · load ${machine.load.toFixed(1)}`;
            out.push(Object.assign({icon: 'cpu', label: 'CPU'}, online ? {text: (cpu === null) ? '—' : share_words(cpu), unit: (cpu === null) ? undefined : '%', value: (cpu === null) ? 0 : cpu, note: `of ${machine.cpu.count} ${(machine.cpu.count === 1) ? 'core' : 'cores'}${load}`} : {text: '—', value: null, note: (cpu === null) ? 'nothing said' : `last: ${share_words(cpu)}%${at}`, tone: 'off'}));
            const mem = machine.mem;
            const mem_used = shares.memory;
            const mem_note = ((mem.free === null) || (mem.total === null)) ? format_bytes(mem.total) : `${size_words(mem.total - mem.free)} of ${size_words(mem.total)} · ${size_words(mem.free)} free`;
            out.push(Object.assign({icon: 'memory', label: 'Memory'}, online ? {text: (mem_used === null) ? '—' : share_words(mem_used), unit: (mem_used === null) ? undefined : '%', value: (mem_used === null) ? 0 : mem_used, note: mem_note} : {text: '—', value: null, note: (mem.free === null) ? 'nothing said' : `last: ${size_words(mem.total - mem.free)} of ${size_words(mem.total)}`, tone: 'off'}));
            const disk = machine.disk;
            const disk_used = shares.disk;
            const disk_note = (disk.free === null) ? `${size_words(disk.total)} on ${disk.path}` : `${size_words(disk.total - disk.free)} of ${size_words(disk.total)}`;
            out.push(Object.assign({icon: 'database', label: 'Disk'}, online ? {text: (disk_used === null) ? '—' : share_words(disk_used), unit: (disk_used === null) ? undefined : '%', value: (disk_used === null) ? 0 : disk_used, note: disk_note, go: 'What takes it', tab: 'disks'} : {text: '—', value: null, note: (disk_used === null) ? 'nothing said' : `last: ${share_words(disk_used)}% of ${size_words(disk.total)}`, tone: 'off'}));
            if (online) {
                const up = machine.uptime_ms;
                out.push({icon: 'clock', label: 'Up', text: (up === null) ? '—' : uptime_words(up).n, unit: (up === null) ? undefined : uptime_words(up).unit, value: null, note: (up === null) ? 'not said' : `since ${day_of(Date.now() - up)}`});
            }
            else if (view.left_at !== null) {
                out.push({icon: 'clock', label: 'Down for', text: format_ms(Date.now() - view.left_at), value: null, note: `since ${clock_of(view.left_at)}`, tone: 'bad'});
            }
            if (online && (machine.temperature !== null)) {
                out.push({icon: 'thermometer', label: 'Temperature', text: `${machine.temperature.c}°C`, value: machine.temperature.c/100, note: machine.temperature.of});
            }
            if (online && (machine.battery !== null)) {
                out.push({icon: 'battery', label: 'Battery', text: `${machine.battery.percent}%`, value: null, note: machine.battery.status});
            }
            if (online) {
                out.push({icon: 'link', label: 'Link', text: (view.latency_ms === null) ? '—' : format_ms(view.latency_ms), value: null, note: (view.throughput_bps === null) ? 'not measured yet' : format_bps(view.throughput_bps), go: 'Test the link', tab: 'link-test'});
            }
            return out;
        },
        addresses: function () {
            const found = this.view.machine.addresses;
            return Array.isArray(found) ? found : [];
        },
        current: function () {
            return agent_current(this.view, (this.served === undefined) ? null : this.served);
        },
        updates: function () {
            return (this.view.machine === null) ? null : this.view.machine.updates;
        },
        // How old apt's lists are, so how old the count is
        lists: function () {
            return updates_lists(this.updates, Date.now());
        },
        updates_waiting: function () {
            const updates = this.updates;
            if (updates.pending === null) {
                return 'unknown';
            }
            // Kept back by apt, phased updates above all: they come when Ubuntu hands them out
            const held = (updates.held > 0) ? `; ${updates.held} held back by Ubuntu` : '';
            if (updates.pending === 0) {
                return `nothing${held}`;
            }
            return `${updates.pending}${(updates.security > 0) ? `, ${updates.security} of them security` : ''}${held}`;
        },
        logs_sent: function () {
            return (this.view.logline.logs === 'all');
        },
        logline_url: function () {
            return logline_link(this.logline, 'remote', this.view.name);
        },
        raw: function () {
            return JSON.stringify(this.view, null, 2);
        },
    },
    methods: {
        format_ms,
        // A tile's link opens a tab, except the Link tile's, which opens its test right here
        tile_go: function (tab) {
            if (tab === 'link-test') {
                this.link_test_open = true;
                return;
            }
            this.$emit('tab', tab);
        },
        raw_toggle: function () {
            this.raw_open = (this.raw_open === false);
        },
        // The text is taken when the button is pressed, so it is what the machine said last
        raw_copy: async function () {
            this.copied = await to_clipboard(this.raw);
            clearTimeout(this.copied_timer);
            this.copied_timer = setTimeout(this.copied_forget, COPIED_MS);
        },
        copied_forget: function () {
            this.copied = false;
        },
    },
    unmounted: function () {
        clearTimeout(this.copied_timer);
    },
};

// How long a machine is up, in its one biggest unit: {n: '41', unit: 'd'}, '5', 'h', '12', 'm'
function uptime_words(ms)
{
    if (ms >= DAY_MS) {
        return {n: String(Math.floor(ms/DAY_MS)), unit: 'd'};
    }
    if (ms >= 3600*1000) {
        return {n: String(Math.floor(ms/(3600*1000))), unit: 'h'};
    }
    return {n: String(Math.max(1, Math.floor(ms/60000))), unit: 'm'};
}

// A day as the tile says it: 8 October
function day_of(ms)
{
    const at = new Date(ms);
    return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

// A share as the tiles say it, its number alone: 0.23 is "23"
function share_words(share)
{
    return String(Math.round(share*100));
}

export default remote_overview;
