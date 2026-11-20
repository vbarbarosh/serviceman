import clock_of from './clock_of.js';
import data_table from './data_table.js';
import format_ms from './format_ms.js';
import page_head from './page_head.js';
import state_pill from './state_pill.js';

// The tone of each state, as a pill draws it
const TONES = {ok: 'run', warn: 'busy', bad: 'bad', none: 'idle'};
// The tab of a machine's page that mends a check, by the name its button shows
const TAB_NAMES = {firewall: 'Firewall', docker: 'Docker', shell: 'Shell', configure: 'Configure', vulnerabilities: 'Vulnerabilities'};
// A check a column, the last folding first on a narrow screen; a machine with nothing to show
// says why across them
const COLUMNS = [
    {key: 'name', label: 'Remote', wraps: true},
    {key: 'open', label: 'Open to the internet', fold: 7, phone: 'row', spread: v => (v.checks.length === 0) ? ['firewall', 'ssh', 'updates', 'auto', 'system', 'vulnerabilities'] : []},
    {key: 'firewall', label: 'Firewall', fold: 4, phone: 'row'},
    {key: 'ssh', label: 'SSH', fold: 5, phone: 'row'},
    {key: 'updates', label: 'Updates', fold: 3, phone: 'row'},
    {key: 'auto', label: 'Auto updates', fold: 2, phone: 'row'},
    {key: 'system', label: 'Release', fold: 1, phone: 'row'},
    {key: 'vulnerabilities', label: 'Vulnerabilities', fold: 6, phone: 'row'},
];

