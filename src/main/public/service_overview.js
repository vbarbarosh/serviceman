// How many of the lines it said the Overview shows, the newest
const LINES_SHOWN = 6;

// A service's Overview: what no other tab of its page shows, its newest lines as serviceman keeps
// them of what it printed; its Logs tab is Logline's, empty where Logline is not set. What runs
// and its addresses are its Settings', with Edit there; how long it is up and its machine's
// numbers are in the head above it, its failed starts in the note there. Only what serviceman
// drives, a program or an image, prints lines and has an Overview (service_tab_allowed).
//
//     view       a service of the status: {phase, said: ['…', …], …}
//     @logs      All logs picked
//     @settings  Settings picked
const service_overview = {
    template: `
<article id="detail" class="list svc-ov">
    <section class="card svc-lines">
        <div class="card-head">
            <h2><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 11h11M4 16h16M4 21h8"/></svg>Its newest lines</h2>
            <button type="button" class="link" @click="$emit('logs')">All logs →</button>
        </div>
        <pre v-if="(lines.length > 0)" class="svc-tail">{{ lines.join('\\n') }}</pre>
        <p v-else class="muted svc-none">Nothing said yet{{ (view.phase === 'running') ? '' : ': it says its lines once it runs' }}.</p>
    </section>
    <p class="muted svc-ov-more">What runs and its addresses: on <button type="button" class="link" @click="$emit('settings')">Settings</button>.</p>
</article>
`,
    props: ['view'],
    emits: ['logs', 'settings'],
    computed: {
        lines: function () {
            return ((this.view.said === undefined) ? [] : this.view.said).slice(-LINES_SHOWN);
        },
    },
};

export default service_overview;
