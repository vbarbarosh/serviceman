import format_ms from './format_ms.js';
import overview_card from './overview_card.js';
import remote_charts from './remote_charts.js';
import remote_unanswered_said from './remote_unanswered_said.js';
import remote_uptime from './remote_uptime.js';
import to_clipboard from './to_clipboard.js';

// How long the Copy button says it copied
const COPIED_MS = 1500;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A remote's Overview tab: what no other tab of its page shows. Its uptime by day in one row, its
// history, the machine as a card, and the raw state folded away at the end; its name, its state
// and its CPU, memory and disk are the page's head. What a tab of its own shows is not said here
// again: its services are the Services tab, its agent and its updates Configure, its logs Logs.
// It is drawn again with every beat of the machine.
const remote_overview = {
    template: `
<article id="detail" class="ov-pane">
    <div class="ov">
        <p v-if="(unanswered_said !== '')" class="alert">{{ unanswered_said }}. What is below waits for it.</p>
        <p v-if="view.error" class="alert"><strong>Last error</strong> · {{ view.error }}</p>
        <p v-if="servermon_text" class="alert">{{ servermon_text }}</p>
        <p v-if="(view.machine === null)" class="muted">Nothing is known about this machine yet: what it is, its uptime and its history show here once its agent dials in.</p>
        <remote-uptime v-if="(view.machine !== null)" :view="view" @tab="$emit('tab', $event)"/>
        <remote-charts v-if="(view.machine !== null)" :view="view" :charts="charts" @range="$emit('range', $event)" @tab="$emit('tab', $event)"/>
        <div v-if="(view.machine !== null)" class="ov-cards">
            <overview-card icon="monitor" title="Machine">
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
        </div>
        <details class="card ov-details" :open="raw_open">
            <summary @click.prevent="raw_toggle">Raw state<button type="button" class="ov-copy" @click.stop.prevent="raw_copy">{{ (copied ? 'Copied' : 'Copy') }}</button></summary>
            <pre v-if="raw_open">{{ raw }}</pre>
        </details>
    </div>
</article>
`,
    components: {'overview-card': overview_card, 'remote-charts': remote_charts, 'remote-uptime': remote_uptime},
    // charts: History's numbers as its page reads them, the head's reading among them
    // (remote_charts says their shape); @range: a span picked in History's head
    props: ['view', 'charts'],
    emits: ['range', 'tab'],
    data: function () {
        // The raw state stays open while the pane is drawn again with every beat of the machine
        return {raw_open: false, copied: false, copied_timer: null};
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
        raw: function () {
            return JSON.stringify(this.view, null, 4);
        },
    },
    methods: {
        day_of,
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
