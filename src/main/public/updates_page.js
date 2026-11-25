import agent_current from './agent_current.js';
import answered_again from './answered_again.js';
import clock_of from './clock_of.js';
import data_table from './data_table.js';
import machine_icons from './machine_icons.js';
import name_cell from './name_cell.js';
import page_head from './page_head.js';
import restart_window from './restart_window.js';
import state_pill from './state_pill.js';
import updates_lists from './updates_lists.js';

// The Packages tab's cube
const UPDATES_ICON = '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4.5 7.5l8 4.5 8-4.5M12 12v9"/>';

// Updates, a page of its own under Remotes (/remotes/updates): what apt has waiting on every
// machine, a row each, the ones ticked installed at once by Install on N, each machine its own
// apt; then, on the same page, a row per machine of the run while it goes. The runs belong to
// serviceman, not to this page: left and opened again, it finds them where they are. The machine
// serviceman runs on goes last, alone. Away (restarting, most often), serviceman is waited for:
// the page says so, and what a press it never answered came to is said once it is back.
const updates_page = {
    template: `
<article id="detail" class="list updates-page">
    <page-head category="remotes" title="Updates" :icon="UPDATES_ICON" :count="((mode === 'pick') ? waiting_count : null)">
        <template #says>
            <template v-if="(mode === 'pick')">What apt has waiting on each machine; nothing installs by itself. <code>apt-get update</code>, <code>apt-get full-upgrade</code>, then <code>snap refresh</code> where it has snap, on every machine ticked, at once, keeping the config files you changed.</template>
            <template v-else-if="ended">Installed on {{ batch.remotes.length }} {{ ((batch.remotes.length === 1) ? 'machine' : 'machines') }}, each its own apt: each row says how it ended.</template>
            <template v-else>Installing on {{ batch.remotes.length }} {{ ((batch.remotes.length === 1) ? 'machine' : 'machines') }}, each its own apt. The runs are serviceman's: leave the page and they go on.</template>
        </template>
        <template #acts>
            <button v-if="(mode === 'pick')" type="button" class="primary" :disabled="((ticked.length === 0) || sending || (answering === false))" @click="start"><span v-if="sending" class="spin"/><svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="UPDATES_ICON"/>{{ (looking ? 'looking…' : (sending ? 'starting…' : ('Install on ' + ticked.length))) }}</button>
            <button v-else-if="(ended === false)" type="button" :disabled="cancelling" @click="cancel"><span v-if="cancelling" class="spin"/>{{ (cancelling ? 'stopping…' : 'Cancel all') }}</button>
            <button v-else type="button" @click="back">Back to the list</button>
        </template>
    </page-head>
    <p v-if="looking" class="muted"><span class="spin"/>No answer from serviceman: looking whether the install began…</p>
    <p v-else-if="((mode === 'pick') && (answering === false))" class="muted">serviceman is not answering: Install waits until it is back.</p>
    <p v-if="forgotten" class="muted">serviceman restarted during the install (an upgrade of Docker on its own machine restarts it), and keeps no install over a restart: each row is as it was last seen, and the machine's Configure tab says what it has now.</p>
    <p v-if="(error !== null)" class="alert">{{ error }}</p>
    <data-table v-if="(mode === 'pick')" class="updates-table" :columns="PICK_COLUMNS" :rows="rows_shown" row_key="name" :selected="(picked || [])" :tickable="(row => row.able)" :tick_all="false" :row_class="(row => (row.able ? [] : ['off']))" :marks="false" framed :total="rows.length" :foot="foot" :empty_icon="UPDATES_ICON" empty_title="No machines yet" empty="A machine joins when its agent dials in; what apt has waiting on it shows up here." @selected="picked = $event">
        <template #tools>
            <input v-model.trim="filter" type="search" placeholder="Find a machine" aria-label="Find a machine by its name or title" spellcheck="false">
            <span class="dt-chips">
                <button v-for="chip of chips" :key="chip.value" type="button" class="chip" :class="{on: (chip.value === show)}" @click="show = chip.value">
                    <span v-if="(chip.phase !== null)" class="dot" :class="chip.phase"/>
                    {{ chip.label }}
                    <span class="muted">{{ chip.count }}</span>
                </button>
            </span>
        </template>
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="row.icon" :name="row.name" :line="row.line" :tone="row.tone"/>
            <state-pill v-else-if="(column.key === 'waiting')" :tone="row.pill_tone" :text="row.pill"/>
            <span v-else-if="(column.key === 'system')" class="muted">{{ row.system }}</span>
            <span v-else-if="((column.key === 'held') && (row.held !== null))" class="muted">{{ row.held }}<span class="dt-ph-label"> held back</span></span>
            <span v-else-if="(column.key === 'lists')" :class="(row.lists_old ? 'updates-old' : 'muted')">{{ row.lists }}</span>
            <template v-else-if="(column.key === 'act')">
                <button v-if="(row.act === 'restart')" type="button" class="link" @click.stop="restart_of = row.name">Restart {{ row.name }}…</button>
                <button v-else-if="(row.act === 'fetch')" type="button" class="link" title="Its Configure tab fetches the lists and installs" @click.stop="$emit('configure', row.name)">Fetch and install</button>
            </template>
        </template>
    </data-table>
    <data-table v-else class="updates-run" :columns="RUN_COLUMNS" :rows="run_rows" row_key="name" :on_row="(row => $emit('configure', row.name))" :marks="false" framed :total="run_rows.length" :foot="run_foot">
        <template #cell="{row, column}">
            <name-cell v-if="(column.key === 'name')" :icon="row.icon" :name="row.name" :line="row.line" :tone="row.tone"/>
            <span v-else-if="(column.key === 'status')" class="updates-pills"><state-pill :tone="row.pill_tone" :text="row.pill"/><state-pill v-if="row.reboot" tone="busy" text="wants a restart"/></span>
            <span v-else-if="(column.key === 'said')" class="updates-said">
                <span v-if="(row.phase === 'waiting')" class="muted">Starts once the others end: serviceman runs on this machine, and an upgrade of Docker restarts it.</span>
                <span v-else-if="((row.error !== null) && (row.phase !== 'cancelled'))" class="bad">{{ row.error }}</span>
                <code v-else-if="(row.last_line !== null)" class="updates-line" :title="row.last_line">{{ row.last_line }}</code>
                <span v-if="(row.phase === 'cancelled')" class="muted">Stopped where it stood: <code>sudo dpkg --configure -a</code> on that machine finishes a package left half set up.</span>
                <span v-if="((row.containers !== null) && (row.containers.down.length > 0))" class="bad">Cannot start again: {{ row.containers.down.join(', ') }}</span>
                <span v-if="((row.containers !== null) && (row.containers.started.length > 0))" class="muted">Started again: {{ row.containers.started.join(', ') }}</span>
            </span>
            <button v-else-if="((column.key === 'act') && row.reboot)" type="button" class="link" @click.stop="restart_of = row.name">Restart {{ row.name }}…</button>
        </template>
    </data-table>
    <p v-for="item of skipped" :key="item.name" class="muted">Left out: {{ item.reason }}.</p>
    <restart-window v-if="(restart_of !== null)" :remote="restart_of" :title="restart_of" why="an installed update wants the machine restarted" :now="Date.now()" @close="restart_of = null"/>
</article>
`,
    components: {'data-table': data_table, 'name-cell': name_cell, 'page-head': page_head, 'restart-window': restart_window, 'state-pill': state_pill},
    props: {
        state: {type: Object, required: true},
        // Whether serviceman answered the page's last look; while it does not, the rows are as
        // they were then, and Install waits
        answering: {type: Boolean, default: true},
    },
    emits: ['configure'],
    data: function () {
        // mode: pick, the machines to install on; run, the install as serviceman has it.
        // picked: the names ticked, null until the first rows come, which tick every one with
        // something to install. restart_of: the machine whose restart window is open.
        return {mode: 'pick', filter: '', show: 'all', picked: null, batch: null, known: false, skipped: [], error: null, sending: false, looking: false, cancelling: false, forgotten: false, closed: false, timer: null, restart_of: null, UPDATES_ICON, PICK_COLUMNS, RUN_COLUMNS};
    },
    computed: {
        // How the Canvas draws each machine, by its name
        kind_by_name: function () {
            const machines = ((this.state.canvas === undefined) || (this.state.canvas === null)) ? [] : this.state.canvas.machines;
            return Object.fromEntries(machines.map(v => [v.name, v.kind]));
        },
        rows: function () {
            return this.state.remotes.map(v => updates_row(v, this.state.agent_built, this.kind_by_name[v.name], Date.now()));
        },
        // Narrowed by Find a machine and the chip picked
        rows_shown: function () {
            const filter = this.filter.toLowerCase();
            return this.rows.filter(v => ((filter === '') || v.name.toLowerCase().includes(filter) || v.title.toLowerCase().includes(filter)) && ((this.show === 'all') || (v.group === this.show)));
        },
        chips: function () {
            const count = {install: 0, current: 0, needs: 0, offline: 0};
            for (const row of this.rows) {
                count[row.group] += 1;
            }
            return [
                {value: 'all', label: 'All', phase: null, count: this.rows.length},
                {value: 'install', label: 'To install', phase: 'acc', count: count.install},
                {value: 'current', label: 'Up to date', phase: 'running', count: count.current},
                {value: 'needs', label: 'Needs you', phase: 'stopping', count: count.needs},
                {value: 'offline', label: 'Offline', phase: 'failed', count: count.offline},
            ];
        },
        // How many machines have something to install, the count beside the page's name
        waiting_count: function () {
            return this.rows.filter(v => v.pending > 0).length;
        },
        ticked: function () {
            const picked = (this.picked === null) ? [] : this.picked;
            return this.rows.filter(v => v.able && picked.includes(v.name));
        },
        foot: function () {
            const packages = this.ticked.reduce((sum, v) => sum + v.pending, 0);
            const security = this.ticked.reduce((sum, v) => sum + v.security, 0);
            const out = [{text: `${this.rows.length} ${(this.rows.length === 1) ? 'machine' : 'machines'}`, tone: ''}];
            const of_them = (security > 0) ? `, ${security} of them security` : '';
            out.push({text: `${this.ticked.length} ticked: ${packages} ${(packages === 1) ? 'package' : 'packages'}${of_them}`, tone: ''});
            // Said only while it is ticked: a machine left out goes nowhere
            const own = this.ticked.find(v => v.own);
            if (own !== undefined) {
                out.push({text: `${own.name} goes last, alone: serviceman runs on it`, tone: ''});
            }
            return out;
        },
        ended: function () {
            return (this.batch !== null) && ((this.batch.ended_at !== null) || this.forgotten);
        },
        // The run's machines, as its rows draw them
        run_rows: function () {
            const views = Object.fromEntries(this.state.remotes.map(v => [v.name, v]));
            return (this.batch === null) ? [] : this.batch.remotes.map(v => run_row(v, views[v.name], this.kind_by_name[v.name]));
        },
        run_foot: function () {
            const count = {};
            for (const row of this.run_rows) {
                count[row.phase] = (count[row.phase] || 0) + 1;
            }
            const said = ['running', 'ok', 'waiting', 'error', 'cancelled', 'lost'].filter(v => count[v] > 0).map(v => ({text: `${count[v]} ${PHASE_WORDS[v]}`, tone: (v === 'error') ? 'bad' : ''}));
            return [{text: `${this.ended ? 'Installed on' : 'Installing on'} ${this.run_rows.length}`, tone: ''}].concat(said, [{text: 'a row opens its machine\'s Configure tab, with every line', tone: ''}]);
        },
    },
    watch: {
        // Every machine with something to install is ticked, once its rows first come
        rows: {
            immediate: true,
            handler: function (rows) {
                if ((this.picked === null) && (rows.length > 0)) {
                    this.picked = rows.filter(v => v.able).map(v => v.name);
                }
            },
        },
    },
    methods: {
        read: async function () {
            clearTimeout(this.timer);
            try {
                this.batch_take((await apt_all_read()).batch);
            }
            catch {
                // The next read says it; the page polls the rest the same way
            }
            if (this.closed) {
                return;
            }
            if ((this.batch !== null) && (this.ended === false)) {
                this.mode = 'run';
                this.timer = setTimeout(() => this.read(), 1000);
            }
        },
        // serviceman keeps no install over a restart: one followed here that its answer no longer
        // has went with a restart, as when Docker is upgraded on serviceman's own machine. Its
        // rows stay as last seen; a machine that had not ended is said as not followed.
        batch_take: function (batch) {
            this.known = true;
            if ((batch === null) && (this.batch !== null) && (this.batch.ended_at === null)) {
                this.forgotten = true;
                this.batch = Object.assign({}, this.batch, {remotes: this.batch.remotes.map(v => run_ended(v) ? v : Object.assign({}, v, {phase: 'lost'}))});
                return;
            }
            this.forgotten = false;
            this.batch = batch;
        },
        start: async function () {
            this.sending = true;
            this.error = null;
            // The install known before the press: one begun since is the press's own
            const before = this.known ? this.batch : undefined;
            try {
                const answer = await fetch('/api/v1/apt-upgrade', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({remotes: this.ticked.map(v => v.name)})});
                const outcome = await answer.json();
                this.skipped = (outcome.skipped === undefined) ? [] : outcome.skipped;
                if (answer.ok === false) {
                    const why = this.skipped.map(v => v.reason).join('; ');
                    this.error = (why === '') ? outcome.error : `${outcome.error}: ${why}`;
                    return;
                }
                await this.read();
            }
            catch (error) {
                if (error instanceof TypeError) {
                    await this.lost(before);
                    return;
                }
                this.error = 'serviceman failed to answer Install: its log says why';
            }
            finally {
                this.sending = false;
            }
        },
        // Install got no answer: serviceman was away when it was pressed, or went away under it.
        // Whether the install began is known once serviceman answers again.
        lost: async function (before) {
            this.looking = true;
            const said = await answered_again(apt_all_read, () => this.closed);
            this.looking = false;
            if (this.closed) {
                return;
            }
            if (said === null) {
                this.error = 'serviceman has not answered for three minutes, so whether the install began is not known: open Updates again once it is back.';
                return;
            }
            if (apt_all_begun(said.batch, before)) {
                this.batch_take(said.batch);
                this.mode = 'run';
                await this.read();
                return;
            }
            this.batch_take(said.batch);
            this.error = 'Not started: serviceman was away when Install was pressed, a restart most often. It is back now: Install again.';
        },
        cancel: async function () {
            this.cancelling = true;
            try {
                await fetch('/api/v1/apt-cancel', {method: 'POST'});
                await this.read();
            }
            catch {
                // The rows go on being read: once serviceman is back, each says where it stands
                this.error = 'Cancel got no answer from serviceman: a row still installing is one it did not stop.';
            }
            finally {
                this.cancelling = false;
            }
        },
        // The run over, the page as it opens: every machine with something to install ticked
        back: function () {
            this.mode = 'pick';
            this.error = null;
            this.skipped = [];
            this.forgotten = false;
            this.picked = this.rows.filter(v => v.able).map(v => v.name);
        },
    },
    created: function () {
        // A run going on is shown at once; one already over is not
        this.read();
    },
    unmounted: function () {
        this.closed = true;
        clearTimeout(this.timer);
    },
};