// What each machine leaves open to harm, worst first: a row per machine, a column per check,
// as the last look at it found. A click on a row shows what stands behind each check at the foot
// of the view, and mends it with a click where its root half can (ssh's passwords, automatic
// updates), else opens the tab of the machine's page that mends it. Each machine is looked at
// once an hour and when it connects; Check again looks at every one now.
const security_pane = {
    template: `
<article id="detail" class="list security">
    <page-head category="security">
        <template #state><span v-if="(summary.text !== '')" class="page-head-count" :class="summary.state">{{ summary.text }}</span></template>
        <template #acts>
            <span class="page-head-when" :title="checked_title"><span v-if="(looking > 0)" class="spin"/>{{ checked_text }}</span>
            <button type="button" :disabled="(asking || checking)" @click="check_again"><span v-if="(asking || checking)" class="spin"/>{{ ((asking || checking) ? 'Checking…' : 'Check again') }}</button>
        </template>
        <template #how>
            <p>Each machine is looked over once an hour, when it connects and on Check again: what the internet gets to, each port knocked from here; its firewall; whether ssh takes passwords; updates, and whether they install themselves; how long its release is supported; the critical CVEs that hit it, as Ubuntu's own list says them. A click on a row says what stands behind each check, and mends it there where the machine's root half can (ssh's passwords, automatic updates), or opens the tab that does.</p>
        </template>
    </page-head>
    <p v-if="(error !== null)" class="alert">{{ error }}</p>
    <data-table :columns="COLUMNS" :rows="rows_shown" row_key="remote" :row_class="row_class" :more="more" framed :total="rows.length" :foot="foot" empty_icon="&lt;path d=&quot;M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z&quot;/&gt;" empty_title="No machines yet" empty="A machine is looked at once its agent dials in.">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a machine" aria-label="Find a machine by its name" spellcheck="false">
            <span class="dt-chips">
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #cell="{row, column, more}">
            <template v-if="(column.key === 'name')">
                <span class="dt-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/></svg></span>
                <span class="dt-name">
                    <button type="button" class="link" :title="('The page of ' + row.name)" @click="$emit('remote', row.remote)">{{ row.name }}</button>
                    <small v-if="(row.phase !== 'online')" class="bad">{{ away_of(row) }}</small>
                    <small v-else-if="row.checking"><span class="spin"/>looking now</small>
                    <small v-else-if="(title_of(row) !== '')">{{ title_of(row) }}</small>
                </span>
                <span v-if="(more && (row.at !== null))" class="dt-detail">looked at {{ format_ms(Math.max(0, state.now - row.at)) }} ago</span>
            </template>
            <span v-else-if="(row.checks.length === 0)" class="muted"><span v-if="((row.error === null) && row.checking)" class="spin"/>{{ note_of(row) }}</span>
            <template v-else>
                <small v-if="(more === false)" class="security-label">{{ column.label }}</small>
                <div v-for="check of checks_in(row, column.key)" :key="check.key" class="security-check" :title="((more || (check.detail === null)) ? '' : check.detail)">
                    <state-pill :tone="tone_of(check.state)" :text="check.text"/>
                    <span v-if="(more && (check.detail !== null))" class="dt-detail">{{ check.detail }}</span>
                    <button v-if="(more && (check.mend !== null) && (row.phase === 'online'))" type="button" class="security-mend primary" :disabled="(mending_of(row) !== null)" @click="mend(row, check)"><span v-if="(mending_of(row) === check.mend.key)" class="spin"/>{{ ((mending_of(row) === check.mend.key) ? check.mend.doing : check.mend.label) }}</button>
                    <button v-else-if="(more && (check.tab !== null) && (check.state !== 'ok') && (row.phase === 'online'))" type="button" class="security-mend" @click="$emit('tab', {remote: row.remote, tab: check.tab})">Open {{ TAB_NAMES[check.tab] }}</button>
                    <span v-if="(more && (mend_errors[row.remote + ' ' + check.key] !== undefined))" class="dt-detail bad">{{ mend_errors[row.remote + ' ' + check.key] }}</span>
                </div>
            </template>
        </template>
    </data-table>
</article>
`,
    components: {'data-table': data_table, 'page-head': page_head, 'state-pill': state_pill},
    props: ['state'],
    emits: ['remote', 'tab'],
    data: function () {
        // asked: Check again was pressed and its looks have not shown in the status yet, so the
        // button says Checking from the click on, not a second later
        // mends: the mend a click started on each machine, until a look after it shows; the
        // status says it too, for a page opened meanwhile. mend_errors: why one failed, by
        // machine and check, under that check.
        // filter, show: the find box and the chip picked, all, bad or warn
        return {COLUMNS, TAB_NAMES, asking: false, asked: false, error: null, mends: {}, mend_errors: {}, filter: '', show: 'all'};
    },
    computed: {
        security: function () {
            return (this.state.security === undefined) ? null : this.state.security;
        },
        rows: function () {
            return (this.security === null) ? [] : this.security.rows;
        },
        // The rows the find box and the chip leave
        rows_shown: function () {
            const word = this.filter.toLowerCase();
            return this.rows.filter(v => ((this.show === 'all') || (v.state === this.show)) && ((word === '') || v.name.toLowerCase().includes(word)));
        },
        chips: function () {
            return [{value: 'all', label: 'All', phase: null, count: this.rows.length}, {value: 'bad', label: 'To mend', phase: 'failed', count: this.state_count('bad')}, {value: 'warn', label: 'To look at', phase: 'stopping', count: this.state_count('warn')}];
        },
        // The footer: how many machines, to mend, to look at, not looked at
        foot: function () {
            const unlooked = this.rows.filter(v => v.checks.length === 0).length;
            const out = [{text: `${this.rows.length} ${(this.rows.length === 1) ? 'machine' : 'machines'}`, tone: ''}];
            if (this.state_count('bad') > 0) {
                out.push({text: `${this.state_count('bad')} to mend`, tone: 'bad'});
            }
            if (this.state_count('warn') > 0) {
                out.push({text: `${this.state_count('warn')} to look at`, tone: 'warn'});
            }
            if (unlooked > 0) {
                out.push({text: `${unlooked} not looked at`, tone: ''});
            }
            return out;
        },
        checking: function () {
            return this.asked || ((this.security !== null) && this.security.checking);
        },
        // What is to mend and what to look at, counted over every machine's checks
        summary: function () {
            if ((this.security === null) || this.rows.every(v => v.checks.length === 0)) {
                return {state: 'muted', text: ''};
            }
            const counts = this.security.counts;
            const items = [];
            if (counts.bad > 0) {
                items.push(`${counts.bad} to mend`);
            }
            if (counts.warn > 0) {
                items.push(`${counts.warn} to look at`);
            }
            if (items.length === 0) {
                return {state: 'run', text: 'Nothing found'};
            }
            return {state: (counts.bad > 0) ? 'bad' : 'warn', text: items.join(' · ')};
        },
        // The newest look, or the looks going on
        last_at: function () {
            const times = this.rows.map(v => v.at).filter(v => v !== null);
            return (times.length === 0) ? null : Math.max(...times);
        },
        // How many machines are being looked at now
        looking: function () {
            return this.rows.filter(v => v.checking).length;
        },
        checked_text: function () {
            if (this.looking > 0) {
                return `looking at ${this.looking} ${(this.looking === 1) ? 'machine' : 'machines'}`;
            }
            return (this.last_at === null) ? '' : `checked ${format_ms(Math.max(0, this.state.now - this.last_at))} ago`;
        },
        checked_title: function () {
            return (this.last_at === null) ? '' : new Date(this.last_at).toLocaleString();
        },
    },
    watch: {
        'state.security.checking': function (now) {
            if (now) {
                this.asked = false;
            }
        },
    },
    methods: {
        format_ms,
        tone_of: function (state) {
            return TONES[state];
        },
        // How many machines stand so
        state_count: function (state) {
            return this.rows.filter(v => v.state === state).length;
        },
        // Under a machine away: since when, as its page says it
        away_of: function (row) {
            const found = this.state.remotes.find(v => v.name === row.remote);
            return ((found === undefined) || (found.left_at === null) || (found.left_at === undefined)) ? 'offline' : `offline since ${clock_of(found.left_at)}`;
        },
        // Under a machine: its title, when it has one of its own
        title_of: function (row) {
            const found = this.state.remotes.find(v => v.name === row.remote);
            return ((found === undefined) || (found.title === undefined) || (found.title === null) || (found.title === found.name)) ? '' : found.title;
        },
        checks_in: function (row, key) {
            return row.checks.filter(v => v.key === key);
        },
        // A check has more to say when it has a detail
        more: function (row, key) {
            return this.checks_in(row, key).some(v => v.detail !== null);
        },
        // A machine away is shown for its last look, faded; one with something to mend or to look
        // at has its edge
        row_class: function (row) {
            if (row.phase !== 'online') {
                return 'dim';
            }
            return {bad: 'dt-bad', warn: 'dt-warn'}[row.state] || '';
        },
        // Why a machine has no checks to show
        note_of: function (row) {
            if (row.error !== null) {
                return `Not looked at: ${row.error}`;
            }
            if (row.checking) {
                return 'Looking at it now…';
            }
            if (row.phase !== 'online') {
                return 'Looked at once it is back.';
            }
            return 'Not looked at yet: within a minute.';
        },
        // The mend going on at a machine: the one clicked here, from the click until a look
        // after it shows, else the one the status says another page started
        mending_of: function (row) {
            const mine = this.mends[row.remote];
            if ((mine !== undefined) && ((row.at === null) || (row.at < mine.at))) {
                return mine.key;
            }
            return (row.mending === undefined) ? null : row.mending;
        },
        // A check mended by the machine's root half. Where it may shut someone out, it asks
        // first. The button says it is at work from the click on; the check changes with the
        // look that follows, and a failure is said under it.
        mend: async function (row, check) {
            if ((check.mend.confirm !== null) && (window.confirm(check.mend.confirm) === false)) {
                return;
            }
            const at = Date.now();
            const said = `${row.remote} ${check.key}`;
            this.mends = Object.assign({}, this.mends, {[row.remote]: {key: check.mend.key, at}});
            this.mend_errors = Object.fromEntries(Object.entries(this.mend_errors).filter(v => v[0] !== said));
            let failed = null;
            try {
                const answer = await fetch('/api/v1/security/mend', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({remote: row.remote, mend: check.mend.key})});
                if (answer.ok === false) {
                    failed = (await answer.json()).error;
                }
            }
            catch {
                failed = 'the answer never came back';
            }
            if (failed !== null) {
                this.mend_errors = Object.assign({}, this.mend_errors, {[said]: failed});
                this.mends = Object.fromEntries(Object.entries(this.mends).filter(v => v[0] !== row.remote));
                return;
            }
            // Done and looked at again: the status brings that look within a moment
            setTimeout(() => (this.mends = Object.fromEntries(Object.entries(this.mends).filter(v => (v[0] !== row.remote) || (v[1].at !== at)))), 10000);
        },
        check_again: async function () {
            this.asking = true;
            this.error = null;
            try {
                const answer = await fetch('/api/v1/security/check', {method: 'POST'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.error = outcome.error;
                    return;
                }
                // Nothing connected is nothing to look at; a status that never says so lets go
                this.asked = (outcome.checking.length > 0);
                setTimeout(() => (this.asked = false), 5000);
            }
            catch {
                this.error = 'the answer never came back';
            }
            finally {
                this.asking = false;
            }
        },
    },
};

export default security_pane;
