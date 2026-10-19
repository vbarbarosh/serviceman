import data_table from './data_table.js';
import format_ms from './format_ms.js';

// The dot of each state, as the rail draws a service: a filled disc is alive, an empty ring has
// nothing to say
const DOT_OF = {ok: 'running', warn: 'stopping', bad: 'failed', none: ''};

// How everything is: what is wrong first, as cards that say why and what mends it, then a table
// per kind of thing, a row per thing and a column per check. A row opens on a click to say what
// stands behind each check, and what a narrow screen folded away; nothing here is changed by
// hand, it follows the checks.
const health_pane = {
    template: `
<article id="detail" class="list health">
    <div class="list-head">
        <h1>Health</h1>
        <span :class="summary.state">{{ summary.text }}</span>
        <span class="muted health-checked" :title="checked_title">{{ checked_text }}</span>
    </div>
    <p class="muted">Looked at every minute: whether each machine is here and has room, its agent, updates, Docker and firewall; whether each service answers the way a visitor's request reaches it; whether Logline takes every machine's lines; whether each forward listens. A problem shows once it is seen twice in a row, and goes once it is mended.</p>
    <section v-for="item of problems" :key="item.key" class="card problem">
        <div class="problem-head">
            <span class="dot failed"/>
            <b class="problem-subject">{{ item.subject }}</b>
            <button v-if="(item.remote !== null)" type="button" class="tag" :title="('The page of ' + item.remote)" @click="$emit('remote', item.remote)">{{ item.remote }}</button>
            <button v-if="(item.service !== null)" type="button" class="tag" :title="('The page of ' + item.service)" @click="$emit('select', item.service)">{{ item.service }}</button>
            <span class="muted problem-since" :title="when(item.since)">for {{ format_ms(Math.max(0, state.now - item.since)) }}</span>
        </div>
        <p class="problem-cause">{{ item.cause }}</p>
        <p class="muted problem-fix">{{ item.fix }}</p>
    </section>
    <section v-for="area of areas" :key="area.key" class="health-area">
        <h2>{{ area.title }}</h2>
        <data-table :columns="columns_of(area)" :rows="area.rows" :empty="empty_text(area.key)" :more="more">
            <template #cell="{row, column, more}">
                <template v-if="(column.key === 'name')">
                    <span class="dt-state" :class="row.state"><span class="dot" :class="dot_of(row.state)"/></span>
                    <button v-if="(row.service !== null)" type="button" class="link" :title="('The page of ' + row.service)" @click="$emit('select', row.service)">{{ row.name }}</button>
                    <button v-else-if="(row.remote !== null)" type="button" class="link" :title="('The page of ' + row.remote)" @click="$emit('remote', row.remote)">{{ row.name }}</button>
                    <b v-else>{{ row.name }}</b>
                </template>
                <template v-else>
                    <span v-if="(checks_in(row, column.key).length === 0)" class="muted">—</span>
                    <div v-for="check of checks_in(row, column.key)" :key="check.key" class="dt-state" :class="check.state" :title="((more || (check.detail === null)) ? '' : check.detail)">
                        <span class="dot" :class="dot_of(check.state)"/>{{ check.text }}<span v-if="(more && (check.detail !== null))" class="dt-detail">{{ check.detail }}</span>
                    </div>
                </template>
            </template>
        </data-table>
    </section>
</article>
`,
    components: {'data-table': data_table},
    props: ['state'],
    emits: ['remote', 'select'],
    computed: {
        problems: function () {
            return (this.state.problems === undefined) ? [] : this.state.problems;
        },
        health: function () {
            return (this.state.health === undefined) ? null : this.state.health;
        },
        areas: function () {
            return (this.health === null) ? [] : this.health.areas;
        },
        // What is wrong, what to look at, or that nothing is. It counts things, not problems:
        // a thing is red the moment a look finds it so, a problem once two looks have
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
            // Nothing set up: no machine, service or forward; Logline alone may say it is not
            if ((items.length === 0) && this.health.areas.every(v => (v.key === 'logline') || (v.rows.length === 0))) {
                return {state: 'muted', text: 'Nothing set up yet'};
            }
            if (items.length === 0) {
                return {state: 'ok-text', text: 'Everything works'};
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
        when: function (ms) {
            return `since ${new Date(ms).toLocaleString()}`;
        },
        dot_of: function (state) {
            return DOT_OF[state];
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
            return {machines: 'Machine', services: 'Service', logline: '', lines: 'Machine', forwards: 'Forward'}[key] || '';
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
            return [{key: 'name', label: this.name_head(area.key), wraps: true}].concat(labels.map((v, index) => ({key: v, label: v, fold: (labels.length - index)})));
        },
        checks_in: function (row, label) {
            return row.checks.filter(v => v.label === label);
        },
        // A check has more to say when it has a detail: its row opens to say it
        more: function (row, label) {
            return this.checks_in(row, label).some(v => v.detail !== null);
        },
    },
};

export default health_pane;
