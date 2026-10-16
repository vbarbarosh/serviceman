import format_ms from './format_ms.js';

// The dot of each state, as the rail draws a service: a filled disc is alive, an empty ring has
// nothing to say
const DOT_OF = {ok: 'running', warn: 'stopping', bad: 'failed', none: ''};

// How everything is: what is wrong first, as cards that say why and what mends it, then every
// machine, service, Logline and forward, one row each, its checks side by side. Each check's
// detail opens under its row on a click; nothing here is changed by hand, it follows the checks.
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
        <div v-for="row of area.rows" :key="row.key" class="card health-row" :class="('state-' + row.state)">
            <div class="health-name">
                <span class="dot" :class="dot_of(row.state)"/>
                <button v-if="(row.service !== null)" type="button" class="link" :title="('The page of ' + row.service)" @click="$emit('select', row.service)">{{ row.name }}</button>
                <button v-else-if="(row.remote !== null)" type="button" class="link" :title="('The page of ' + row.remote)" @click="$emit('remote', row.remote)">{{ row.name }}</button>
                <b v-else>{{ row.name }}</b>
            </div>
            <div class="health-checks">
                <button v-for="check of row.checks" :key="check.key" type="button" class="health-check" :class="[('state-' + check.state), {open: is_open(row, check), plain: (check.detail === null)}]" :title="check.detail || ''" @click="toggle(row, check)">
                    <span class="dot" :class="dot_of(check.state)"/>
                    <span class="health-label">{{ check.label }}</span>
                    <span class="health-text">{{ check.text }}</span>
                </button>
            </div>
            <p v-for="check of row.checks.filter(v => is_open(row, v))" :key="('detail-' + check.key)" class="health-detail">
                <b>{{ check.label }}:</b> {{ check.detail }}
            </p>
        </div>
    </section>
</article>
`,
    props: ['state'],
    emits: ['remote', 'select'],
    data: function () {
        return {
            // The checks whose detail is open, by row and check
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
            if ((items.length === 0) && (counts.ok === 0)) {
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
            return 'Nothing to look at.';
        },
        is_open: function (row, check) {
            return (this.opened[`${row.key} ${check.key}`] === true);
        },
        toggle: function (row, check) {
            if (check.detail === null) {
                return;
            }
            const key = `${row.key} ${check.key}`;
            this.opened[key] = (this.opened[key] !== true);
        },
    },
};

export default health_pane;
