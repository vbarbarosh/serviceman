import data_table from './data_table.js';
import format_bytes from './format_bytes.js';

// What Logline's lines take, day by day: a bar a day from the oldest to today, the days as a
// table with their sizes, and the days older than a week, two weeks or a month dropped for
// good. Logline keeps a day as one piece, so a day goes whole and at once. Nothing is picked at
// first; once a period is, the bars and the rows that would go turn red, and the button says how
// many days and how much; a click asks once more. serviceman asks Logline with the admin token, so nobody who only
// opens the viewer can delete.
const KEEPS = [
    {days: 7, label: 'a week'},
    {days: 14, label: '2 weeks'},
    {days: 30, label: 'a month'},
];
const DAY_MS = 86400000;
const ROWS_SHOWN = 14;

const logline_days = {
    template: `
<h2>Space</h2>
<div class="card logline-days">
    <p v-if="(said === null)" class="muted">Asking Logline what each day of lines takes…</p>
    <p v-else-if="(said.error !== undefined)" class="bad">{{ said.error }}</p>
    <template v-else>
        <div class="row-of ld-total">
            <b>{{ format_bytes(total.bytes) }}</b>
            <span v-if="(said.days.length === 0)" class="muted">no lines kept yet</span>
            <span v-else class="muted">{{ total.rows.toLocaleString('en-US') }} lines over {{ said.days.length }} {{ (said.days.length === 1) ? 'day' : 'days' }}, since {{ said.days[0].day }} · {{ format_bytes(total.raw) }} before compression</span>
        </div>
        <p v-if="(said.ttl !== null)" class="muted">{{ ttl_text }} <code>TTL {{ said.ttl }}</code></p>
        <p v-if="(said.undated.bytes > 0)" class="muted">{{ format_bytes(said.undated.bytes) }} of the table is kept in no day: it is not counted here, and never deleted from here.</p>
        <template v-if="(said.days.length > 0)">
            <div class="ld-chart" role="img" :aria-label="chart_label">
                <span v-for="day of chart" :key="day.day" class="ld-day" :class="{gone: day.gone, today: (day.day === said.today)}" :title="day.title"><i :style="{height: (day.share*100).toFixed(1) + '%'}"></i></span>
            </div>
            <div class="ld-axis muted"><span>{{ chart[0].day }}</span><span>{{ biggest_text }}</span><span>today</span></div>
            <data-table :columns="columns" :rows="rows" row_key="day" :row_class="v => (v.gone ? 'gone' : '')" :limit="rows_shown" empty="No day kept."/>
            <div class="actions ld-forget">
                <span>Delete older than</span>
                <span class="seg" role="group" aria-label="Delete the days older than">
                    <button v-for="item of keeps" :key="item.days" type="button" :class="{on: (keep === item.days)}" :aria-pressed="(keep === item.days)" :disabled="busy" @click="keep_pick(item.days)">{{ item.label }}</button>
                </span>
                <template v-if="(keep !== null)">
                    <button v-if="(asking === false)" type="button" class="danger" :disabled="(busy || (gone.length === 0))" @click="asking = true">{{ (gone.length === 0) ? 'Nothing that old' : ('Delete ' + gone_text) }}</button>
                    <span v-else class="ld-ask">Delete {{ gone_text }} for good? <button type="button" class="danger" :disabled="busy" @click="forget">Delete</button><button type="button" :disabled="busy" @click="asking = false">Cancel</button></span>
                </template>
            </div>
            <p class="muted">{{ keep_text }}</p>
        </template>
        <p v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')"><span v-if="busy" class="spin"/>{{ note }}</p>
    </template>
</div>
`,
    components: {'data-table': data_table},
    data: function () {
        // said: Logline's /days, {today, ttl, days, undated}, or {error}; null while asked
        // keep: the days a delete keeps, as picked; null until one is
        return {said: null, keep: null, keeps: KEEPS, asking: false, busy: false, note: '', bad: false, rows_shown: ROWS_SHOWN};
    },
    computed: {
        columns: function () {
            return [
                {key: 'day', label: 'Day'},
                {key: 'size', label: 'Size', align: 'right'},
                {key: 'lines', label: 'Lines', align: 'right', fold: 2},
                {key: 'raw', label: 'Before compression', align: 'right', fold: 1},
            ];
        },
        // TimestampTime + toIntervalDay(30): thirty days; any other TTL is shown as it is written
        ttl_text: function () {
            const days = /toIntervalDay\((\d+)\)/.exec(this.said.ttl);
            return (days === null) ? 'ClickHouse also deletes lines by itself, as the table says:' : `ClickHouse also deletes lines older than ${days[1]} days by itself, as the table says:`;
        },
        total: function () {
            return this.said.days.reduce((sum, v) => ({rows: sum.rows + v.rows, bytes: sum.bytes + v.bytes, raw: sum.raw + v.raw}), {rows: 0, bytes: 0, raw: 0});
        },
        // The first day kept: every day before it goes; null while no period is picked
        before: function () {
            return (this.keep === null) ? null : day_add(this.said.today, -this.keep);
        },
        gone: function () {
            return (this.before === null) ? [] : this.said.days.filter(v => v.day < this.before);
        },
        gone_text: function () {
            const bytes = this.gone.reduce((sum, v) => sum + v.bytes, 0);
            return `${this.gone.length} ${(this.gone.length === 1) ? 'day' : 'days'}, ${format_bytes(bytes)}`;
        },
        keep_text: function () {
            if (this.keep === null) {
                return 'Pick a period: the days it would delete turn red before anything goes.';
            }
            if (this.gone.length === 0) {
                return `Every day kept is from ${this.before} on, the last ${this.keep} days and today.`;
            }
            const last = this.gone[this.gone.length - 1].day;
            return `Deletes ${this.gone[0].day} to ${last}; keeps ${this.before} to today.`;
        },
        // Every day from the oldest to today, a day with no lines an empty bar, so the bars
        // stand where the days are
        chart: function () {
            const by_day = new Map(this.said.days.map(v => [v.day, v]));
            const biggest = Math.max(1, ...this.said.days.map(v => v.bytes));
            const out = [];
            for (let day = this.said.days[0].day; day <= this.said.today; day = day_add(day, 1)) {
                const kept = by_day.get(day);
                const bytes = (kept === undefined) ? 0 : kept.bytes;
                const lines = (kept === undefined) ? 0 : kept.rows;
                out.push({day, share: bytes/biggest, gone: (this.before !== null) && (day < this.before) && (kept !== undefined), title: `${day}: ${format_bytes(bytes)}, ${lines.toLocaleString('en-US')} lines`});
            }
            return out;
        },
        chart_label: function () {
            return `Size of each day's lines from ${this.chart[0].day} to today; the biggest day ${this.biggest_text}`;
        },
        biggest_text: function () {
            const biggest = this.said.days.reduce((best, v) => ((v.bytes > best.bytes) ? v : best), this.said.days[0]);
            return `biggest ${format_bytes(biggest.bytes)}, ${biggest.day}`;
        },
        // Newest first: the days that matter now are on top
        rows: function () {
            const before = this.before;
            return this.said.days.slice().reverse().map(function (item) {
                return {day: item.day, size: format_bytes(item.bytes), lines: item.rows.toLocaleString('en-US'), raw: format_bytes(item.raw), gone: ((before !== null) && (item.day < before))};
            });
        },
    },
    watch: {
        keep: function () {
            this.asking = false;
        },
    },
    mounted: function () {
        this.read();
    },
    methods: {
        format_bytes: function (bytes) {
            return format_bytes(bytes);
        },
        // The period picked again is put down: nothing red, nothing to delete
        keep_pick: function (days) {
            this.keep = (this.keep === days) ? null : days;
        },
        read: async function () {
            try {
                const answer = await fetch('/api/v1/logline/days');
                const body = await answer.json();
                this.said = answer.ok ? body : {error: body.error};
            }
            catch {
                this.said = {error: 'serviceman did not answer'};
            }
        },
        forget: async function () {
            this.busy = true;
            this.note = 'deleting…';
            this.bad = false;
            try {
                const answer = await fetch('/api/v1/logline/days/forget', {method: 'POST', body: JSON.stringify({before: this.before})});
                const body = await answer.json();
                if (answer.ok === false) {
                    this.note = body.error;
                    this.bad = true;
                    return;
                }
                this.note = (body.dropped.length === 0) ? 'Nothing was that old any more.' : `Deleted ${body.dropped.length} ${(body.dropped.length === 1) ? 'day' : 'days'}, ${format_bytes(body.bytes)}, ${body.rows.toLocaleString('en-US')} lines.`;
            }
            catch {
                this.note = 'the answer never came back: the days below are as Logline has them now';
                this.bad = true;
            }
            finally {
                this.asking = false;
                this.busy = false;
                await this.read();
            }
        },
    },
};

// '2026-10-24', -7 -> '2026-10-17'
function day_add(day, days)
{
    return new Date(Date.parse(`${day}T00:00:00Z`) + days*DAY_MS).toISOString().slice(0, 10);
}

export default logline_days;
