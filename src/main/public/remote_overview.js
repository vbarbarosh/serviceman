import agent_current from './agent_current.js';
import format_bps from './format_bps.js';
import format_bytes from './format_bytes.js';
import format_ms from './format_ms.js';
import format_ms_ago from './format_ms_ago.js';
import logline_link from './logline_link.js';
import overview_card from './overview_card.js';
import overview_tile from './overview_tile.js';
import remote_charts from './remote_charts.js';
import to_clipboard from './to_clipboard.js';

// How long the Copy button says it copied
const COPIED_MS = 1500;

// A remote's Overview tab: its state beside the title, the numbers that move as tiles, its
// history, what it is as cards, and the raw state folded away at the end. It is drawn again
// with every beat of the machine.
const remote_overview = {
    template: `
<article id="detail" class="ov-pane">
    <div class="ov">
        <div class="ov-head">
            <h1><span class="dot" :class="dot_phase"></span>{{ (view.title || view.name) }}</h1>
            <div class="ov-aside">
                <span v-if="(view.phase === 'online')" class="pill running">online</span>
                <span v-else-if="(view.phase === 'greeting')" class="pill starting">connecting</span>
                <span v-else class="pill failed">offline</span>
            </div>
        </div>
        <div class="ov-summary">
            <span>remote <code>{{ view.name }}</code><template v-for="part in summary" :key="part.text"> · <span :class="{tag: part.tag}">{{ part.text }}</span></template></span>
        </div>
        <p v-if="(view.machine === null)" class="alert">This machine has not connected since serviceman last started, so nothing is known about it yet. A running agent dials in by itself; a machine without one needs it: <button type="button" class="link" @click="$emit('tab', 'install')">Install the agent →</button></p>
        <p v-else-if="(view.phase !== 'online')" class="alert">The agent on this machine is not connected. What is below is what it last said.</p>
        <p v-if="view.error" class="alert"><strong>Last error</strong> · {{ view.error }}</p>
        <div v-if="(view.machine !== null)" class="ov-tiles">
            <overview-tile v-for="tile in tiles" :key="tile.label" :icon="tile.icon" :label="tile.label" :value="tile.value" :note="tile.note">{{ tile.text }}</overview-tile>
        </div>
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
                    <span v-if="(current === true)" class="pill running">up to date</span>
                    <span v-if="(current === false)" class="pill starting">outdated</span>
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
            <overview-card icon="layers" title="Services" class="ov-list">
                <template #aside>{{ ((services.length === 0) ? 'none' : services.length) }}</template>
                <template v-if="(services.length === 0)" #note><span class="muted">No service uses this machine.</span></template>
                <template v-for="item in services" :key="item.name">
                    <dt><button type="button" class="link" @click="$emit('select', item)">{{ (item.title || item.name) }}</button></dt>
                    <dd><span class="pill" :class="item.phase">{{ item.phase }}</span></dd>
                </template>
            </overview-card>
            <overview-card v-if="(updates !== null)" icon="download" title="Updates" tab="configure" go="Configure" @tab="$emit('tab', $event)">
                <template #aside>
                    <span v-if="(updates.pending === 0)" class="pill running">up to date</span>
                    <span v-else-if="((updates.pending > 0) && (updates.security > 0))" class="pill failed">{{ updates.security }} security</span>
                    <span v-else-if="(updates.pending > 0)" class="pill starting">{{ updates.pending }} to install</span>
                </template>
                <dt>Waiting</dt>
                <dd>{{ updates_waiting }}</dd>
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
    components: {'overview-card': overview_card, 'overview-tile': overview_tile, 'remote-charts': remote_charts},
    props: ['view', 'services', 'served', 'logline'],
    emits: ['select', 'tab'],
    data: function () {
        // The raw state stays open while the pane is drawn again with every beat of the machine
        return {raw_open: false, copied: false, copied_timer: null};
    },
    computed: {
        dot_phase: function () {
            if (this.view.phase === 'online') {
                return 'running';
            }
            return ((this.view.phase === 'greeting') ? 'starting' : 'stopped');
        },
        // What follows "remote <name>" under the title: since when and how fast it is linked, or
        // when it was last seen, then its tags; a tag the machine declared itself is starred
        summary: function () {
            const view = this.view;
            const out = [];
            if ((view.phase === 'online') && (view.uptime_ms !== null)) {
                out.push({text: `connected ${format_ms(view.uptime_ms)} ago${view.address ? ` from ${view.address}` : ''}`, tag: false});
            }
            if ((view.phase === 'online') && (view.latency_ms !== null)) {
                out.push({text: `delay ${format_ms(view.latency_ms)} · ${format_bps(view.throughput_bps)}`, tag: false});
            }
            if ((view.phase !== 'online') && view.left_at) {
                out.push({text: `last seen ${format_ms_ago(Date.now() - view.left_at)}`, tag: false});
            }
            for (const tag of view.tags) {
                out.push({text: `#${tag}${view.tags_declared.includes(tag) ? '*' : ''}`, tag: true});
            }
            return out;
        },
        tiles: function () {
            const view = this.view;
            const machine = view.machine;
            const out = [];
            const cpu = machine.cpu_busy;
            out.push({icon: 'cpu', label: 'CPU', text: ((cpu === null) ? '—' : `${Math.round(cpu*100)}%`), value: ((cpu === null) ? 0 : cpu), note: `${(machine.load === null) ? '' : `load ${machine.load.toFixed(2)} · `}${machine.cpu.count} × ${machine.cpu.model}`});
            const mem = machine.mem;
            const mem_used = ((mem.free === null) ? null : 1 - mem.free/mem.total);
            out.push({icon: 'memory', label: 'Memory', text: ((mem_used === null) ? '—' : `${Math.round(mem_used*100)}%`), value: ((mem_used === null) ? 0 : mem_used), note: `${(mem.free === null) ? '' : `${format_bytes(mem.free)} free of `}${format_bytes(mem.total)}`});
            const disk = machine.disk;
            const disk_used = 1 - disk.free/disk.total;
            out.push({icon: 'database', label: 'Disk', text: `${Math.round(disk_used*100)}%`, value: disk_used, note: `${format_bytes(disk.free)} free of ${format_bytes(disk.total)} on ${disk.path}`});
            if (machine.temperature !== null) {
                out.push({icon: 'thermometer', label: 'Temperature', text: `${machine.temperature.c}°C`, value: machine.temperature.c/100, note: machine.temperature.of});
            }
            if (machine.battery !== null) {
                out.push({icon: 'battery', label: 'Battery', text: `${machine.battery.percent}%`, value: null, note: machine.battery.status});
            }
            if (view.phase === 'online') {
                out.push({icon: 'link', label: 'Link', text: ((view.latency_ms === null) ? '—' : format_ms(view.latency_ms)), value: null, note: ((view.throughput_bps === null) ? 'not measured yet' : format_bps(view.throughput_bps))});
            }
            return out;
        },
        addresses: function () {
            const found = this.view.machine.addresses;
            return (Array.isArray(found) ? found : []);
        },
        current: function () {
            return agent_current(this.view, ((this.served === undefined) ? null : this.served));
        },
        updates: function () {
            return ((this.view.machine === null) ? null : this.view.machine.updates);
        },
        updates_waiting: function () {
            const updates = this.updates;
            if (updates.pending === null) {
                return 'unknown';
            }
            if (updates.pending === 0) {
                return 'nothing';
            }
            return `${updates.pending}${(updates.security > 0) ? `, ${updates.security} of them security` : ''}`;
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

export default remote_overview;
