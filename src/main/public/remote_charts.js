import CHARTS_RANGES from './charts_ranges.js';
import chart_scale_of from './chart_scale_of.js';
import chart_times_of from './chart_times_of.js';
import clock_of from './clock_of.js';
import format_bps from './format_bps.js';
import overview_icons from './overview_icons.js';
import share_of from './share_of.js';

const CHART_W = 1000;
const CHART_H = 100;
// The room a round time under a chart takes, with the gap to the next, in px: a chart as wide as
// a third of the page has four between its start and its end, a phone's three; those that would
// touch the start, the end or each other give way where they stand
const TICK_ROOM_PX = 100;
// How near two times under a chart may stand, in px, before one gives way
const TIMES_GAP_PX = 8;

// One chart each, from the numbers a point carries: its lines, how its scale is said (a share's
// top is 100%, the rest's the highest point rounded up, chart_scale_of) and how a value is said.
// A value the machine could not measure is null, and is a gap in its line.
const OVERVIEW_CHARTS = [
    {key: 'cpu', label: 'CPU', icon: 'cpu', unit: 'share', text: percent_text, lines: [{name: 'busy', of: v => share_of(v.cpu, 1)}]},
    {key: 'mem', label: 'Memory', icon: 'memory', unit: 'share', text: percent_text, lines: [{name: 'used', of: v => share_of(v.mem, v.mem_total)}]},
    {key: 'disk', label: 'All disks', icon: 'database', unit: 'share', text: percent_text, lines: [{name: 'used', of: v => share_of(v.disk, v.disk_total)}]},
    {key: 'io', label: 'Disk I/O', icon: 'layers', unit: 'rate', text: format_bps, lines: [{name: 'read', of: v => number_of(v.disk_read)}, {name: 'write', of: v => number_of(v.disk_write)}]},
    {key: 'net', label: 'Network', icon: 'globe', unit: 'rate', text: format_bps, lines: [{name: 'in', of: v => number_of(v.net_in)}, {name: 'out', of: v => number_of(v.net_out)}]},
    {key: 'tcp', label: 'Connections', icon: 'link', unit: 'count', text: v => String(Math.round(v)), lines: [{name: 'tcp', of: v => number_of(v.tcp)}]},
    {key: 'ping', label: 'Ping', icon: 'pulse', unit: 'ms', text: v => `${Math.round(v)} ms`, lines: [{name: 'to serviceman', of: v => number_of(v.ping)}]},
];

