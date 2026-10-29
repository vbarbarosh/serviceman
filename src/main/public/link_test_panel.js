import format_bps from './format_bps.js';
import format_ms from './format_ms.js';
import overview_icons from './overview_icons.js';

// The chart's size in its own units, drawn as wide as the panel lets it
const CHART_W = 300;
const CHART_H = 80;
// A stretch the bytes did not move for at least this long is drawn as standing
const STOOD_DRAWN_MS = 1000;
// How long the test takes on a link that moves, as the button says before it starts
const ABOUT_S = 20;
// The top of the calls' scale at least: on a quick link a call of 80 ms is no peak
const WAIT_TOP_LEAST_MS = 1000;

// A machine's link tested from its Overview: bytes both ways for a few seconds each, a quick
// call timed every quarter second all the while, and what both ends' networks dropped and sent
// again (POST …/link-test). Each way is a chart: its speed over time, red where its bytes stood,
// and in amber how long a call waited at that moment.
const link_test_panel = {
    template: `
<section class="card lt">
    <div class="lt-head">
        <span class="ov-label"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons.link"/>Link test</span>
        <span v-if="running" class="muted lt-clock"><span class="spin"/>testing · {{ elapsed_s }}s of about {{ about_s }}s</span>
        <span class="lt-acts">
            <button type="button" class="primary" :disabled="(running || (view.phase !== 'online'))" @click="start">{{ (result === null) ? 'Test the link' : 'Test again' }}</button>
            <button type="button" class="link" @click="$emit('close')">Close</button>
        </span>
    </div>
    <p v-if="(view.phase !== 'online')" class="muted">The machine is not connected: there is no link to test.</p>
    <p v-else-if="((result === null) && (running === false) && (error === ''))" class="muted">About {{ about_s }} seconds of bytes to the machine and back, a quick call timed every quarter second while they go, and what both ends dropped and sent again. The link is busy meanwhile.</p>
    <p v-if="(error !== '')" class="alert">{{ error }}</p>
    <div v-if="(result !== null)" class="lt-ways">
        <div v-for="way in ways" :key="way.key" class="lt-way">
            <h4>{{ way.title }}</h4>
            <svg class="lt-chart" :viewBox="'0 0 ' + chart_w + ' ' + chart_h" preserveAspectRatio="none" role="img" :aria-label="way.title + ': ' + way.speed">
                <rect v-for="band in way.bands" :key="band.x" class="lt-stood" :x="band.x" y="0" :width="band.w" :height="chart_h"/>
                <path class="lt-speed" :d="way.area"/>
                <polyline class="lt-wait" :points="way.waits"/>
            </svg>
            <dl class="lt-nums">
                <dt>Speed</dt><dd>{{ way.speed }}</dd>
                <dt>A call waited</dt><dd>up to {{ way.wait }}</dd>
                <dt>Bytes stood</dt><dd :class="{bad: way.stood_bad}">{{ way.stood }}</dd>
            </dl>
        </div>
    </div>
    <p v-if="(result !== null)" class="muted lt-legend"><span><i class="lt-key lt-key-speed"></i>speed</span><span><i class="lt-key lt-key-wait"></i>how long a call waited, {{ wait_top }} at the top</span><span><i class="lt-key lt-key-stood"></i>bytes stood</span></p>
    <dl v-if="(result !== null)" class="lt-nums lt-ends">
        <dt>Round trip, idle</dt><dd>{{ idle }}</dd>
        <dt>Dropped, here · there</dt><dd><span :class="{bad: (summary.drops_here > 0)}">{{ count(summary.drops_here) }}</span> · <span :class="{bad: (summary.drops_there > 0)}">{{ count(summary.drops_there) }}</span></dd>
        <dt>Sent again, here · there</dt><dd>{{ count(summary.resends_here) }} · {{ count(summary.resends_there) }}</dd>
    </dl>
</section>
`,
    props: ['view'],
    emits: ['close'],
    data: function () {
        return {running: false, started_at: null, now: Date.now(), ticker: null, result: null, error: ''};
    },
    computed: {
        icons: function () {
            return overview_icons;
        },
        about_s: function () {
            return ABOUT_S;
        },
        chart_w: function () {
            return CHART_W;
        },
        chart_h: function () {
            return CHART_H;
        },
        elapsed_s: function () {
            return Math.max(0, Math.round((this.now - this.started_at)/1000));
        },
        summary: function () {
            return this.result.summary;
        },
        idle: function () {
            return format_ms(this.summary.idle_ms);
        },
        // One scale for the calls of both ways, so a wait looks as long in either chart
        wait_top_ms: function () {
            return Math.max(WAIT_TOP_LEAST_MS, this.summary.down_wait_ms, this.summary.up_wait_ms);
        },
        wait_top: function () {
            return format_ms(this.wait_top_ms);
        },
        ways: function () {
            const summary = this.summary;
            return [
                way_drawn('down', 'To the machine', this.result.down, summary.down_bps, summary.down_wait_ms, this.wait_top_ms),
                way_drawn('up', 'From the machine', this.result.up, summary.up_bps, summary.up_wait_ms, this.wait_top_ms),
            ];
        },
    },
    methods: {
        start: async function () {
            this.running = true;
            this.error = '';
            this.started_at = Date.now();
            this.now = this.started_at;
            this.ticker = setInterval(this.tick, 1000);
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/link-test`, {method: 'POST'});
                const said = await answer.json();
                if (answer.ok === false) {
                    this.error = said.error;
                    return;
                }
                this.result = said;
            }
            catch {
                this.error = 'the answer never came back';
            }
            finally {
                this.running = false;
                clearInterval(this.ticker);
            }
        },
        tick: function () {
            this.now = Date.now();
        },
        // A counter the machine does not keep is not a zero
        count: function (value) {
            return ((value === null) || (value === undefined)) ? '—' : String(value);
        },
    },
    unmounted: function () {
        clearInterval(this.ticker);
    },
};

// One way as it is drawn: its speed between each two counts as an area, the stretches its
// bytes stood a second or more as bands, how long each call waited as a line up to wait_top_ms,
// all on the way's own time; and its numbers in words
function way_drawn(key, title, way, speed_bps, wait_ms, wait_top_ms)
{
    const samples = way.samples;
    const span = Math.max(1, way.ms);
    function x(ms) {
        return Math.round(CHART_W*ms/span*10)/10;
    }
    const rates = [];
    for (let i = 1; i < samples.length; i++) {
        const dt = samples[i][0] - samples[i - 1][0];
        rates.push([samples[i][0], (dt <= 0) ? 0 : (samples[i][1] - samples[i - 1][1])*1000/dt]);
    }
    const rate_most = Math.max(1, ...rates.map(v => v[1]));
    const area = [`M0 ${CHART_H}`].concat(rates.map(v => `L${x(v[0])} ${level(v[1], rate_most)}`), [`L${x(span)} ${CHART_H} Z`]).join(' ');
    const waits = way.pings.map(v => `${x(v[0])},${level(v[1], wait_top_ms)}`).join(' ');
    return {
        key,
        title,
        area,
        waits,
        bands: stood_bands(samples).map(v => ({x: x(v[0]), w: Math.max(1, x(v[1]) - x(v[0]))})),
        speed: format_bps(speed_bps),
        wait: format_ms(wait_ms),
        stood: (way.stood_ms < 250) ? 'never' : format_ms(way.stood_ms),
        stood_bad: (way.stood_ms >= STOOD_DRAWN_MS),
    };
}

// How high a value stands in the chart, `top` at its top and 0 at its foot
function level(value, top)
{
    return Math.round((CHART_H - 2 - (CHART_H - 6)*value/top)*10)/10;
}

// The stretches, [from, to] in ms, its bytes did not grow for STOOD_DRAWN_MS or more
function stood_bands(samples)
{
    const out = [];
    let since = null;
    for (let i = 1; i <= samples.length; i++) {
        const moved = (i < samples.length) && (samples[i][1] > samples[i - 1][1]);
        if ((i < samples.length) && (moved === false)) {
            since = (since === null) ? samples[i - 1][0] : since;
            continue;
        }
        const to = samples[i - 1][0];
        if ((since !== null) && (to - since >= STOOD_DRAWN_MS)) {
            out.push([since, to]);
        }
        since = null;
    }
    return out;
}

export default link_test_panel;
