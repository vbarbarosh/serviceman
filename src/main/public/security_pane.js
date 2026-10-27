import data_table from './data_table.js';
import format_ms from './format_ms.js';

// The dot of each state, as Health draws a check
const DOT_OF = {ok: 'running', warn: 'stopping', bad: 'failed', none: ''};
// The tab of a machine's page that mends a check, by the name its button shows
const TAB_NAMES = {firewall: 'Firewall', docker: 'Docker', shell: 'Shell', configure: 'Configure'};
// A check a column, the last folding first on a narrow screen; a machine with nothing to show
// says why across them
const COLUMNS = [
    {key: 'name', label: 'Machine', wraps: true},
    {key: 'open', label: 'Open to the internet', fold: 6, spread: v => (v.checks.length === 0) ? ['firewall', 'ssh', 'updates', 'auto', 'system'] : []},
    {key: 'firewall', label: 'Firewall', fold: 4},
    {key: 'ssh', label: 'SSH', fold: 5},
    {key: 'updates', label: 'Updates', fold: 3},
    {key: 'auto', label: 'Auto updates', fold: 2},
    {key: 'system', label: 'System', fold: 1},
];

// What each machine leaves open to harm, worst first: a row per machine, a column per check,
// as the last look at it found. A click on a row shows what stands behind each check at the foot
// of the view, and mends it with a click where its root half can (ssh's passwords, automatic
// updates), else opens the tab of the machine's page that mends it. Each machine is looked at
// once an hour and when it connects; Check again looks at every one now.
const security_pane = {
    template: `
<article id="detail" class="list security">
    <div class="list-head">
        <h1>Security</h1>
        <span :class="summary.state">{{ summary.text }}</span>
        <span class="muted security-checked" :title="checked_title"><span v-if="(looking > 0)" class="spin"/>{{ checked_text }}</span>
        <button type="button" :disabled="(asking || checking)" @click="check_again"><span v-if="(asking || checking)" class="spin"/>{{ ((asking || checking) ? 'Checking…' : 'Check again') }}</button>
    </div>
    <p class="muted">Each machine is looked over once an hour, when it connects and on Check again: what the internet gets to, each port knocked from here; its firewall; whether ssh takes passwords; updates, and whether they install themselves; how long its release is supported. A click on a row says what stands behind each check, and mends it there where the machine's root half can (ssh's passwords, automatic updates), or opens the tab that does.</p>
    <p v-if="(error !== null)" class="alert">{{ error }}</p>
    <data-table :columns="COLUMNS" :rows="rows" row_key="remote" :row_class="row_class" :more="more" empty="No machines yet: a machine is looked at once its agent dials in.">
        <template #cell="{row, column, more}">
            <template v-if="(column.key === 'name')">
                <span class="dt-state" :class="row.state"><span class="dot" :class="dot_of(row.state)"/></span>
                <button type="button" class="link" :title="('The page of ' + row.name)" @click="$emit('remote', row.remote)">{{ row.name }}</button>
                <span v-if="(row.phase !== 'online')" class="muted security-when"> offline</span>
                <span v-else-if="row.checking" class="muted security-when"> <span class="spin"/>looking now</span>
                <span v-if="(more && (row.at !== null))" class="dt-detail">looked at {{ format_ms(Math.max(0, state.now - row.at)) }} ago</span>
            </template>
            <span v-else-if="(row.checks.length === 0)" class="muted"><span v-if="((row.error === null) && row.checking)" class="spin"/>{{ note_of(row) }}</span>
            <template v-else>
                <div v-for="check of checks_in(row, column.key)" :key="check.key" class="dt-state" :class="check.state" :title="((more || (check.detail === null)) ? '' : check.detail)">
                    <span class="dot" :class="dot_of(check.state)"/>{{ check.text }}
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
    components: {'data-table': data_table},
    props: ['state'],
    emits: ['remote', 'tab'],
    data: function () {
        // asked: Check again was pressed and its looks have not shown in the status yet, so the
        // button says Checking from the click on, not a second later
        // mends: the mend a click started on each machine, until a look after it shows; the
        // status says it too, for a page opened meanwhile. mend_errors: why one failed, by
        // machine and check, under that check.
        return {COLUMNS, TAB_NAMES, asking: false, asked: false, error: null, mends: {}, mend_errors: {}};
    },
    computed: {
        security: function () {
            return (this.state.security === undefined) ? null : this.state.security;
        },
        rows: function () {
            return (this.security === null) ? [] : this.security.rows;
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
                return {state: 'ok-text', text: 'Nothing found'};
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
        dot_of: function (state) {
            return DOT_OF[state];
        },
        checks_in: function (row, key) {
            return row.checks.filter(v => v.key === key);
        },
        // A check has more to say when it has a detail
        more: function (row, key) {
            return this.checks_in(row, key).some(v => v.detail !== null);
        },
        // A machine away is shown for its last look, faded
        row_class: function (row) {
            return (row.phase === 'online') ? '' : 'dim';
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
