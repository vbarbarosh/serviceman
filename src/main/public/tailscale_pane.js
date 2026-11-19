import data_table from './data_table.js';
import format_ms from './format_ms.js';
import page_head from './page_head.js';
import state_pill from './state_pill.js';

// tailscale's mark, nine dots, for its tiles
const TS_ICON = '<circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>';

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
// when the page opens and again on Refresh: each ask is a call to tailscale too. On top, while
// the apps are on the tailnet, the switch that says their links are http everywhere or here
// alone ("apps": {"http_said"}), read from the page's state as it is polled.
const tailscale_pane = {
    template: `
<article id="detail" class="list tailscale">
    <page-head category="tailscale">
        <template #state><span v-if="(view !== null)" class="page-head-count"><span class="dot" :class="said.dot"/> {{ said.text }}</span></template>
        <template #acts>
            <button type="button" :disabled="loading" @click="load">{{ (loading ? 'Asking…' : 'Refresh') }}</button>
        </template>
        <template #how>
            <p>What serviceman does with tailscale in its image: its name and address on the tailnet, the certificate for https on the apps' own ports, the apps' names it answers on the tailnet, the way out to the tailnet, and each call it made to tailscale.</p>
        </template>
    </page-head>
    <p v-if="(error !== '')" class="bad">{{ error }}</p>
    <template v-if="(view !== null)">
        <!-- Not on a tailnet, or not signed in yet: one card that says so, as drawn -->
        <div v-if="(view.here === false)" class="card ts-state">
            <span class="ts-tile"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" v-html="TS_ICON"/></span>
            <div><b>No tailscale here</b><p class="muted">serviceman runs outside its image, so it has no name on a tailnet, no certificate and no apps' names there. In its image tailscale comes with it.</p></div>
        </div>
        <div v-else-if="(view.login_link !== null)" class="card ts-state">
            <span class="ts-tile warn"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" v-html="TS_ICON"/></span>
            <div><b>Not signed in to a tailnet yet</b><p class="muted">Open <a :href="view.login_link" target="_blank" rel="noopener">{{ view.login_link }}</a> and sign in, or start serviceman with <code>TS_AUTHKEY</code>.</p></div>
        </div>
        <div v-if="http_switch_shown" class="tailscale-http">
            <label class="tailscale-http-label" for="tailscale-http-pick">Say that the apps' tailnet links are http:</label>
            <select id="tailscale-http-pick" :value="(http_said ? 'on' : 'off')" :disabled="http_busy" @change="change_http_said($event.target.value === 'on')">
                <option value="on">on: on every page</option>
                <option value="off">off: on this page alone</option>
            </select>
            <span v-if="(https_off !== null)" class="tailscale-http-why">{{ https_off.why }}: they open over http. <a v-if="(https_off.link !== null)" :href="https_off.link.href" target="_blank" rel="noopener">{{ https_off.link.text }} ↗</a></span>
            <span v-else class="muted">{{ (view.certificate.held ? 'they open over https: nothing to say' : 'nothing to say yet') }}</span>
        </div>
        <p v-if="(http_error !== '')" class="bad tailscale-http-says">{{ http_error }}</p>
        <!-- How it stands on the tailnet, as drawn: a card each, its tile, what it is and one line;
             the rest of what is known under it, small -->
        <div v-if="view.here" class="ts-cards">
            <div v-for="card of cards" :key="card.key" class="card ts-card">
                <span class="ts-tile" :class="card.tone"><svg viewBox="0 0 24 24" width="22" height="22" :fill="((card.key === 'tailnet') ? 'currentColor' : 'none')" stroke="currentColor" :stroke-width="((card.key === 'tailnet') ? 0 : 2)" aria-hidden="true" v-html="card.icon"/></span>
                <div class="ts-card-body">
                    <b>{{ card.title }}</b>
                    <span :class="{mono: card.mono, bad: (card.tone === 'bad')}">{{ card.line }}<template v-if="(card.link !== null)"> <a :href="card.link.href" target="_blank" rel="noopener">{{ card.link.text }} ↗</a></template></span>
                    <small v-if="(card.more !== '')" class="muted">{{ card.more }}</small>
                </div>
            </div>
        </div>
        <data-table framed title="Calls to tailscale" :columns="COLUMNS" :rows="view.calls" :row_key="key_of" :row_class="(row => ((row.error === null) ? '' : 'dt-bad'))" :foot="((view.calls.length === 0) ? null : [{text: (view.calls.length + ' ' + ((view.calls.length === 1) ? 'call' : 'calls') + ', the newest first'), tone: ''}])" empty="None yet: serviceman has not asked tailscale anything.">
            <template #cell="{row, column}">
                <template v-if="(column.key === 'at')">{{ time_of(row.at) }}</template>
                <code v-else-if="(column.key === 'command')">{{ row.command }}</code>
                <template v-else-if="(column.key === 'ms')">{{ format_ms(row.ms) }}</template>
                <state-pill v-else :tone="((row.error === null) ? 'run' : 'bad')" :text="((row.error === null) ? 'ok' : row.error)"/>
            </template>
        </data-table>
    </template>
</article>
`,
    components: {'data-table': data_table, 'page-head': page_head, 'state-pill': state_pill},
    props: {
        state: {type: Object, required: true},
    },
    emits: ['saved'],
    data: function () {
        // view: what GET /api/v1/tailscale said last, null before; error: why the last ask failed
        // http_picked: the switch's pick while it is saved and until the page's state has it,
        // null otherwise; http_busy: it is being saved; http_error: why its last save was refused
        return {view: null, loading: false, error: '', http_picked: null, http_busy: false, http_error: '', COLUMNS, TS_ICON};
    },
    computed: {
        // The three cards, as drawn: on the tailnet and by what name, the certificate, the apps'
        // names; each {key, icon, tone, title, line, mono, link, more}
        cards: function () {
            const view = this.view;
            const certificate = view.certificate;
            const on = (view.state === 'Running') && (view.error === null);
            const facts = [(view.addresses.length > 0) ? view.addresses.join(', ') : '', (view.magic_dns === false) ? 'MagicDNS off' : '', (view.version === null) ? '' : `tailscale ${view.version}`, (view.proxy === null) ? 'the way out straight' : `the way out through ${view.proxy}`].filter(v => v !== '');
            const tailnet = {key: 'tailnet', icon: TS_ICON, tone: on ? 'ok' : 'warn', title: capital(this.said.text), line: view.name || 'no name yet', mono: (view.name !== null), link: null, more: facts.join(' · ')};
            const cert = {key: 'certificate', icon: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', tone: '', title: 'Certificate', line: '', mono: false, link: null, more: ''};
            if (certificate.wanted === false) {
                cert.line = 'not wanted: the apps are off the tailnet';
            }
            else if (certificate.held) {
                cert.line = `valid until ${this.day_of(certificate.until)}`;
                cert.more = `for ${certificate.domain}${(certificate.asked_at === null) ? '' : ` · asked ${this.time_of(certificate.asked_at)}`}`;
            }
            else if (certificate.error !== null) {
                cert.tone = 'bad';
                cert.line = `none: ${certificate.error}`;
                cert.link = ((this.https_off === null) || (this.https_off.link === null)) ? null : this.https_off.link;
                cert.more = (this.https_off === null) ? '' : this.https_off.fix;
            }
            else {
                cert.line = 'not asked yet: once it has a name on the tailnet';
            }
            const dns = view.apps_dns;
            const apps = {key: 'apps', icon: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 13v7M13 16.5h7"/>', tone: '', title: (dns === null) ? 'Apps at their own ports' : `Names under ${dns.domain}`, line: (dns === null) ? ((certificate.wanted === false) ? 'the apps are off the tailnet' : 'each at its own port on the tailnet') : `answered on port ${dns.port}`, mono: false, link: null, more: (dns === null) ? 'no apps.dns in the config: names under the apps domain are not answered there' : `each as ${dns.address || 'this machine, once tailscale says its address'}`};
            return [tailnet, cert, apps];
        },
        said: function () {
            if (this.view.here === false) {
                return {text: 'no tailscale here', dot: 'stopped'};
            }
            if (this.view.error !== null) {
                return {text: this.view.error, dot: 'failed'};
            }
            return STATES[this.view.state] || {text: this.view.state || 'not said', dot: 'stopped'};
        },
        // Why the apps' tailnet links are http, what mends it and the page that does, as Health
        // says it (problems_of_tailnet_cert), {why, fix, link}; null while nothing is missing.
        // Said here even while the switch keeps it off every other page
        https_off: function () {
            const certificate = this.view.certificate;
            return ((certificate.https_off === undefined) || (certificate.https_off === null)) ? null : certificate.https_off;
        },
        // Whether Apps, Addresses, Health and the page of apps say that the apps' tailnet links
        // are http ("apps": {"http_said"}), or this page alone
        http_said: function () {
            return (this.http_picked !== null) ? this.http_picked : (this.state.apps.http_said !== false);
        },
        // The switch, wherever the apps are on the tailnet: with nothing to say it is harmless
        http_switch_shown: function () {
            return this.view.here && (this.state.apps.ports !== null);
        },
    },
    watch: {
        // The pick holds until the page's state says the same, then the config speaks again
        'state.apps.http_said': function () {
            if ((this.http_picked !== null) && ((this.state.apps.http_said !== false) === this.http_picked)) {
                this.http_picked = null;
            }
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
        // Said everywhere or on this page alone, kept in the config: at once, with no restart
        change_http_said: async function (said) {
            this.http_picked = said;
            this.http_busy = true;
            this.http_error = '';
            try {
                const answer = await fetch('/api/v1/apps', {method: 'PUT', body: JSON.stringify({http_said: said})});
                if (answer.ok === false) {
                    throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
                }
                // The state may have it already, and then no change comes to let the pick go
                if ((this.state.apps.http_said !== false) === said) {
                    this.http_picked = null;
                }
                this.$emit('saved');
            }
            catch (error) {
                this.http_picked = null;
                this.http_error = error.message;
            }
            finally {
                this.http_busy = false;
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

// A sentence's first letter up: "on the tailnet" heads its card as "On the tailnet"
function capital(text)
{
    return text.slice(0, 1).toUpperCase() + text.slice(1);
}

export default tailscale_pane;
