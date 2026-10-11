import format_bps from './format_bps.js';
import overview_icons from './overview_icons.js';

// How often an open chart is read again: the machine writes a line every half minute
const CHARTS_EVERY_MS = 30000;
const CHARTS_RANGE_KEY = 'serviceman.charts_range';

// The ranges a chart covers, as the machine's agent names them
const CHART_RANGES = ['1h', '24h', '7d', '30d'];
const CHART_W = 1000;
const CHART_H = 100;

// One chart each, from the numbers a point carries: its lines, the top of its scale (fixed for
// a share, the highest point for the rest) and how a value is said. A value the machine could
// not measure is null, and is a gap in its line.
const OVERVIEW_CHARTS = [
    {key: 'cpu', label: 'CPU', icon: 'cpu', top: 100, text: percent_text, lines: [{name: 'busy', of: v => share_of(v.cpu, 1)}]},
    {key: 'mem', label: 'Memory', icon: 'memory', top: 100, text: percent_text, lines: [{name: 'used', of: v => share_of(v.mem, v.mem_total)}]},
    {key: 'disk', label: 'All disks', icon: 'database', top: 100, text: percent_text, lines: [{name: 'used', of: v => share_of(v.disk, v.disk_total)}]},
    {key: 'io', label: 'Disk I/O', icon: 'layers', top: null, text: format_bps, lines: [{name: 'read', of: v => number_of(v.disk_read)}, {name: 'write', of: v => number_of(v.disk_write)}]},
    {key: 'net', label: 'Network', icon: 'globe', top: null, text: format_bps, lines: [{name: 'in', of: v => number_of(v.net_in)}, {name: 'out', of: v => number_of(v.net_out)}]},
    {key: 'tcp', label: 'Connections', icon: 'link', top: null, text: v => String(Math.round(v)), lines: [{name: 'tcp', of: v => number_of(v.tcp)}]},
    {key: 'ping', label: 'Ping', icon: 'pulse', top: null, text: v => `${Math.round(v)} ms`, lines: [{name: 'to serviceman', of: v => number_of(v.ping)}]},
];

