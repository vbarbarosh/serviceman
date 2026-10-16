import fold_table from './fold_table.js';
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
        <p v-if="(area.rows.length === 0)" class="muted health-empty">{{ empty_text(area.key) }}</p>
        <fold-table v-else v-slot="fold" :order="columns_of(area).slice().reverse()">
            <table class="health-table">
                <thead>
                    <tr>
                        <th v-if="(fold.folded.length > 0)" class="fold-caret"></th>
                        <th>{{ name_head(area.key) }}</th>
                        <th v-for="column of columns_of(area)" :key="column" :data-fold="column">{{ column }}</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="row of area.rows" :key="row.key">
                        <tr :class="{foldable: has_more(row, fold.folded), open: is_open(row)}" @click="row_click(row, fold.folded, $event)">
                            <td v-if="(fold.folded.length > 0)" class="fold-caret"><svg v-if="has_more(row, fold.folded)" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                            <td class="wraps health-name" :class="('state-' + row.state)">
                                <span class="dot" :class="dot_of(row.state)"/>
                                <button v-if="(row.service !== null)" type="button" class="link" :title="('The page of ' + row.service)" @click="$emit('select', row.service)">{{ row.name }}</button>
                                <button v-else-if="(row.remote !== null)" type="button" class="link" :title="('The page of ' + row.remote)" @click="$emit('remote', row.remote)">{{ row.name }}</button>
                                <b v-else>{{ row.name }}</b>
                            </td>
                            <td v-for="column of columns_of(area)" :key="column" :data-fold="column" :title="cell_title(row, column)">
                                <span v-if="(checks_in(row, column).length === 0)" class="muted">—</span>
                                <div v-for="check of checks_in(row, column)" :key="check.key" class="health-cell" :class="('state-' + check.state)">
                                    <span class="dot" :class="dot_of(check.state)"/>{{ check.text }}
                                </div>
                            </td>
                        </tr>
                        <tr v-if="is_open(row)" class="fold-more">
                            <td :colspan="(fold.span || (columns_of(area).length + 1))">
                                <dl class="fold-details">
                                    <template v-for="check of more_of(row, fold.folded)" :key="('more-' + check.key)">
                                        <dt>{{ check.label }}</dt>
                                        <dd class="health-cell" :class="('state-' + check.state)">
                                            <span class="dot" :class="dot_of(check.state)"/>{{ check.text }}<span v-if="(check.detail !== null)" class="muted health-detail">{{ check.detail }}</span>
                                        </dd>
                                    </template>
                                </dl>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </fold-table>
    </section>
</article>
`,
    components: {'fold-table': fold_table},
    props: ['state'],
    emits: ['remote', 'select'],
    data: function () {
        return {
            // The rows whose details are open, by row key
            opened: {},
        };
    },
    computed: {
        problems: function () {
            return ((this.state.problems === undefined) ? [] : this.state.problems);
        },
        health: function () {
            return ((this.state.health === undefined) ? null : this.state.health);
        },
        areas: function () {
            return ((this.health === null) ? [] : this.health.areas);
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
            return {state: ((counts.bad > 0) ? 'bad' : 'warn'), text: items.join(' · ')};
        },
        checked_text: function () {
            if ((this.health === null) || (this.health.checked_at === null)) {
                return 'first look in a few seconds';
            }
            return `checked ${format_ms(Math.max(0, this.state.now - this.health.checked_at))} ago`;
        },
        checked_title: function () {
            return (((this.health === null) || (this.health.checked_at === null)) ? '' : new Date(this.health.checked_at).toLocaleString());
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
        // The area's columns: every check's label, in the order the rows first name them
        columns_of: function (area) {
            const out = [];
            for (const row of area.rows) {
                for (const check of row.checks) {
                    if (out.includes(check.label) === false) {
                        out.push(check.label);
                    }
                }
            }
            return out;
        },
        checks_in: function (row, column) {
            return row.checks.filter(v => v.label === column);
        },
        cell_title: function (row, column) {
            return this.checks_in(row, column).map(v => v.detail).filter(v => v !== null).join('\n');
        },
        // What a row's details show: the checks folded away, and every check with more to say
        more_of: function (row, folded) {
            return row.checks.filter(v => (folded.includes(v.label) || (v.detail !== null)));
        },
        has_more: function (row, folded) {
            return (this.more_of(row, folded).length > 0);
        },
        is_open: function (row) {
            return (this.opened[row.key] === true);
        },
        // A click on the row opens what stands behind it; a click on its name is the name's
        row_click: function (row, folded, event) {
            if ((this.has_more(row, folded) === false) || (event.target.closest('a, button') !== null)) {
                return;
            }
            this.opened = Object.assign({}, this.opened, {[row.key]: (this.opened[row.key] !== true)});
        },
    },
};

export default health_pane;
