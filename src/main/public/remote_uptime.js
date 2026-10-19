import format_ms from './format_ms.js';
import overview_icons from './overview_icons.js';

// How often an open card is read again: the agent counts servermon's lines every minute
const UPTIME_EVERY_MS = 60000;
const UPTIME_DAYS = 30;
// A day says its longest stretches, in the order they came; the rest are a count
const STRETCHES_SHOWN = 5;

// What a stretch with no servermon line says of itself, by the why its agent gave it
const WHY_SAID = {
    reboot: 'rebooted',
    stopped: 'servermon stopped, or the machine slept',
    silent: 'no line since',
};

// The machine's uptime, a bar a day for the last 30, counted by its agent from servermon's
// lines: green when every second has one, orange from 99%, red below, grey before servermon came.
// A day pointed at, focused or tapped says its share and each stretch it was down, in the
// machine's own time zone. Read when the pane opens and every minute after; what was read stays
// on screen while the next is read.
const remote_uptime = {
    template: `
<section class="card ov-uptime" :class="{loading}">
    <div class="ov-chart-head">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons.pulse"/>
        <b>Uptime</b>
        <span class="ov-chart-value">{{ summary }}</span>
    </div>
    <p v-if="old" class="muted">Uptime needs agent 1.22 or newer; this machine runs {{ (view.agent_version || 'an older one') }}. <button type="button" class="link" @click="$emit('tab', 'configure')">Update it in Configure →</button></p>
    <p v-else-if="(error !== null)" class="bad">{{ error }}</p>
    <template v-if="(data !== null)">
        <div class="ov-uptime-ends muted">
            <span>{{ days[0].label }}</span>
            <span>{{ (data.away ? days[days.length - 1].label : 'today') }}</span>
        </div>
        <div class="ov-uptime-bars" @mouseleave="hovered = null">
            <button v-for="(day, i) in days" :key="day.day" type="button" class="ov-uptime-day" :class="[day.kind, {on: (i === shown_index)}]" :title="day.title" :aria-label="day.title" :aria-pressed="(i === picked)" @mouseenter="hovered = i" @focus="hovered = i" @blur="hovered = null" @click="pick(i)"></button>
        </div>
        <div class="ov-uptime-tip">
            <template v-if="(shown !== null)">
                <p><b>{{ shown.label }}</b> · {{ shown.said }}</p>
                <ul v-if="(shown.stretches.length > 0)">
                    <li v-for="stretch in shown.stretches" :key="stretch.from">{{ stretch.text }}</li>
                    <li v-if="(shown.more > 0)" class="muted">and {{ shown.more }} shorter {{ ((shown.more === 1) ? 'one' : 'ones') }}</li>
                </ul>
            </template>
            <p v-else class="muted">Point at or tap a day: its share and each stretch it was down, longer than 10 s, in {{ data.tz }} time.</p>
        </div>
    </template>
</section>
`,
    props: ['view'],
    emits: ['tab'],
    data: function () {
        return {data: null, error: null, old: false, loading: false, asked: 0, timer: null, hovered: null, picked: null};
    },
    computed: {
        icons: function () {
            return overview_icons;
        },
        days: function () {
            return (this.data === null) ? [] : this.data.days.map(v => day_of(v, this.data.tz));
        },
        summary: function () {
            if (this.data === null) {
                return this.loading ? 'reading…' : '—';
            }
            const known = this.days.filter(v => v.known_ms > 0);
            if (known.length === 0) {
                return 'nothing counted yet';
            }
            const known_ms = known.reduce((sum, v) => sum + v.known_ms, 0);
            const down_ms = known.reduce((sum, v) => sum + v.down_ms, 0);
            const count = `${known.length} ${(known.length === 1) ? 'day' : 'days'}`;
            return (down_ms === 0) ? `${count} · 100%` : `${count} · ${share_text(known_ms, down_ms)} · down ${format_ms(down_ms)}`;
        },
        shown_index: function () {
            return (this.hovered === null) ? this.picked : this.hovered;
        },
        shown: function () {
            return ((this.shown_index === null) || (this.shown_index >= this.days.length)) ? null : this.days[this.shown_index];
        },
    },
    methods: {
        pick: function (i) {
            this.picked = (this.picked === i) ? null : i;
        },
        // Only the last answer asked for is shown
        load: async function () {
            clearTimeout(this.timer);
            const asked = ++this.asked;
            this.loading = true;
            let data = null;
            let reason = null;
            let old = false;
            try {
                const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(this.view.name)}/uptime?days=${UPTIME_DAYS}`, {cache: 'no-store'});
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
                reason = `Could not read the uptime: ${error.message}`;
            }
            if (asked !== this.asked) {
                return;
            }
            this.data = data;
            this.error = reason;
            this.old = old;
            this.loading = false;
            this.timer = setTimeout(() => this.load(), UPTIME_EVERY_MS);
        },
    },
    watch: {
        // A machine that comes back is read at once, not at the next minute
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

// A day of the answer as a bar shows it: its kind (the colour), its label and what it says
function day_of(day, tz)
{
    const label = new Intl.DateTimeFormat('en', {timeZone: 'UTC', month: 'short', day: 'numeric'}).format(new Date(`${day.day}T12:00:00Z`));
    let kind = 'up';
    let said = '100% up';
    if (day.known_ms === 0) {
        kind = 'unknown';
        said = 'not counted: servermon was not there yet';
    }
    else if (day.down_ms > 0) {
        kind = ((day.down_ms/day.known_ms) <= 0.01) ? 'some' : 'bad';
        said = `${share_text(day.known_ms, day.down_ms)} up · down ${format_ms(day.down_ms)}`;
    }
    const longest = day.down.slice().sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, STRETCHES_SHOWN).sort((a, b) => a.from - b.from);
    const stretches = longest.map(v => ({from: v.from, text: stretch_text(v, tz)}));
    return {day: day.day, known_ms: day.known_ms, down_ms: day.down_ms, kind, label, said, title: `${label}: ${said}`, stretches, more: day.down_more + day.down.length - longest.length};
}

// 01:12 – 10:19 · 9h 7m · rebooted; a stretch to the day's end ends at 24:00
function stretch_text(stretch, tz)
{
    const format = new Intl.DateTimeFormat('en-GB', {timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    const from = format.format(new Date(stretch.from));
    let to = format.format(new Date(stretch.to));
    if ((to === '00:00') && (stretch.to > stretch.from)) {
        to = '24:00';
    }
    const why = ((stretch.why === null) || (WHY_SAID[stretch.why] === undefined)) ? [] : [WHY_SAID[stretch.why]];
    return [`${from} – ${to}`, format_ms(stretch.to - stretch.from)].concat(why).join(' · ');
}

// The share up, never rounded up to 100% while a second was down
function share_text(known_ms, down_ms)
{
    const share = Math.floor((1 - down_ms/known_ms)*1000)/10;
    return `${share.toFixed(1)}%`;
}

export default remote_uptime;