// The machine's history, one chart per OVERVIEW_CHARTS entry, with the range to pick. The
// numbers are read from the machine, which keeps them: when the pane opens, every half minute
// after, and when another range is picked; what was read stays on screen while the next is read.
// The cursor follows the mouse over any chart, and every chart shows its value at that moment:
// the spike in one is read against the others.
const remote_charts = {
    template: `
<section class="ov-charts" :class="{loading}" @mouseleave="hover_leave">
    <div class="ov-charts-head">
        <b>History</b>
        <span v-if="old" class="muted">Charts need agent 1.9 or newer; this machine runs {{ (view.agent_version || 'an older one') }}. <button type="button" class="link" @click="$emit('tab', 'configure')">Update it in Configure →</button></span>
        <span v-else :class="((error === null) ? 'muted' : 'bad')">{{ note }}</span>
        <span class="seg">
            <button v-for="item in ranges" :key="item" type="button" :class="{on: (item === range)}" @click="pick(item)">{{ item }}</button>
        </span>
    </div>
    <div v-if="((data !== null) || loading)" class="ov-chart-grid">
        <section v-for="chart in charts" :key="chart.key" class="card ov-chart">
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
                <svg :viewBox="('0 0 ' + width + ' ' + height)" preserveAspectRatio="none" aria-hidden="true">
                    <path v-for="(path, i) in chart.paths" :key="i" :class="('ov-line-' + i)" :d="path" vector-effect="non-scaling-stroke"/>
                </svg>
                <i class="ov-chart-cursor" :hidden="(cursor === null)" :style="{left: cursor}"></i>
                <span class="ov-chart-top muted">{{ chart.top }}</span>
            </div>
            <div class="ov-chart-foot muted">
                <span>{{ from }}</span>
                <span class="ov-chart-at">{{ at }}</span>
                <span>{{ to }}</span>
            </div>
        </section>
    </div>
</section>
`,
    props: ['view'],
    emits: ['tab'],
    data: function () {
        return {range: charts_range_read(), data: null, error: null, old: false, loading: true, timer: null, asked: 0, hover_at: null};
    },
    computed: {
        icons: function () {
            return overview_icons;
        },
        ranges: function () {
            return CHART_RANGES;
        },
        width: function () {
            return CHART_W;
        },
        height: function () {
            return CHART_H;
        },
        // What is said beside the range: why there is nothing, or how old what is shown is
        note: function () {
            if (this.error !== null) {
                return this.error;
            }
            if (this.data === null) {
                return 'reading the machine\'s history…';
            }
            if (this.data.away) {
                return `as the machine said it at ${chart_time(this.data.to, '1h')} — it is offline now`;
            }
            if (this.data.points.length === 0) {
                return 'nothing written yet: the first numbers come half a minute after its agent starts';
            }
            return '';
        },
        // The lines and the top of the scale: drawn again when the numbers change, not when
        // the mouse moves
        charts: function () {
            const data = this.data;
            const points = ((data === null) ? [] : data.points);
            return OVERVIEW_CHARTS.map(function (chart) {
                const top = chart_top(chart, points);
                const paths = chart.lines.map(v => chart_path(v, points, data, top));
                return {key: chart.key, label: chart.label, icon: chart.icon, top: chart.text(top), paths};
            });
        },
        point: function () {
            return (((this.hover_at === null) || (this.data === null)) ? null : point_nearest(this.data, this.hover_at));
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
                    point = ((last === undefined) ? null : last);
                }
                out[chart.key] = ((point === null) ? null : chart.lines.map(function (line) {
                    const value = line.of(point);
                    return {name: line.name, said: ((value === null) ? '—' : chart.text(value))};
                }));
            }
            return out;
        },
        cursor: function () {
            return ((this.point === null) ? null : `${chart_x(this.point.at + this.data.step_ms/2, this.data)/CHART_W*100}%`);
        },
        at: function () {
            return ((this.point === null) ? '' : new Date(this.point.at).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}));
        },
        from: function () {
            return ((this.data === null) ? '' : chart_time(this.data.from, this.data.range));
        },
        to: function () {
            return (((this.data === null) || (this.data.away === false)) ? 'now' : chart_time(this.data.to, '1h'));
        },
    },
    methods: {
        pick: function (range) {
            if (range === this.range) {
                return;
            }
            this.range = range;
            charts_range_write(range);
            this.load();
        },
        // Only the last answer asked for is shown: a slow 30d must not land over a 1h picked after
        load: async function () {
            clearTimeout(this.timer);
            const asked = ++this.asked;
            this.loading = true;
            let data = null;
            let reason = null;
            let old = false;
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/metrics?range=${this.range}`, {cache: 'no-store'});
                const body = await answer.json();
                if (answer.ok) {
                    data = body;
                }
                else {
                    reason = body.error;
                    old = (body.old_agent === true);
                }
            }
            catch (error) {
                reason = `Could not read the charts: ${error.message}`;
            }
            if (asked !== this.asked) {
                return;
            }
            this.data = data;
            this.error = reason;
            this.old = old;
            this.loading = false;
            this.timer = setTimeout(() => this.load(), CHARTS_EVERY_MS);
        },
        hover: function (event) {
            if (this.data === null) {
                return;
            }
            const box = event.currentTarget.getBoundingClientRect();
            const share = Math.min(1, Math.max(0, (event.clientX - box.left)/box.width));
            this.hover_at = this.data.from + share*(this.data.to - this.data.from);
        },
        hover_leave: function () {
            this.hover_at = null;
        },
    },
    watch: {
        // A machine that comes back is read at once, not at the next half minute
        'view.phase': function () {
            this.load();
        },
    },
    mounted: function () {
        this.load();
    },
    unmounted: function () {
        clearTimeout(this.timer);
    },
};

// The range last picked, for this viewer: a convenience, so a browser that keeps nothing gets 24h
function charts_range_read()
{
    try {
        const kept = localStorage.getItem(CHARTS_RANGE_KEY);
        return (CHART_RANGES.includes(kept) ? kept : '24h');
    }
    catch {
        return '24h';
    }
}

function charts_range_write(range)
{
    try {
        localStorage.setItem(CHARTS_RANGE_KEY, range);
    }
    catch {
        // kept for this pane only
    }
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

// The top of the scale: a share is out of 100, anything else is out of the highest point,
// rounded up to 1, 2 or 5 of its order, so the line never touches the edge
function chart_top(chart, points)
{
    if (chart.top !== null) {
        return chart.top;
    }
    let most = 0;
    for (const point of points) {
        for (const line of chart.lines) {
            const value = line.of(point);
            if ((value !== null) && (value > most)) {
                most = value;
            }
        }
    }
    if (most <= 0) {
        return 1;
    }
    const order = 10**Math.floor(Math.log10(most));
    return [1, 2, 5, 10].map(v => v*order).find(v => v >= most);
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
        const broken = ((prev_at === null) || (point.at - prev_at > 2.5*data.step_ms));
        out += (broken ? `M${x} ${y}h0.1` : `L${x} ${y}`);
        prev_at = point.at;
    }
    return out;
}

function chart_x(at, data)
{
    return ((at - data.from)/(data.to - data.from)*CHART_W).toFixed(1);
}

// A time on the axis: the hour for a day or less, the day for longer
function chart_time(at, range)
{
    const date = new Date(at);
    if ((range === '1h') || (range === '24h')) {
        return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    }
    return date.toLocaleDateString([], {month: 'short', day: 'numeric'});
}

function percent_text(value)
{
    return `${Math.round(value)}%`;
}

function share_of(value, total)
{
    if ((typeof value !== 'number') || (typeof total !== 'number') || (total <= 0)) {
        return null;
    }
    return value/total*100;
}

function number_of(value)
{
    return ((typeof value === 'number') ? value : null);
}

export default remote_charts;
