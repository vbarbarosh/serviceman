import format_ms from './format_ms.js';

// How often it is read again: the agent counts servermon's lines every minute
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

// A machine's uptime in its head, after its Disk: `Uptime, 30 days`, the share up and how long
// it was down, and under them a dot a day for the last 30, counted by its agent from servermon's
// lines: green when every second has one, orange from 99%, red below, grey before servermon came.
// A dot pointed at, focused or tapped says its day, its share and each stretch it was down, in
// the machine's own time zone, in a box over what is below, so the head keeps its height. Read
// when the page opens and every minute after; what was read stays on screen while the next is
// read. While the machine is away its last answer is shown, and the day it went is red: nothing
// has been heard from it since, and the box says since when; the share stays what its agent
// counted. A head too narrow for it beside the charts gives it a row of its own, the dots spread
// across it.
const remote_uptime = {
    template: `
<div class="item-uptime" :class="{loading}" :title="title">
    <p class="item-uptime-label">{{ label }}</p>
    <p class="item-uptime-value">{{ value }}<small v-if="(small !== '')">{{ small }}</small></p>
    <div class="item-uptime-track" @mouseleave="hovered = null" @keydown.esc="unpick">
        <div v-if="(data !== null)" class="item-uptime-dots">
            <button v-for="(day, i) in days" :key="day.day" type="button" class="item-uptime-day" :class="[day.kind, {on: (i === shown_index)}]" :aria-label="day.title" :aria-pressed="(i === picked)" @mouseenter="hovered = i" @focus="hovered = i" @blur="hovered = null" @click="pick(i)"></button>
        </div>
        <div v-if="(tip !== null)" class="ov-uptime-tip" :class="{open: (shown !== null)}" :style="tip_style" aria-hidden="true">
            <p><b>{{ tip.label }}</b> · {{ tip.said }}</p>
            <template v-if="(tip.stretches.length > 0)">
                <ul>
                    <li v-for="stretch in tip.stretches" :key="stretch.since">{{ stretch.text }}</li>
                    <li v-if="(tip.more > 0)" class="muted">and {{ tip.more }} shorter {{ ((tip.more === 1) ? 'one' : 'ones') }}</li>
                </ul>
                <p class="muted">Each stretch longer than 10 s, in {{ data.tz }} time</p>
            </template>
        </div>
    </div>
</div>
`,
    props: ['view'],
    data: function () {
        // The box says the last day shown while it fades out, where that day is
        return {data: null, error: null, old: false, loading: false, asked: 0, timer: null, hovered: null, picked: null, tip_index: null};
    },
    computed: {
        days: function () {
            if (this.data === null) {
                return [];
            }
            const out = this.data.days.map(v => day_of(v, this.data.tz));
            if ((this.data.away === true) && (typeof this.data.until === 'number') && (out.length > 0)) {
                out[out.length - 1] = day_away(out[out.length - 1], this.data.until, this.data.tz);
            }
            return out;
        },
        // The days servermon counted, and their time up and down together
        counted: function () {
            const known = this.days.filter(v => v.known_ms > 0);
            return {days: known.length, known_ms: known.reduce((sum, v) => sum + v.known_ms, 0), down_ms: known.reduce((sum, v) => sum + v.down_ms, 0)};
        },
        label: function () {
            const count = this.counted.days;
            return (count === 0) ? 'Uptime' : `Uptime, ${count} ${(count === 1) ? 'day' : 'days'}`;
        },
        // Its share up, never rounded up to 100% while a second was down; a dash until it is
        // counted
        value: function () {
            if ((this.data === null) || (this.counted.days === 0)) {
                return '—';
            }
            return (this.counted.down_ms === 0) ? '100%' : share_text(this.counted.known_ms, this.counted.down_ms);
        },
        small: function () {
            if (this.old) {
                return 'agent too old';
            }
            if (this.error !== null) {
                return 'not read';
            }
            if (this.data === null) {
                return this.loading ? 'reading…' : '';
            }
            if (this.counted.days === 0) {
                return 'nothing counted yet';
            }
            return (this.counted.down_ms === 0) ? '' : `down ${format_ms(this.counted.down_ms)}`;
        },
        title: function () {
            if (this.old) {
                return `Uptime needs agent 1.22 or newer; this machine runs ${this.view.agent_version || 'an older one'}: Configure updates it`;
            }
            if (this.error !== null) {
                return this.error;
            }
            return 'The last 30 days, a dot a day, counted from servermon\'s lines: a second without one is a second down';
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
        // starts where the dots start, at the last it ends where they end
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

// A day of the answer as a dot shows it: its kind (the colour), its label and what it says
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
    const longest = day.down.slice().sort((a, b) => (b.until - b.since) - (a.until - a.since)).slice(0, STRETCHES_SHOWN).sort((a, b) => a.since - b.since);
    const stretches = longest.map(v => ({since: v.since, text: stretch_text(v, tz)}));
    return {day: day.day, known_ms: day.known_ms, down_ms: day.down_ms, kind, label, said, title: `${label}: ${said}`, stretches, more: day.down_more + day.down.length - longest.length};
}

// The day the machine went, while it is away: red, and saying since when nothing was heard
function day_away(day, until, tz)
{
    const since = new Intl.DateTimeFormat('en-GB', {timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(until));
    const said = `away: nothing heard from its agent since ${since}`;
    return Object.assign({}, day, {kind: 'bad', said, title: `${day.label}: ${said}`});
}

// 01:12 – 10:19 · 9h 7m · rebooted; a stretch to the day's end ends at 24:00
function stretch_text(stretch, tz)
{
    const format = new Intl.DateTimeFormat('en-GB', {timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    const since = format.format(new Date(stretch.since));
    let until = format.format(new Date(stretch.until));
    if ((until === '00:00') && (stretch.until > stretch.since)) {
        until = '24:00';
    }
    const why = ((stretch.why === null) || (WHY_SAID[stretch.why] === undefined)) ? [] : [WHY_SAID[stretch.why]];
    return [`${since} – ${until}`, format_ms(stretch.until - stretch.since)].concat(why).join(' · ');
}

// The share up, never rounded up to 100% while a second was down
function share_text(known_ms, down_ms)
{
    const share = Math.floor((1 - down_ms/known_ms)*1000)/10;
    return `${share.toFixed(1)}%`;
}

export default remote_uptime;
