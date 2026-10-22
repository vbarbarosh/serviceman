import command_copy from '../../command_copy.js';
import data_table from '../../data_table.js';
import format_bytes from '../../format_bytes.js';
import format_ms from '../../format_ms.js';

// Everything running on one machine, as a tree, for a web page. The host gives the API, a GET
// that answers {items, commands, cpu_window_ms}, the colours and its usual classes: list-bar,
// list-find, list-summary, seg, load, meter, muted, bad; its tables are the page's data-table
// and its command button the page's command-copy, imported from the page beside it.

// The list as a tree: every process under the one that started it, and one whose parent is not
// in the list stands as a root of its own. ps prints by pid, so children keep that order.
function proc_rows(items, closed)
{
    const by_pid = {};
    for (const item of items) {
        by_pid[item.pid] = item;
    }
    const kids = {};
    const roots = [];
    for (const item of items) {
        const parent = by_pid[item.ppid];
        if ((parent === undefined) || (parent === item)) {
            roots.push(item);
            continue;
        }
        if (kids[item.ppid] === undefined) {
            kids[item.ppid] = [];
        }
        kids[item.ppid].push(item);
    }
    const out = [];
    for (const item of roots) {
        proc_walk(out, kids, closed, item, 0);
    }
    return out;
}

// One process and what it started, as rows. A folded one keeps its children out of the list
// and says how many it is holding — a folded row that hides its count looks like a leaf.
function proc_walk(rows, kids, closed, item, depth)
{
    const children = (kids[item.pid] === undefined) ? [] : kids[item.pid];
    if (closed[item.pid] === true) {
        rows.push({item, depth, children: children.length, hidden: proc_count(kids, item)});
        return;
    }
    rows.push({item, depth, children: children.length, hidden: 0});
    for (const kid of children) {
        proc_walk(rows, kids, closed, kid, depth + 1);
    }
}

// How many processes are under this one, all the way down
function proc_count(kids, item)
{
    const children = (kids[item.pid] === undefined) ? [] : kids[item.pid];
    let out = children.length;
    for (const kid of children) {
        out += proc_count(kids, kid);
    }
    return out;
}

// The ways the process list is shown: the tree, or the heaviest first
const PROC_VIEWS = [
    {value: 'tree', label: 'Tree'},
    {value: 'cpu', label: 'Top CPU'},
    {value: 'rss', label: 'Top memory'},
];

// The process list's columns: Command and State never fold, the rest where the pane is narrow,
// User first and CPU last
const PROC_COLUMNS = [
    {key: 'command', label: 'Command', clip: true},
    {key: 'pid', label: 'PID', fold: 2},
    {key: 'user', label: 'User', fold: 1},
    {key: 'cpu', label: 'CPU', fold: 6},
    {key: 'memory', label: 'Memory', fold: 5},
    {key: 'rss', label: 'RSS', fold: 4},
    {key: 'running', label: 'Running', fold: 3},
    {key: 'state', label: 'State'},
];
// A command line is as long as somebody made it: its row shows what fits, and one this long
// most likely does not fit, so it reads whole in the opened row too
const COMMAND_LONG = 40;

// Whether a process is what was typed: its command, its user or its pid
function proc_matches(item, query)
{
    return item.command.toLowerCase().includes(query) || String(item.user).toLowerCase().includes(query) || (String(item.pid) === query);
}

// The matches and every process above them, so a match keeps its place in the tree
function proc_with_parents(items, matched)
{
    const by_pid = {};
    for (const item of items) {
        by_pid[item.pid] = item;
    }
    const kept = new Set();
    for (const pid of matched) {
        let at = by_pid[pid];
        while ((at !== undefined) && (kept.has(at.pid) === false)) {
            kept.add(at.pid);
            at = (at.ppid === at.pid) ? undefined : by_pid[at.ppid];
        }
    }
    return items.filter(v => kept.has(v.pid));
}

// How heavy a share is, for the bar under it: amber from half, red from nine tenths
function load_level(share)
{
    if (share >= 0.9) {
        return 'full';
    }
    return (share >= 0.5) ? 'filling' : '';
}

