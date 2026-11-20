import clock_of from './clock_of.js';
import data_table from './data_table.js';
import format_ms from './format_ms.js';
import overview_tile from './overview_tile.js';
import page_head from './page_head.js';
import restart_said from './restart_said.js';
import restart_window from './restart_window.js';
import service_kind from './service_kind.js';
import state_pill from './state_pill.js';

// The columns a table card shows of each kind, as drawn; a machine's other checks are in its
// row's ⋯, and a kind not named here shows every check it has
const SHOWN = {machines: ['Link', 'Agent', 'Disk'], services: ['State', 'Answers']};

// How a column is headed when its check's own label is not the drawn one
const HEADS = {Disk: 'Room'};

// The columns a state pill says, not a word: how a machine is linked, how a service stands
const PILLS = ['Link', 'State', 'Status'];

// The tone of each state, as a pill draws it
const TONES = {ok: 'run', warn: 'busy', bad: 'bad', none: 'idle'};

// How everything is: what is wrong first, as cards that say why and what mends it, then a table
// per kind of thing, a row per thing and a column per check. A click on a row shows it whole in
// a window over the page: what stands behind each check, and what a narrow screen folded away.
// Nothing here is changed by hand, it follows the checks.
const health_pane = {
    template: `
<article id="detail" class="list health">
    <page-head category="health">
        <template #state><span v-if="(summary.text !== '')" class="page-head-count" :class="summary.state">{{ summary.text }}</span></template>
        <template #acts>
            <span class="page-head-when" :title="checked_title"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>{{ checked_text }}</span>
            <button type="button" :disabled="checking" @click="check_now"><span v-if="checking" class="spin"/><svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 2.5v4.2h-4.2"/></svg>{{ checking ? 'Checking…' : 'Check now' }}</button>
        </template>
        <template #how>
            <p>Looked at every minute: whether each machine is here and has room, its agent, updates, Docker and firewall, and what the Security page last found there; whether each service answers the way a visitor's request reaches it; whether Logline takes every machine's lines; whether each forward listens. A problem shows once it is seen twice in a row, and goes once it is mended.</p>
        </template>
    </page-head>
    <!-- How each kind stands, at a glance: how many are well of how many, and the first that is not -->
    <div v-if="(health !== null)" class="ov-tiles health-tiles">
        <overview-tile v-for="tile of tiles" :key="tile.label" :icon="tile.icon" :label="tile.label" :value="null" :note="tile.note" :tone="tile.tone">{{ tile.well }}<small>/ {{ tile.all }}</small></overview-tile>
    </div>
    <!-- What is wrong, a card each: what, where, for how long, why, and the way to mend it -->
    <section v-for="item of problems" :key="item.key" class="card problem" :class="((item.level === 'warn') ? 'problem-warn' : '')">
        <svg class="problem-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/></svg>
        <div class="problem-body">
            <div class="problem-head">
                <b class="problem-subject">{{ item.subject }}</b>
                <button v-if="(item.remote !== null)" type="button" class="st-pill bad problem-where" :title="('The page of ' + item.remote)" @click="$emit('remote', item.remote)"><i aria-hidden="true"/>{{ item.remote }}</button>
                <button v-if="(item.service !== null)" type="button" class="st-pill bad problem-where" :title="('The page of ' + item.service)" @click="$emit('select', item.service)"><i aria-hidden="true"/>{{ item.service }}</button>
                <span class="muted problem-since" :title="when(item.since)">for {{ format_ms(Math.max(0, state.now - item.since)) }}</span>
            </div>
            <p class="problem-cause">{{ item.cause }}</p>
            <p class="problem-fix">
                <span v-if="restart_underway(item)" class="problem-restart"><span class="spin"/><b>{{ restart_line(item).text }}</b></span>
                <template v-else>{{ item.fix }}</template>
                <!-- A restart mends it: the button asks first, in a window, what goes down -->
                <button v-if="((item.mend === 'restart') && (restart_underway(item) === false))" type="button" class="primary problem-act" :disabled="(restart_busy !== null)" :title="((restart_busy === null) ? '' : (restart_busy + ' is restarting: one machine at a time'))" @click="restart_open = item">Restart {{ item.remote }}…</button>
                <button v-if="(item.service !== null)" type="button" class="link" @click="$emit('select', item.service)">Open {{ item.service }} →</button><button v-else-if="(item.remote !== null)" type="button" class="link" @click="$emit('remote', item.remote)">Open {{ item.remote }} →</button>
            </p>
            <p v-if="((item.mend === 'restart') && (restart_line(item) !== null) && (restart_underway(item) === false))" class="problem-link"><span :class="restart_line(item).tone">{{ restart_line(item).text }}</span></p>
            <p v-if="(item.link !== null)" class="problem-link"><a :href="item.link.href" target="_blank" rel="noopener">{{ item.link.text }} ↗</a></p>
        </div>
    </section>
    <restart-window v-if="(restart_open !== null)" :remote="restart_open.remote" :title="restart_open.remote" :why="restart_open.cause" :now="state.now" @close="restart_open = null"/>
    <!-- Each kind as a table card, Machines and Services side by side; a row's ⋯ shows every check -->
    <div class="health-tables">
        <data-table v-for="area of areas" :key="area.key" framed :title="area.title" :columns="columns_of(area)" :rows="rows_of(area)" :row_key="row_key" :row_class="row_class" :limit="((area.key === 'services') ? 5 : null)" :foot="foot_of(area)" :empty="empty_text(area.key)" :more="more" :opens="row_opens(area)">
            <template #cell="{row, column, more}">
                <template v-if="(column.key === 'name')">
                    <span class="dt-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="icon_of(area.key, row)"/></span>
                    <span class="dt-name">
                        <button v-if="(row.service !== null)" type="button" class="link" :title="('The page of ' + row.service)" @click="$emit('select', row.service)">{{ row.name }}</button>
                        <button v-else-if="(row.remote !== null)" type="button" class="link" :title="('The page of ' + row.remote)" @click="$emit('remote', row.remote)">{{ row.name }}</button>
                        <b v-else>{{ row.name }}</b>
                        <small v-if="(line_of(area.key, row) !== '')" :class="{bad: (row.state === 'bad')}">{{ line_of(area.key, row) }}</small>
                    </span>
                </template>
                <template v-else>
                    <span v-if="(checks_in(row, column.key).length === 0)" class="muted">—</span>
                    <div v-for="check of checks_in(row, column.key)" :key="check.key" class="health-check" :title="((more || (check.detail === null)) ? '' : check.detail)">
                        <state-pill v-if="pill_of(column.key)" :tone="tone_of(check.state)" :text="check.text"/>
                        <button v-else-if="(check.key === 'security')" type="button" class="link" :class="check.state" title="The Security page" @click="$emit('security')">{{ check.text }}</button>
                        <span v-else :class="check.state">{{ check.text }}</span>
                        <span v-if="(more && (check.detail !== null))" class="dt-detail">{{ check.detail }}</span>
                    </div>
                </template>
            </template>
            <template #details="{row}">
                <template v-for="check of rest_of(area.key, row)" :key="check.key">
                    <dt>{{ check.label }}</dt>
                    <dd><span :class="check.state">{{ check.text }}</span><span v-if="(check.detail !== null)" class="dt-detail">{{ check.detail }}</span></dd>
                </template>
            </template>
        </data-table>
    </div>
</article>
`,
    components: {'data-table': data_table, 'overview-tile': overview_tile, 'page-head': page_head, 'restart-window': restart_window, 'state-pill': state_pill},
    props: ['state'],
    emits: ['remote', 'security', 'select'],
    data: function () {
        // restart_open: the problem whose Restart window is open, or null
        return {checking: false, restart_open: null};
    },
    computed: {
        problems: function () {
            return (this.state.problems === undefined) ? [] : this.state.problems;
        },
        // The machine whose restart is under way, by name, or null: the others wait for it
        restart_busy: function () {
            const found = (this.state.remotes || []).find(v => restart_said.underway(v.restart));
            return (found === undefined) ? null : found.name;
        },
        health: function () {
            return (this.state.health === undefined) ? null : this.state.health;
        },
        areas: function () {
            return (this.health === null) ? [] : this.health.areas;
        },
        // The four tiles, as drawn: machines linked, services that answer, machines whose lines
        // reach Logline, forwards that listen; how many are well of how many, and the first that
        // is not, or that all are
        tiles: function () {
            const machines = this.rows_in('machines');
            const services = this.rows_in('services');
            const lines = this.rows_in('lines');
            const forwards = this.rows_in('forwards');
            const away = machines.filter(v => v.checks.some(vv => (vv.key === 'link') && (vv.state !== 'ok')));
            const failing = services.filter(v => v.state === 'bad');
            const sending = lines.filter(v => v.state === 'ok');
            const deaf = forwards.filter(v => v.state === 'bad');
            const logline_on = this.rows_in('logline').some(v => v.checks.some(vv => (vv.key === 'store') && (vv.state !== 'none')));
            return [
                {icon: 'monitor', label: 'Remotes', well: machines.length - away.length, all: machines.length, note: (away.length === 0) ? 'all linked' : `${away[0].name} offline${(away.length > 1) ? ` and ${away.length - 1} more` : ''}`, tone: (away.length === 0) ? '' : 'bad'},
                {icon: 'layers', label: 'Services', well: services.length - failing.length, all: services.length, note: (failing.length === 0) ? 'all answer' : `${failing.length} do not answer`, tone: (failing.length === 0) ? '' : 'bad'},
                {icon: 'file', label: 'Logs', well: sending.length, all: machines.length, note: logline_on ? 'machines send to Logline' : 'Logline is not set up', tone: ''},
                {icon: 'arrow', label: 'Forwards', well: forwards.length - deaf.length, all: forwards.length, note: (forwards.length === 0) ? 'none set up' : ((deaf.length === 0) ? 'all listen' : `${deaf.length} do not listen`), tone: (deaf.length === 0) ? '' : 'bad'},
            ];
        },
        // What is wrong, what to look at, or that nothing is. It counts things, not problems:
        // a thing is red the moment a look finds it so, a problem once two looks have. A problem
        // no table has a row for (no https for the apps) is still said: never "Everything works"
        // over a card of what does not
        summary: function () {
            if (this.health === null) {
                return {state: 'muted', text: ''};
            }
            const counts = this.health.counts;
            const all = counts.bad + counts.warn + counts.none + counts.ok;
            const items = [];
            if (counts.bad > 0) {
                items.push(`${counts.bad} of ${all} not working`);
            }
            if (counts.warn > 0) {
                items.push(`${counts.warn} to look at`);
            }
            if ((items.length === 0) && (this.problems.length > 0)) {
                return {state: 'bad', text: `${this.problems.length} ${(this.problems.length === 1) ? 'problem' : 'problems'}`};
            }
            // Nothing set up: no machine, service or forward; Logline alone may say it is not
            if ((items.length === 0) && this.health.areas.every(v => (v.key === 'logline') || (v.rows.length === 0))) {
                return {state: 'muted', text: 'Nothing set up yet'};
            }
            if (items.length === 0) {
                return {state: 'run', text: 'Everything works'};
            }
            return {state: (counts.bad > 0) ? 'bad' : 'warn', text: items.join(' · ')};
        },
        checked_text: function () {
            if ((this.health === null) || (this.health.checked_at === null)) {
                return 'first look in a few seconds';
            }
            return `checked ${format_ms(Math.max(0, this.state.now - this.health.checked_at))} ago`;
        },
        checked_title: function () {
            return ((this.health === null) || (this.health.checked_at === null)) ? '' : new Date(this.health.checked_at).toLocaleString();
        },
    },
    methods: {
        format_ms,
        // The rows of one kind, none when it is not there
        rows_in: function (key) {
            const found = this.areas.find(v => v.key === key);
            return (found === undefined) ? [] : found.rows;
        },
        when: function (ms) {
            return `since ${new Date(ms).toLocaleString()}`;
        },
        // Check now: the look of each minute, at once; the status the page polls shows it
        check_now: async function () {
            this.checking = true;
            try {
                await fetch('/api/v1/health/check', {method: 'POST'});
            }
            catch {
                // serviceman went while it was answering: the header says so, and the next
                // minute's look comes all the same
            }
            finally {
                this.checking = false;
            }
        },
        // A kind's rows in the order a table card shows them: what is wrong first, then what to
        // look at, then the rest as they come
        rows_of: function (area) {
            const rank = {bad: 0, warn: 1, none: 2, ok: 3};
            return area.rows.map((v, i) => ({row: v, i})).sort((a, b) => ((rank[a.row.state] - rank[b.row.state]) || (a.i - b.i))).map(v => v.row);
        },
        row_key: function (row) {
            return row.key;
        },
        // A row that is wrong, or to look at, has its edge
        row_class: function (row) {
            return {bad: 'dt-bad', warn: 'dt-warn'}[row.state] || '';
        },
        // A kind's footer: how many there are, and how many of them are wrong
        foot_of: function (area) {
            const bad = area.rows.filter(v => v.state === 'bad').length;
            const warn = area.rows.filter(v => v.state === 'warn').length;
            const counts = [{text: `${area.rows.length} ${area.title.toLowerCase()}`, tone: ''}];
            if (bad > 0) {
                counts.push({text: `${bad} not working`, tone: 'bad'});
            }
            if (warn > 0) {
                counts.push({text: `${warn} to look at`, tone: 'warn'});
            }
            // One Logline, or none at all: nothing to count
            return ((area.rows.length === 0) || (area.key === 'logline')) ? null : counts;
        },
        // Whether a row has checks its table card does not show, for its ⋯
        row_opens: function (area) {
            const self = this;
            return function (row) {
                return self.rest_of(area.key, row).length > 0;
            };
        },
        // The checks of a row its table card does not show: they are said in its window
        rest_of: function (key, row) {
            const shown = SHOWN[key];
            return (shown === undefined) ? [] : row.checks.filter(v => shown.includes(v.label) === false);
        },
        // A row's icon in its tile: a machine's drawing, a service's kind, a forward's arrow
        icon_of: function (key, row) {
            if ((key === 'services') && (row.service !== null)) {
                const found = this.state.services.find(v => v.name === row.service);
                return (found === undefined) ? '' : service_kind(found).icon;
            }
            if (key === 'forwards') {
                return '<path d="M4 12h16M14 6l6 6-6 6"/>';
            }
            if (key === 'logline') {
                return '<path d="M4 6h16M4 12h10M4 18h13"/>';
            }
            return '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/>';
        },
        // The line under a row's name: since when a machine is not linked, and nothing else
        // A problem's machine's restart, as its card says it, or null
        restart_line: function (item) {
            const found = (item.remote === null) ? undefined : (this.state.remotes || []).find(v => v.name === item.remote);
            return (found === undefined) ? null : restart_said(found.restart, this.state.now);
        },
        restart_underway: function (item) {
            const line = this.restart_line(item);
            return (line !== null) && line.underway;
        },
        line_of: function (key, row) {
            if ((key !== 'machines') || (row.remote === null)) {
                return '';
            }
            const found = this.state.remotes.find(v => v.name === row.remote);
            if (found === undefined) {
                return '';
            }
            // The row's name is the machine's title already: the line is for a machine away alone
            if ((row.state === 'bad') && (found.phase !== 'online') && (found.left_at !== null) && (found.left_at !== undefined)) {
                return `not linked since ${clock_of(found.left_at)}`;
            }
            return '';
        },
        pill_of: function (label) {
            return PILLS.includes(label);
        },
        tone_of: function (state) {
            return TONES[state];
        },
        empty_text: function (key) {
            if (key === 'machines') {
                return 'No machines yet: a machine shows here once its agent dials in.';
            }
            if (key === 'services') {
                return 'No services set up.';
            }
            if (key === 'forwards') {
                return 'No forwards set up.';
            }
            if (key === 'lines') {
                return 'No machine sends its lines to Logline.';
            }
            return 'Nothing to look at.';
        },
        name_head: function (key) {
            return {machines: 'Remote', services: 'Service', logline: '', lines: 'Remote', forwards: 'Forward'}[key] || '';
        },
        // The area's columns: the thing's name, then every check's label in the order the rows
        // first name them; the last folds first on a narrow screen
        columns_of: function (area) {
            const labels = [];
            for (const row of area.rows) {
                for (const check of row.checks) {
                    if (labels.includes(check.label) === false) {
                        labels.push(check.label);
                    }
                }
            }
            const shown = (SHOWN[area.key] === undefined) ? labels : SHOWN[area.key].filter(v => labels.includes(v));
            return [{key: 'name', label: this.name_head(area.key), wraps: true}].concat(shown.map((v, index) => ({key: v, label: (HEADS[v] === undefined) ? v : HEADS[v], fold: (PILLS.includes(v) ? null : (shown.length - index)), phone: (PILLS.includes(v) ? 'state' : 'line')})));
        },
        checks_in: function (row, label) {
            return row.checks.filter(v => v.label === label);
        },
        // A check has more to say when it has a detail: its row's bar says it
        more: function (row, label) {
            return this.checks_in(row, label).some(v => v.detail !== null);
        },
    },
};

export default health_pane;