// The machine's history, one chart per OVERVIEW_CHARTS entry, over the range picked at its head.
// It reads nothing itself: the machine's page reads the numbers, once a tick, and its head draws
// CPU, Memory and Disk from the same answer (remote_page in serviceman.js). What was read stays
// on screen while the next is read, dimmed only while another range is on its way.
// The cursor follows the mouse over any chart, and every chart shows its value at that moment:
// the spike in one is read against the others.
// A chart says its scale on its lines, inside it: the top and the middle under their dashed
// lines, the line showing on around the words where it runs there. Under it, the start and the
// end, and round times between them with faint guides up through the lines, as many as its width
// has room for; the time pointed at in a tag over them, those it would touch giving way.
//
//     charts    {range, data, error, old, loading}: the range picked; the machine's answer, for
//               it or, while it is on its way, for the range before; undefined before the first
//               answer, null for none; why there is none, or why the one shown is not new; whether
//               its agent is from before charts; whether another range is on its way
const remote_charts = {
    template: `
<section class="ov-charts" :class="{loading}" @mouseleave="hover_leave">
    <div class="ov-charts-head">
        <b>History</b>
        <span v-if="old" class="muted">Charts need agent 1.9 or newer; this machine runs {{ (view.agent_version || 'an older one') }}. <button type="button" class="link" @click="$emit('tab', 'configure')">Update it in Configure →</button></span>
        <span v-else :class="((error === null) ? 'muted' : 'bad')">{{ note }}</span>
    </div>
    <div v-if="((data !== null) || loading)" class="ov-chart-grid">
        <section v-for="chart in plots" :key="chart.key" class="card ov-chart">
            <div class="ov-chart-head">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons[chart.icon]"/>
                <b>{{ chart.label }}</b>
                <span class="ov-chart-value">
                    <template v-if="(values[chart.key] === null)">—</template>
                    <template v-else-if="(values[chart.key].length === 1)">{{ values[chart.key][0].said }}</template>
                    <template v-else><template v-for="(value, i) in values[chart.key]" :key="value.name"><template v-if="(i > 0)">{{ ' ' }}</template><span class="ov-key" :class="('ov-key-' + i)">{{ value.name }}</span> {{ value.said }}</template></template>
                </span>
            </div>
            <div class="ov-chart-plot" @mousemove="hover">
                <i v-for="tick of ticks" :key="tick.at" class="ov-chart-guide" :style="{left: (tick.share*100 + '%')}"></i>
                <svg :viewBox="('0 0 ' + width + ' ' + height)" preserveAspectRatio="none" aria-hidden="true">
                    <path v-for="(path, i) in chart.paths" :key="i" :class="('ov-line-' + i)" :d="path" vector-effect="non-scaling-stroke"/>
                </svg>
                <span class="ov-chart-level">{{ chart.top }}</span>
                <span class="ov-chart-level ov-chart-half">{{ chart.half }}</span>
                <i class="ov-chart-cursor" :hidden="(cursor === null)" :style="{left: cursor}"></i>
            </div>
            <div class="ov-chart-foot muted">
                <span class="ov-chart-edge">{{ start }}</span>
                <span v-for="tick of ticks" :key="tick.at" class="ov-chart-tick" :style="{left: (tick.share*100 + '%')}">{{ tick.said }}</span>
                <span class="ov-chart-edge ov-chart-end">{{ end }}</span>
                <span v-if="(cursor !== null)" class="ov-chart-at" :style="{left: cursor}">{{ at }}</span>
            </div>
        </section>
    </div>
</section>
`,
    props: ['view', 'charts'],
    emits: ['tab'],
    data: function () {
        // hover_at: the moment under the mouse, null for none; plot_width: a chart's width in px,
        // as the page lays it out, for how many times fit under it
        return {hover_at: null, plot_width: 0};
    },
    computed: {
        icons: function () {
            return overview_icons;
        },
        width: function () {
            return CHART_W;
        },
        height: function () {
            return CHART_H;
        },
        // The answer drawn; null before the first and where there is none
        data: function () {
            return (this.charts.data === undefined) ? null : this.charts.data;
        },
        error: function () {
            return this.charts.error;
        },
        old: function () {
            return this.charts.old;
        },
        loading: function () {
            return this.charts.loading;
        },
        // What is said beside History: why there is nothing, how old what is shown is, or the
        // range it shows
        note: function () {
            if (this.error !== null) {
                return this.error;
            }
            if (this.data === null) {
                return 'reading the machine\'s history…';
            }
            if (this.data.away) {
                return `as the machine said it at ${clock_of(this.data.until)} — it is offline now`;
            }
            if ((this.data.points.length === 0) && (this.data.range === '10m')) {
                return 'nothing from servermon in the last ten minutes';
            }
            if (this.data.points.length === 0) {
                return 'nothing written yet: the first numbers come half a minute after its agent starts';
            }
            const range = CHARTS_RANGES.find(v => v.value === this.data.range);
            return (range === undefined) ? '' : `the last ${range.said}`;
        },
        // The lines and the top of the scale: drawn again when the numbers change, not when
        // the mouse moves
        plots: function () {
            const data = this.data;
            const points = (data === null) ? [] : data.points;
            return OVERVIEW_CHARTS.map(function (chart) {
                const scale = chart_scale_of(chart.unit, chart_most(chart, points));
                const paths = chart.lines.map(v => chart_path(v, points, data, scale.top));
                return {key: chart.key, label: chart.label, icon: chart.icon, top: scale.top_said, half: scale.half_said, paths};
            });
        },
        point: function () {
            return ((this.hover_at === null) || (this.data === null)) ? null : point_nearest(this.data, this.hover_at);
        },
        // Each chart's value: at the cursor, or the last point it has a value at; null for none.
        // Each line is said with its name where the chart has more than one.
        values: function () {
            const out = {};
            const data = this.data;
            for (const chart of OVERVIEW_CHARTS) {
                let point = this.point;
                if ((point === null) && (data !== null)) {
                    const last = data.points.findLast(v => chart.lines.some(vv => vv.of(v) !== null));
                    point = (last === undefined) ? null : last;
                }
                out[chart.key] = (point === null) ? null : chart.lines.map(function (line) {
                    const value = line.of(point);
                    return {name: line.name, said: (value === null) ? '—' : chart.text(value)};
                });
            }
            return out;
        },
        cursor: function () {
            return (this.point === null) ? null : `${chart_x(this.point.at + this.data.step_ms/2, this.data)/CHART_W*100}%`;
        },
        at: function () {
            if (this.point === null) {
                return '';
            }
            if (this.data.range === '10m') {
                return new Date(this.point.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
            }
            return new Date(this.point.at).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
        },
        // The start, the end and the round times between them, the same under every chart
        times: function () {
            if (this.data === null) {
                return {start: '', end: '', ticks: []};
            }
            return chart_times_of(this.data, Math.max(1, Math.floor(this.plot_width/TICK_ROOM_PX)), Date.now());
        },
        start: function () {
            return this.times.start;
        },
        end: function () {
            return this.times.end;
        },
        ticks: function () {
            return this.times.ticks;
        },
    },
    methods: {
        hover: function (event) {
            if (this.data === null) {
                return;
            }
            const box = event.currentTarget.getBoundingClientRect();
            const share = Math.min(1, Math.max(0, (event.clientX - box.left)/box.width));
            this.hover_at = this.data.since + share*(this.data.until - this.data.since);
        },
        hover_leave: function () {
            this.hover_at = null;
        },
        // A chart's width, read again when the page is laid out anew
        refresh_width: function () {
            const plot = this.$el.querySelector('.ov-chart-plot');
            this.plot_width = (plot === null) ? 0 : plot.clientWidth;
            this.refresh_times();
        },
        // Under each chart, times that would touch give way: the time pointed at first, which
        // stays inside the chart's width, then the start and the end, then the round times. A
        // round time crowded by the start, the end or another goes with its guide; one under the
        // time pointed at only hides while it is there.
        refresh_times: function () {
            for (const foot of this.$el.querySelectorAll('.ov-chart-foot')) {
                const guides = foot.previousElementSibling.querySelectorAll('.ov-chart-guide');
                const at = foot.querySelector('.ov-chart-at');
                const taken = [];
                if (at !== null) {
                    taken.push(at_place(at, foot.getBoundingClientRect()));
                }
                const kept = [];
                for (const edge of foot.querySelectorAll('.ov-chart-edge')) {
                    const box = edge.getBoundingClientRect();
                    edge.style.visibility = is_crowded(box, taken) ? 'hidden' : '';
                    kept.push(box);
                }
                const ticks = foot.querySelectorAll('.ov-chart-tick');
                for (let i = 0, end = ticks.length; i < end; ++i) {
                    const box = ticks[i].getBoundingClientRect();
                    const crowded = is_crowded(box, kept);
                    ticks[i].style.visibility = (crowded || is_crowded(box, taken)) ? 'hidden' : '';
                    if (guides[i] !== undefined) {
                        guides[i].style.visibility = crowded ? 'hidden' : '';
                    }
                    if (crowded === false) {
                        kept.push(box);
                    }
                }
            }
        },
    },
    mounted: function () {
        this.sizes = new ResizeObserver(this.refresh_width);
        this.sizes.observe(this.$el);
    },
    updated: function () {
        this.refresh_times();
    },
    unmounted: function () {
        this.sizes.disconnect();
    },
};

// The time pointed at, moved back inside its chart's width where it would stand past an edge:
// its box as it stands then
function at_place(at, edges)
{
    at.style.marginLeft = '';
    const box = at.getBoundingClientRect();
    const shift = Math.max(0, edges.left - box.left) + Math.min(0, edges.right - box.right);
    if (shift === 0) {
        return box;
    }
    at.style.marginLeft = `${shift}px`;
    return at.getBoundingClientRect();
}

// Whether a box stands nearer than TIMES_GAP_PX to any of others, side by side
function is_crowded(box, others)
{
    return others.some(v => (box.right + TIMES_GAP_PX > v.left) && (box.left - TIMES_GAP_PX < v.right));
}

// The point whose step holds a moment, or the nearest one to it
function point_nearest(data, at)
{
    let out = null;
    for (const point of data.points) {
        if ((out === null) || (Math.abs(point.at + data.step_ms/2 - at) < Math.abs(out.at + data.step_ms/2 - at))) {
            out = point;
        }
    }
    return out;
}

// The highest value a chart draws, 0 for none: its scale's top is rounded up from it
function chart_most(chart, points)
{
    let out = 0;
    for (const point of points) {
        for (const line of chart.lines) {
            const value = line.of(point);
            if ((value !== null) && (value > out)) {
                out = value;
            }
        }
    }
    return out;
}

// One line as svg path: a new stroke after a gap of more than two steps, where the machine
// was off or its agent stopped; a point alone is a dot
function chart_path(line, points, data, top)
{
    let out = '';
    let prev_at = null;
    for (const point of points) {
        const value = line.of(point);
        if (value === null) {
            prev_at = null;
            continue;
        }
        const x = chart_x(point.at + data.step_ms/2, data);
        const y = (CHART_H - Math.min(1, Math.max(0, value/top))*CHART_H).toFixed(1);
        const broken = (prev_at === null) || (point.at - prev_at > 2.5*data.step_ms);
        out += broken ? `M${x} ${y}h0.1` : `L${x} ${y}`;
        prev_at = point.at;
    }
    return out;
}

function chart_x(at, data)
{
    return ((at - data.since)/(data.until - data.since)*CHART_W).toFixed(1);
}

function percent_text(value)
{
    return `${Math.round(value)}%`;
}

function number_of(value)
{
    return (typeof value === 'number') ? value : null;
}

export default remote_charts;
