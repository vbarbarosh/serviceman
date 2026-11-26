import agent_current from './agent_current.js';
import agent_pill_short from './agent_pill_short.js';
import format_bps from './format_bps.js';
import format_ms from './format_ms.js';
import link_test_panel from './link_test_panel.js';
import logline_link from './logline_link.js';
import overview_card from './overview_card.js';
import remote_charts from './remote_charts.js';
import remote_unanswered_said from './remote_unanswered_said.js';
import remote_uptime from './remote_uptime.js';
import services_pane from './services_pane.js';
import to_clipboard from './to_clipboard.js';
import updates_lists from './updates_lists.js';

// How long the Copy button says it copied
const COPIED_MS = 1500;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A remote's Overview tab: the services it carries as a table, its uptime by day in one row, its
// history, what it is as cards (its link and its test among them), and the raw state folded away
// at the end; its name, its state and its CPU, memory and disk are the page's head. It is drawn
// again with every beat of the machine.
const remote_overview = {
    template: `
<article id="detail" class="ov-pane">
    <div class="ov">
        <p v-if="(unanswered_said !== '')" class="alert">{{ unanswered_said }}. What is below waits for it.</p>
        <p v-if="view.error" class="alert"><strong>Last error</strong> · {{ view.error }}</p>
        <p v-if="servermon_text" class="alert">{{ servermon_text }}</p>
        <link-test-panel v-if="((view.machine !== null) && link_test_open)" :view="view" @close="link_test_open = false"/>
        <services-pane :state="state" :remote="view.name" embedded @create="$emit('create')" @select="$emit('select_named', $event)"/>
        <remote-uptime v-if="(view.machine !== null)" :view="view" @tab="$emit('tab', $event)"/>
        <remote-charts v-if="(view.machine !== null)" :view="view" :charts="charts" @tab="$emit('tab', $event)"/>
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
                    <dd>{{ format_ms(view.machine.uptime_ms) }}, since {{ day_of(Date.now() - view.machine.uptime_ms) }}</dd>
                </template>
                <template v-if="(view.machine.temperature !== null) && (view.machine.temperature !== undefined)">
                    <dt>Temperature</dt>
                    <dd>{{ view.machine.temperature.c }}°C<span class="muted"> · {{ view.machine.temperature.of }}</span></dd>
                </template>
                <template v-if="(view.machine.battery !== null) && (view.machine.battery !== undefined)">
                    <dt>Battery</dt>
                    <dd>{{ view.machine.battery.percent }}%<span class="muted"> · {{ view.machine.battery.status }}</span></dd>
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
                <template v-if="(view.phase === 'online')">
                    <dt>Link</dt>
                    <dd>{{ (view.latency_ms === null) ? '—' : format_ms(view.latency_ms) }}<span class="muted"> · {{ (view.throughput_bps === null) ? 'not measured yet' : format_bps(view.throughput_bps) }}</span> <button type="button" class="link" @click="link_test_open = true">Test the link</button></dd>
                </template>
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
    components: {'agent-pill-short': agent_pill_short, 'link-test-panel': link_test_panel, 'overview-card': overview_card, 'remote-charts': remote_charts, 'remote-uptime': remote_uptime, 'services-pane': services_pane},
    // state: the whole status, for the table of the services on it; charts: its numbers as its
    // page reads them for its head and History both (remote_charts says their shape)
    props: ['view', 'state', 'served', 'logline', 'charts'],
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
            return JSON.stringify(this.view, null, 4);
        },
    },
    methods: {
        day_of,
        format_bps,
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

// A day as the Machine card says it: 8 October
function day_of(ms)
{
    const at = new Date(ms);
    return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

export default remote_overview;
