// A copy this big, or of more than one file, has its graph and the time left; a small one is
// over before there is anything to draw
const BIG_BYTES = 8*1024*1024;

// One copy as one panel, the same for every copy a page shows (uploads, a copy between
// machines, a new version of an app): what it is and how far it is, the speed across it as a
// file manager on the desktop draws it, the time and the files left, and the file under way.
//
// Props
//     copy = {
//         title       what is copied where: Uploads, Copy to vps2
//         state       counting | going | paused | retrying | done | failed | stopped
//         files       how many files, null while not counted
//         files_done  how many are in
//         failed      how many failed
//         bytes       how many bytes in all, null while not counted
//         bytes_done  how many are in
//         samples     [{x, y}]: the speed (y, bytes a second) at each point of the way (x, 0 to 1)
//         left_ms     the time left, null while it cannot be told yet
//         now         the file under way, or the last one: {label, done, size, going, said, bad},
//                     or null; going while its bytes go (unsaid: while the copy goes), said and
//                     bad for why it waits; size null while not known
//         summary     the head's line, when the copy says it its own way; else made of the above
//         unit        what its files are: file by default, layer for an image coming down
//         ratio       how far it is, 0 to 1, for a copy whose bytes are not all known; else null
//         note        one more line under the head, '' for none; note_bad for an error's colour
//     }
//
// Slots
//     acts      the head's buttons: Pause, Cancel, Clear
//     default   rows under the panel: the files that failed, the other copies
const copy_progress = {
    template: `
<div class="card fm-uploads">
    <div class="list-head">
        <b>{{ copy.title }}</b>
        <span v-if="(copy.state === 'paused')" class="fm-paused">Paused</span>
        <span class="muted fm-copy-summary" :title="summary">{{ summary }}</span>
        <div class="list-acts"><slot name="acts"/></div>
    </div>
    <p v-if="((copy.note !== undefined) && (copy.note !== ''))" class="fm-copy-note" :class="(copy.note_bad ? 'bad' : 'muted')" :title="copy.note">{{ copy.note }}</p>
    <template v-if="(copy.state === 'counting')">
        <div class="fm-graph"><span class="meter fm-copy-total fm-counting"><i/></span></div>
        <div class="fm-facts"><span><b>Time left</b> …</span><span><b>Files left</b> {{ files_left }}</span></div>
    </template>
    <!-- The speed across the copy, as a file manager on the desktop draws it: how fast it went
         at each point of the way, the part done shaded, the speed now a dashed line -->
    <template v-else-if="big">
        <div class="fm-graph">
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
                <line v-for="n of 9" :key="n" :x1="(n * 100)" y1="0" :x2="(n * 100)" y2="100" class="fm-graph-grid"/>
                <rect x="0" y="0" :width="graph.done_x" height="100" class="fm-graph-done"/>
                <path :d="graph.area" class="fm-graph-area"/>
                <path :d="graph.line" class="fm-graph-line"/>
                <line v-if="(graph.now_y !== null)" x1="0" :y1="graph.now_y" x2="1000" :y2="graph.now_y" class="fm-graph-now"/>
            </svg>
            <span v-if="(graph.now_y !== null)" class="fm-graph-speed" :class="{under: (graph.now_y < 30)}" :style="{top: (graph.now_y + '%')}">Speed: {{ format_bytes(graph.speed) }}/s</span>
        </div>
        <div class="fm-facts">
            <span><b>Time left</b> {{ left }}</span>
            <span><b>{{ (units[0] === 'file') ? 'Files' : 'Layers' }} left</b> {{ files_left }}</span>
        </div>
    </template>
    <!-- The file under way, with its own bar; between two files the last one stays, so the
         line never comes and goes and nothing under it jumps -->
    <div v-if="(copy.state === 'counting')" class="fm-copy"><code class="muted">reading the folder</code><span class="fm-copy-state"></span></div>
    <div v-else-if="((copy.now !== null) && (copy.now !== undefined))" class="fm-copy">
        <code :title="copy.now.label">{{ copy.now.label }}</code>
        <span class="fm-copy-state fm-copy-going">
            <span class="meter"><i :style="{width: (Math.max(2, Math.round(now_ratio*100)) + '%')}"/></span>
            <span v-if="((copy.now.said !== undefined) && (copy.now.said !== ''))" :class="(copy.now.bad ? 'bad' : 'muted')" :title="copy.now.said">{{ copy.now.said }}</span>
            <span v-else-if="(copy.now.size === null)"></span>
            <span v-else-if="now_going" class="muted">{{ format_bytes(copy.now.done) }} of {{ format_bytes(copy.now.size) }}</span>
            <span v-else class="muted">{{ format_bytes(copy.now.size) }}</span>
        </span>
    </div>
    <slot/>
</div>
`,
    props: ['copy'],
    computed: {
        ratio: function () {
            const copy = this.copy;
            if ((copy.ratio !== undefined) && (copy.ratio !== null)) {
                return Math.min(1, copy.ratio);
            }
            if ((copy.bytes !== null) && (copy.bytes > 0)) {
                return Math.min(1, copy.bytes_done/copy.bytes);
            }
            return ((copy.files === null) || (copy.files === 0)) ? 0 : copy.files_done/copy.files;
        },
        big: function () {
            return ((this.copy.files !== null) && (this.copy.files > 1)) || ((this.copy.bytes !== null) && (this.copy.bytes > BIG_BYTES)) || (this.copy.unit === 'layer');
        },
        units: function () {
            return ((this.copy.unit === undefined) || (this.copy.unit === null)) ? ['file', 'files'] : [this.copy.unit, `${this.copy.unit}s`];
        },
        // "48% · 1417 of 2940 files · 1.4GB of 2.9GB"; the speed and the time left are under the
        // graph. One file has no percent: its own line says it all. A copy stopped halfway says
        // so, however it says the rest.
        summary: function () {
            const copy = this.copy;
            if ((copy.summary !== undefined) && (copy.summary !== null) && (copy.summary !== '')) {
                return (copy.state === 'stopped') ? `${copy.summary} · stopped` : copy.summary;
            }
            if (copy.state === 'counting') {
                return `Counting… ${copy.files_done} ${plural(copy.files_done, ...this.units)} · ${format_bytes(copy.bytes_done)} so far`;
            }
            const said = [];
            if (((copy.files !== null) && (copy.files > 1)) || ((copy.ratio !== undefined) && (copy.ratio !== null))) {
                said.push(`${Math.floor(this.ratio*100)}%`);
            }
            if (copy.files !== null) {
                said.push(`${copy.files_done} of ${copy.files} ${plural(copy.files, ...this.units)}`);
            }
            if (copy.bytes !== null) {
                said.push(`${format_bytes(copy.bytes_done)} of ${format_bytes(copy.bytes)}`);
            }
            else if (copy.bytes_done > 0) {
                said.push(`${format_bytes(copy.bytes_done)} so far`);
            }
            if (copy.failed > 0) {
                said.push(`${copy.failed} failed`);
            }
            if (copy.state === 'done') {
                said.push('done');
            }
            if (copy.state === 'stopped') {
                said.push('stopped');
            }
            return said.join(' · ');
        },
        left: function () {
            const copy = this.copy;
            if (copy.state === 'done') {
                return 'done';
            }
            if ((copy.left_ms === null) || (copy.left_ms === undefined) || (['going', 'retrying', 'paused'].includes(copy.state) === false)) {
                return '…';
            }
            return (copy.left_ms < 1000) ? 'less than a second' : `about ${format_ms(copy.left_ms)}`;
        },
        files_left: function () {
            const copy = this.copy;
            if (copy.state === 'counting') {
                return `${copy.files_done} (${format_bytes(copy.bytes_done)})`;
            }
            if (copy.files === null) {
                return '…';
            }
            const left = copy.files - copy.files_done - copy.failed;
            return (copy.bytes === null) ? String(left) : `${left} (${format_bytes(Math.max(0, copy.bytes - copy.bytes_done))})`;
        },
        // A file the copy does not mark goes while the copy goes
        now_going: function () {
            const now = this.copy.now;
            return (now.going === undefined) ? (this.copy.state === 'going') : (now.going === true);
        },
        // An empty file is whole; one of a size not known yet has not started
        now_ratio: function () {
            const now = this.copy.now;
            if (now.size === null) {
                return 0;
            }
            return (now.size === 0) ? 1 : Math.min(1, now.done/now.size);
        },
        // The graph's lines, on a box of 1000 by 100: the speed scaled to the fastest seen, with
        // a little room above it; the speed now while the copy goes
        graph: function () {
            const samples = Array.isArray(this.copy.samples) ? this.copy.samples : [];
            const out = {done_x: Math.round(this.ratio*1000), line: '', area: '', now_y: null, speed: 0};
            if (samples.length === 0) {
                return out;
            }
            const top = Math.max(1, ...samples.map(v => v.y))*1.25;
            const points = samples.map(v => [v.x*1000, 100 - v.y/top*100]);
            out.line = points.map((v, index) => `${(index === 0) ? 'M' : 'L'}${v[0].toFixed(1)} ${v[1].toFixed(1)}`).join(' ');
            out.area = `${out.line} L${points.at(-1)[0].toFixed(1)} 100 L${points[0][0].toFixed(1)} 100 Z`;
            if ((this.copy.state === 'going') || (this.copy.state === 'paused')) {
                out.now_y = Math.round(points.at(-1)[1]);
                out.speed = samples.at(-1).y;
            }
            return out;
        },
    },
    methods: {
        format_bytes: function (bytes) {
            return format_bytes(bytes);
        },
    },
};

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

function format_bytes(bytes)
{
    if (typeof bytes !== 'number') {
        return 'unknown';
    }
    const names = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const step = Math.min(names.length - 1, Math.max(0, Math.floor(Math.log(Math.max(1, bytes))/Math.log(1024))));
    const value = bytes/Math.pow(1024, step);
    return `${value.toFixed(((step === 0) || (value >= 100)) ? 0 : 1)}${names[step]}`;
}

function format_ms(ms)
{
    if (ms < 1000) {
        return `${Math.max(0, Math.round(ms))}ms`;
    }
    const total = Math.max(0, Math.round(ms/1000));
    const days = Math.floor(total/86400);
    const hours = Math.floor(total % 86400/3600);
    const minutes = Math.floor(total % 3600/60);
    const seconds = total % 60;
    const items = [];
    if (days > 0) {
        items.push(`${days}d`);
    }
    if (hours > 0) {
        items.push(`${hours}h`);
    }
    if (minutes > 0) {
        items.push(`${minutes}m`);
    }
    if (items.length < 2) {
        items.push(`${seconds}s`);
    }
    return items.join(' ');
}

export default copy_progress;
