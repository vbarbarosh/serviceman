import data_table from './data_table.js';
import format_ms from './format_ms.js';
import overview_card from './overview_card.js';

// What tailscale's BackendState means for serviceman, in a visitor's words, and its dot
const STATES = {
    Running: {text: 'on the tailnet', dot: 'running'},
    NeedsLogin: {text: 'waits for a sign-in', dot: 'stopping'},
    NeedsMachineAuth: {text: 'waits for the tailnet\'s admin to approve it', dot: 'stopping'},
    Starting: {text: 'starting', dot: 'starting'},
    Stopped: {text: 'stopped', dot: 'failed'},
    NoState: {text: 'not started', dot: 'failed'},
};

// The calls to tailscale as the table shows them: the result takes the room, the time and how
// long fold away on a narrow screen
const COLUMNS = [
    {key: 'at', label: 'When', fold: 2},
    {key: 'command', label: 'Call', wraps: true},
    {key: 'ms', label: 'Took', align: 'right', fold: 1},
    {key: 'error', label: 'What came back', wraps: true},
];

// Everything serviceman does with tailscale, on one page: its name and address on the tailnet,
// the certificate the apps' own ports answer https with, the apps' names it answers on the
// tailnet, the way out to it, and every call it made to tailscale lately (tailscale_view). Asked
// when the page opens and again on Refresh: each ask is a call to tailscale too.
const tailscale_pane = {
    template: `
<article id="detail" class="list tailscale">
    <div class="list-head">
        <h1>Tailscale</h1>
        <span v-if="(view !== null)"><span class="dot" :class="said.dot"></span> {{ said.text }}</span>
        <div class="list-acts">
            <button type="button" :disabled="loading" @click="load">{{ (loading ? 'Asking…' : 'Refresh') }}</button>
        </div>
    </div>
    <p class="muted">What serviceman does with tailscale in its image: its name and address on the tailnet, the certificate for https on the apps' own ports, the apps' names it answers on the tailnet, the way out to the tailnet, and each call it made to tailscale.</p>
    <p v-if="(error !== '')" class="bad">{{ error }}</p>
    <template v-if="(view !== null)">
        <p v-if="(view.here === false)" class="card tailscale-say">No tailscale here: serviceman runs outside its image, so it has no name on a tailnet, no certificate and no apps' names there. In its image tailscale comes with it.</p>
        <p v-else-if="(view.login_link !== null)" class="card tailscale-say">This machine is not signed in to a tailnet yet: open <a :href="view.login_link" target="_blank" rel="noopener">{{ view.login_link }}</a> and sign in, or start serviceman with <code>TS_AUTHKEY</code>.</p>
        <div v-if="view.here" class="ov-cards">
            <overview-card icon="monitor" title="This serviceman">
                <dt>Name</dt><dd>{{ view.name || 'none yet' }}</dd>
                <dt>Address</dt><dd>{{ (view.addresses.length > 0) ? view.addresses.join(', ') : 'none yet' }}</dd>
                <dt>Tailnet</dt><dd>{{ view.tailnet || 'none yet' }}</dd>
                <dt>MagicDNS</dt><dd>{{ (view.magic_dns === null) ? 'not said' : (view.magic_dns ? 'on' : 'off: names on the tailnet do not resolve') }}</dd>
                <dt>tailscale</dt><dd>{{ view.version || 'not said' }}</dd>
            </overview-card>
            <overview-card icon="lock" title="The certificate">
                <template #note>
                    <span v-if="(view.certificate.wanted === false)" class="muted">Not asked: the apps are off the tailnet (Apps, On the tailnet), so no port answers https and none is wanted.</span>
                    <span v-else-if="view.certificate.held">For {{ view.certificate.domain }}, until {{ day_of(view.certificate.until) }}: the apps' own ports answer https.</span>
                    <span v-else-if="(view.certificate.error !== null)" class="bad">None: {{ view.certificate.error }}. <template v-if="(https_off !== null)">{{ https_off.fix }} <a v-if="(https_off.link !== null)" :href="https_off.link.href" target="_blank" rel="noopener">{{ https_off.link.text }}</a></template></span>
                    <span v-else class="muted">Not asked yet: serviceman asks once it has a name on the tailnet.</span>
                </template>
                <dt>Given for</dt><dd>{{ (view.certificate.wanted === false) ? 'none wanted' : ((view.cert_domains.length > 0) ? view.cert_domains.join(', ') : ((view.state === 'Running') ? 'no name: HTTPS is off for the tailnet' : 'none yet: not on a tailnet')) }}</dd>
                <dt>Last asked</dt><dd>{{ (view.certificate.asked_at === null) ? 'not yet' : time_of(view.certificate.asked_at) }}</dd>
            </overview-card>
            <overview-card icon="globe" title="The apps' names">
                <template #note>
                    <span v-if="(view.apps_dns === null)" class="muted">Not answered: the config sets no <code>apps.dns</code>, so names under the apps domain are not answered on the tailnet. {{ ((view.certificate.wanted === false) ? 'Nor has an app a port of its own on serviceman’s name: the apps are off the tailnet.' : 'Each app still has its own port on serviceman’s name.') }}</span>
                    <span v-else>Names under {{ view.apps_dns.domain }} answered on port {{ view.apps_dns.port }}, each as {{ view.apps_dns.address || 'this machine, once tailscale says its address' }}.</span>
                </template>
            </overview-card>
            <overview-card icon="arrow" title="The way out">
                <template #note>
                    <span v-if="(view.proxy !== null)">Through tailscale's proxy at <code>{{ view.proxy }}</code>: what serviceman dials on the tailnet, Logline first, goes through it.</span>
                    <span v-else class="muted">Straight: no proxy is set, so serviceman dials the tailnet as this machine's own tailscale routes it.</span>
                </template>
            </overview-card>
        </div>
        <h2>Calls to tailscale</h2>
        <data-table :columns="COLUMNS" :rows="view.calls" :row_key="key_of" empty="None yet: serviceman has not asked tailscale anything.">
            <template #cell="{row, column}">
                <template v-if="(column.key === 'at')">{{ time_of(row.at) }}</template>
                <code v-else-if="(column.key === 'command')">{{ row.command }}</code>
                <template v-else-if="(column.key === 'ms')">{{ format_ms(row.ms) }}</template>
                <span v-else :class="((row.error === null) ? 'ok' : 'bad')">{{ (row.error === null) ? 'ok' : row.error }}</span>
            </template>
        </data-table>
    </template>
</article>
`,
    components: {'data-table': data_table, 'overview-card': overview_card},
    props: {
        state: {type: Object, required: true},
    },
    data: function () {
        // view: what GET /api/v1/tailscale said last, null before; error: why the last ask failed
        return {view: null, loading: false, error: '', COLUMNS};
    },
    computed: {
        said: function () {
            if (this.view.here === false) {
                return {text: 'no tailscale here', dot: 'stopped'};
            }
            if (this.view.error !== null) {
                return {text: this.view.error, dot: 'failed'};
            }
            return STATES[this.view.state] || {text: this.view.state || 'not said', dot: 'stopped'};
        },
        // What mends a certificate refused, and the page that does, as Health says it
        // (problems_of_tailnet_cert); null while there is nothing to mend
        https_off: function () {
            const tailnet = this.state.tailnet;
            return ((tailnet === undefined) || (tailnet === null) || (tailnet.https_off === undefined)) ? null : tailnet.https_off;
        },
    },
    methods: {
        load: async function () {
            this.loading = true;
            try {
                const answer = await fetch('/api/v1/tailscale');
                if (answer.ok === false) {
                    throw new Error(`serviceman answered ${answer.status}`);
                }
                this.view = await answer.json();
                this.error = '';
            }
            catch (error) {
                this.error = `The Tailscale page could not be read: ${error.message}`;
            }
            finally {
                this.loading = false;
            }
        },
        key_of: function (row) {
            return row.at + ' ' + row.command;
        },
        time_of: function (ms) {
            return new Date(ms).toLocaleTimeString();
        },
        day_of: function (text) {
            return new Date(text).toLocaleDateString();
        },
        format_ms,
    },
    created: function () {
        this.load();
    },
};

export default tailscale_pane;