// Name never folds, nor what waits; System first, the lists' age last. On a phone a machine is a
// card: what waits top right, system · held back · lists fetched on a line, its action under it
const PICK_COLUMNS = [
    {key: 'name', label: 'Name', wraps: true},
    {key: 'waiting', label: 'Waiting', phone: 'state'},
    {key: 'system', label: 'System', fold: 3},
    {key: 'held', label: 'Held back', fold: 1, align: 'right', hide: v => (v.held === null)},
    {key: 'lists', label: 'Lists fetched', fold: 2},
    {key: 'act', label: '', phone: 'row', hide: v => (v.act === null)},
];

const RUN_COLUMNS = [
    {key: 'name', label: 'Name', wraps: true},
    {key: 'status', label: 'Status', phone: 'state'},
    {key: 'said', label: 'Apt says', clip: true, phone: 'row'},
    {key: 'act', label: '', phone: 'row', hide: v => (v.reboot === false)},
];

const PHASE_WORDS = {waiting: 'waiting', running: 'installing', ok: 'done', error: 'failed', cancelled: 'cancelled', idle: 'not started', lost: 'not followed'};

// One machine as the list draws it: what waits on it, whether Install can take it, and what
// helps where it cannot
//
//     remote   a remote of the status
//     built    the agent this host serves, to tell one behind it
//     kind     how the Canvas draws it, for its icon
//     ->       {name, title, icon, line, tone, pill, pill_tone, group, able, own, pending,
//               security, held, system, lists, lists_old, act}
function updates_row(remote, built, kind, now)
{
    const machine = ((remote.machine === undefined) || (remote.machine === null)) ? null : remote.machine;
    const updates = ((machine === null) || (machine.updates === undefined)) ? null : machine.updates;
    const lists = updates_lists(updates, now);
    const title = ((remote.title === null) || (remote.title === undefined) || (remote.title === remote.name)) ? '' : remote.title;
    const own = (remote.serviceman_here === true);
    const row = {
        name: remote.name,
        title,
        icon: machine_icons[kind] || machine_icons.server,
        line: own ? [title, 'goes last, alone'].filter(v => v !== '').join(' · ') : title,
        tone: '',
        pill: '',
        pill_tone: 'idle',
        group: '',
        able: false,
        own,
        pending: 0,
        security: 0,
        // Held back by apt, waiting on a phasing: a number, or none for nothing held
        held: ((updates === null) || (typeof updates.held !== 'number') || (updates.held === 0)) ? null : updates.held,
        system: (machine === null) ? '' : (machine.os || machine.platform || ''),
        lists: (lists === null) ? '—' : lists.ago,
        lists_old: (lists !== null) && lists.old,
        act: null,
    };
    if (remote.phase !== 'online') {
        const since = ((remote.left_at === null) || (remote.left_at === undefined)) ? 'not linked since serviceman started' : `not linked since ${clock_of(remote.left_at)}`;
        return Object.assign(row, {line: since, tone: 'bad', pill: 'offline', pill_tone: 'bad', group: 'offline', held: null, lists: '—', lists_old: false});
    }
    // An agent behind the one served says so in place of its title, and still goes last
    if (agent_current(remote, built) === false) {
        const behind = `agent ${remote.agent_version || 'of an older build'}; a newer one waits`;
        Object.assign(row, {line: own ? `${behind} · goes last, alone` : behind, tone: 'warn'});
    }
    if ((machine === null) || (machine.can === null) || (machine.can === undefined) || (machine.can.includes('apt') === false)) {
        return Object.assign(row, {line: 'its agent is from before updates', tone: 'warn', pill: 'not said', group: 'needs'});
    }
    if ((updates === null) || (updates.pending === null)) {
        if ((updates !== null) && updates.reboot) {
            return Object.assign(row, {pill: 'wants a restart', pill_tone: 'busy', group: 'needs', act: 'restart'});
        }
        return Object.assign(row, {pill: 'not said', group: 'needs'});
    }
    const act = updates.reboot ? 'restart' : null;
    if (updates.pending > 0) {
        const security = (updates.security > 0) ? updates.security : 0;
        const text = (security > 0) ? `${updates.pending} to install · ${security} security` : `${updates.pending} to install`;
        return Object.assign(row, {pill: text, pill_tone: (security > 0) ? 'bad' : 'acc', group: 'install', able: true, pending: updates.pending, security, act});
    }
    if (updates.reboot) {
        return Object.assign(row, {pill: 'wants a restart', pill_tone: 'busy', group: 'needs', act});
    }
    // Lists days old count nothing since: the machine's Configure tab fetches them
    if ((lists !== null) && lists.old) {
        return Object.assign(row, {pill: `lists ${lists.days} days old`, pill_tone: 'busy', group: 'needs', act: 'fetch'});
    }
    return Object.assign(row, {pill: 'up to date', pill_tone: 'run', group: 'current'});
}