// Everything running on a machine, as the tree it is: a process sits under the one that
// started it, and a branch folds away. ps is run over there when the pane opens and when Read
// again is pressed — a table this long on a clock would be a machine talking about itself all
// day, and a tree that moves under the hand is one nobody can read.
const processes = {
    template: `
<article class="procs-pane">
    <div class="procs-bar">
        <button type="button" :disabled="(busy || offline)" @click="read">Read again</button>
        <command-copy :commands="commands"/>
        <input v-model="query" class="procs-find" type="search" placeholder="Filter by command, user or pid" spellcheck="false" aria-label="Filter processes">
        <span class="seg">
            <button v-for="option of views" :key="option.value" type="button" :class="{on: (view_by === option.value)}" @click="view_by = option.value">{{ option.label }}</button>
        </span>
        <button v-if="(view_by === 'tree' && query === '' && rows.length > 0)" type="button" @click="fold_all">{{ (folded ? 'Unfold all' : 'Fold all') }}</button>
        <span :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
    </div>
    <div v-if="(items.length > 0)" class="procs-summary muted">
        <span>{{ items.length }} {{ plural(items.length, 'process', 'processes') }}</span>
        <span>{{ users }} {{ plural(users, 'user', 'users') }}</span>
        <span :title="cpu_title">CPU {{ cpu_share }}% of {{ cores }} {{ plural(cores, 'core', 'cores') }}<template v-if="(window_ms === null)"> · lifetime averages</template></span>
        <span>RSS {{ format_bytes(rss_total) }}</span>
        <span v-if="(query !== '')">{{ matched_count }} {{ plural(matched_count, 'match', 'matches') }}</span>
    </div>
    <!-- Command and State never fold; the rest fold where the pane is narrow, CPU last. A
         branch opens and closes on its own mark; a click on the row opens what folded. -->
    <data-table v-if="(items.length > 0)" :columns="proc_columns" :rows="rows" :row_key="v => v.item.pid" :empty="('Nothing matches “' + query + '”.')" :more="proc_more" :row_class="v => (v.dim ? 'dim' : [])" :depth="v => v.depth" :branch="((view_by === 'tree') ? branch_of : null)" @branch="branch_toggle">
        <template #cell="{row, column, more}">
            <span v-if="(column.key === 'command')" :title="row.item.command"><code>{{ row.item.command }}</code><span v-if="(row.hidden > 0)" class="muted"> +{{ row.hidden }}</span></span>
            <span v-else-if="(column.key === 'pid')">{{ row.item.pid }}</span>
            <span v-else-if="(column.key === 'user')">{{ row.item.user }}</span>
            <span v-else-if="(column.key === 'cpu')" class="load">
                <span class="meter" :class="load_level(row.item.cpu/100)"><i :style="{width: (Math.max(2, Math.min(100, row.item.cpu)) + '%')}"></i></span>
                {{ row.item.cpu.toFixed(1) }}%
            </span>
            <span v-else-if="(column.key === 'memory')" class="load">
                <span class="meter" :class="load_level(row.item.mem/25)"><i :style="{width: (Math.max(2, Math.min(100, row.item.mem*4)) + '%')}"></i></span>
                {{ row.item.mem.toFixed(1) }}%
            </span>
            <span v-else-if="(column.key === 'rss')">{{ format_bytes(row.item.rss) }}</span>
            <span v-else-if="(column.key === 'running')">{{ format_ms(row.item.elapsed_ms) }}</span>
            <span v-else-if="(column.key === 'state')" class="muted">{{ row.item.state }}</span>
        </template>
    </data-table>
</article>
`,
    components: {'command-copy': command_copy, 'data-table': data_table},
    props: {
        base: {type: String, required: true},
        offline: {type: Boolean, default: false},
        // Changes each time the machine dials back in, so a read that failed while it was
        // away is read again
        connected_at: {type: Number, default: null},
        // How many cores the machine has: the processes' CPU together is a share of them all
        cores: {type: Number, default: 1},
    },
    data: function () {
        // What is folded, by pid. A read that brings the same tree back keeps the folds it had.
        return {items: [], commands: undefined, window_ms: null, closed: {}, note: '', bad: false, busy: false, query: '', view_by: 'tree', views: PROC_VIEWS};
    },
    computed: {
        matched: function () {
            const query = this.query.trim().toLowerCase();
            return (query === '') ? null : new Set(this.items.filter(v => proc_matches(v, query)).map(v => v.pid));
        },
        matched_count: function () {
            return (this.matched === null) ? this.items.length : this.matched.size;
        },
        // A branch folds only in the whole tree: a filtered one shows every match
        foldable: function () {
            return (this.view_by === 'tree') && (this.matched === null);
        },
        rows: function () {
            const matched = this.matched;
            if (this.view_by !== 'tree') {
                const field = this.view_by;
                const items = (matched === null) ? this.items : this.items.filter(v => matched.has(v.pid));
                return items.slice().sort((a, b) => b[field] - a[field]).map(v => ({item: v, depth: 0, children: 0, hidden: 0, dim: false}));
            }
            if (matched === null) {
                return proc_rows(this.items, this.closed);
            }
            return proc_rows(proc_with_parents(this.items, matched), {}).map(v => ({item: v.item, depth: v.depth, children: v.children, hidden: 0, dim: matched.has(v.item.pid) === false}));
        },
        // Whether the button folds or unfolds: with nothing open below the roots, it unfolds
        folded: function () {
            return this.rows.every(v => (v.children === 0) || (this.closed[v.item.pid] === true));
        },
        users: function () {
            return new Set(this.items.map(v => v.user)).size;
        },
        // Each process is a share of one core, as top shows it; together they are a share of
        // all the machine has
        cpu_share: function () {
            return Math.min(100, Math.round(this.items.reduce((sum, item) => sum + item.cpu, 0)/this.cores));
        },
        cpu_title: function () {
            if (this.window_ms === null) {
                return 'This agent is older and reports what ps does: each process\'s average over its whole life.';
            }
            return `What each process used over the ${this.window_ms} ms before the list was read; 100% is one whole core.`;
        },
        rss_total: function () {
            return this.items.reduce((sum, item) => sum + item.rss, 0);
        },
        proc_columns: function () {
            return PROC_COLUMNS;
        },
    },
    watch: {
        // A read that failed while the machine was away, or restarting, is read again once it
        // has dialled back in
        connected_at: function () {
            if (this.bad && (this.offline === false)) {
                this.read();
            }
        },
    },
    methods: {
        format_bytes,
        format_ms,
        load_level,
        plural,
        read: async function () {
            if (this.busy) {
                return;
            }
            this.busy = true;
            this.report('reading…', false);
            try {
                const answer = await fetch(this.base, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.items = outcome.items;
                this.commands = outcome.commands;
                this.window_ms = (outcome.cpu_window_ms === undefined) ? null : outcome.cpu_window_ms;
                this.report(`read ${new Date().toLocaleTimeString()}`, false);
            }
            catch {
                this.report('the answer never came back', true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        // A branch's mark: open or closed where it can fold, none where it cannot
        branch_of: function (row) {
            if ((row.children === 0) || (this.foldable === false)) {
                return null;
            }
            return (this.closed[row.item.pid] === true) ? 'closed' : 'open';
        },
        // A command too long for its row reads whole in the row's details
        proc_more: function (row, key) {
            return (key === 'command') && (row.item.command.length > COMMAND_LONG);
        },
        branch_toggle: function (row) {
            if ((row.children === 0) || (this.foldable === false)) {
                return;
            }
            if (this.closed[row.item.pid] === true) {
                delete this.closed[row.item.pid];
            }
            else {
                this.closed[row.item.pid] = true;
            }
        },
        // Everything at once, both ways: folded, the tree is its roots; unfolded, it is the
        // whole machine again
        fold_all: function () {
            if (this.folded) {
                this.closed = {};
                return;
            }
            const closed = {};
            for (const item of this.items) {
                closed[item.pid] = true;
            }
            this.closed = closed;
        },
    },
    mounted: function () {
        this.read();
    },
};

function plural(count, one, many)
{
    return (count === 1) ? one : many;
}

export default processes;
