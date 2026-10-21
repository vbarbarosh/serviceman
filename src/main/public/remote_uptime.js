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

// The machine's uptime in one row under its name, a bar a day for the last 30, counted by its
// agent from servermon's lines: green when every second has one, orange from 99%, red below, grey
// before servermon came. A day pointed at, focused or tapped says its share and each stretch it
// was down, in the machine's own time zone, in a box over what is below, so the row keeps its
// height. Read when the pane opens and every minute after; what was read stays on screen while
// the next is read. Bare, it is the row alone, with no card and no title: a line of a list that
// says what it is beside it (a machine's row opened in the Remotes table).
const remote_uptime = {
    template: `
<section class="ov-uptime" :class="{loading, card: (bare !== true), bare: (bare === true)}">
    <div class="ov-uptime-row">
        <div v-if="(bare !== true)" class="ov-uptime-head">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons.pulse"/>
            <b>Uptime</b>
        </div>
        <p v-if="old" class="ov-uptime-say muted">Uptime needs agent 1.22 or newer; this machine runs {{ (view.agent_version || 'an older one') }}. <button type="button" class="link" @click="$emit('tab', 'configure')">Update it in Configure →</button></p>
        <p v-else-if="(error !== null)" class="ov-uptime-say bad">{{ error }}</p>
        <template v-else>
            <span class="ov-uptime-from muted">{{ ((data === null) ? '' : days[0].label) }}</span>
            <div class="ov-uptime-track">
                <div v-if="(data !== null)" class="ov-uptime-bars" @mouseleave="hovered = null" @keydown.esc="unpick">
                    <button v-for="(day, i) in days" :key="day.day" type="button" class="ov-uptime-day" :class="[day.kind, {on: (i === shown_index)}]" :aria-label="day.title" :aria-pressed="(i === picked)" @mouseenter="hovered = i" @focus="hovered = i" @blur="hovered = null" @click="pick(i)"></button>
                </div>
                <div v-if="(tip !== null)" class="ov-uptime-tip" :class="{open: (shown !== null)}" :style="tip_style" aria-hidden="true">
                    <p><b>{{ tip.label }}</b> · {{ tip.said }}</p>
                    <template v-if="(tip.stretches.length > 0)">
                        <ul>
                            <li v-for="stretch in tip.stretches" :key="stretch.from">{{ stretch.text }}</li>
                            <li v-if="(tip.more > 0)" class="muted">and {{ tip.more }} shorter {{ ((tip.more === 1) ? 'one' : 'ones') }}</li>
                        </ul>
                        <p class="muted">Each stretch longer than 10 s, in {{ data.tz }} time</p>
                    </template>
                </div>
            </div>
            <span class="ov-uptime-to muted">{{ ((data === null) ? '' : (data.away ? days[days.length - 1].label : 'today')) }}</span>
        </template>
        <span class="ov-chart-value">{{ summary }}</span>
    </div>
</section>
`,
    props: ['view', 'bare'],
    emits: ['tab'],
    data: function () {
        // The box says the last day shown while it fades out, where that day is
        return {data: null, error: null, old: false, loading: false, asked: 0, timer: null, hovered: null, picked: null, tip_index: null};
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
            // A narrow row wraps it between its parts, never inside one: "down 1d 10h 18m" stays whole
            const count = `${known.length}\u00a0${(known.length === 1) ? 'day' : 'days'}`;
            const down = `down ${format_ms(down_ms)}`.replace(/ /g, '\u00a0');
            return (down_ms === 0) ? `${count} · 100%` : `${count} · ${share_text(known_ms, down_ms)} · ${down}`;
        },
        shown_index: function () {
            return (this.hovered === null) ? this.picked : this.hovered;
        },
        shown: function () {
            return ((this.shown_index === null) || (this.shown_index >= this.days.length)) ? null : this.days[this.shown_index];
        },
        tip: function () {
            return ((this.tip_index === null) || (this.tip_index >= this.days.length)) ? null : this.days[this.tip_index];
        },
        // Under the middle of its day, and inside the row at both ends: at the first day the box
        // starts where the bars start, at the last it ends where they end
        tip_style: function () {
            const at = (this.tip_index + 0.5)/this.days.length*100;
            return {left: `${at}%`, transform: `translateX(-${at}%)`};
        },
    },
    methods: {
        // The day picked again is put away, though the pointer or the focus is still on it
        pick: function (i) {
            if (this.picked === i) {
                this.unpick();
                return;
            }
            this.picked = i;
        },
        unpick: function () {
            this.picked = null;
            this.hovered = null;
        },
        // A tap anywhere else puts a picked day's box away
        unpick_outside: function (event) {
            if ((this.picked !== null) && (this.$el.contains(event.target) === false)) {
                this.picked = null;
            }
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
        shown_index: function (value) {
            if (value !== null) {
                this.tip_index = value;
            }
        },
        // A machine that comes back is read at once, not at the next minute
        'view.phase': function () {
            this.load();
        },
    },
    mounted: function () {
        document.addEventListener('pointerdown', this.unpick_outside);
        this.load();
    },
    unmounted: function () {
        document.removeEventListener('pointerdown', this.unpick_outside);
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