// One machine of a run as its row draws it
//
//     run      a machine of the batch: {name, title, phase, error, last_line, containers, reboot}
//     remote   its remote in the status, or undefined for one removed since
//     kind     how the Canvas draws it, for its icon
function run_row(run, remote, kind)
{
    const title = ((remote === undefined) || (remote.title === null) || (remote.title === undefined) || (remote.title === remote.name)) ? '' : remote.title;
    return Object.assign({}, run, {
        icon: machine_icons[kind] || machine_icons.server,
        line: title,
        tone: '',
        pill: PHASE_WORDS[run.phase] || run.phase,
        pill_tone: {ok: 'run', error: 'bad', running: 'acc', cancelled: 'busy', lost: 'busy'}[run.phase] || 'idle',
        reboot: run_ended(run) && (run.reboot === true),
    });
}

function run_ended(run)
{
    return ['ok', 'error', 'cancelled'].includes(run.phase);
}

// The install of several machines as serviceman has it now, {batch}; throws while it is away
async function apt_all_read()
{
    const answer = await fetch('/api/v1/apt-upgrade', {cache: 'no-store'});
    if (answer.ok === false) {
        throw new Error(`serviceman answered ${answer.status}`);
    }
    return answer.json();
}

// Whether a press of Install began `batch`: one other than the install known before it. Where
// none was known (the page opened while serviceman was away), only one still going is taken
// for it; one already over is an earlier one.
function apt_all_begun(batch, before)
{
    if (batch === null) {
        return false;
    }
    if (before === undefined) {
        return (batch.ended_at === null);
    }
    return (before === null) || (batch.started_at !== before.started_at);
}

export default updates_page;
export {updates_row};
