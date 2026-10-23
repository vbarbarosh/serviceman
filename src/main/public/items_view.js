import command_copy from './command_copy.js';
import data_table from './data_table.js';
import format_bytes from './format_bytes.js';
import format_count from './format_count.js';
import format_ms from './format_ms.js';
import format_ms_ago from './format_ms_ago.js';
import items_rows from './items_rows.js';
import module_kind from './module_kind.js';

// One kind of a module's items, as its manifest says they are: the list read from the module's
// GET, which answers {items, commands, at}, drawn in the page's data-table. The manifest's kind
// gives the columns and how each is shown (as), the field that names an item (key), what it is
// searched by (search), how it stands as a tree (tree) or in groups (group), and the order it
// starts in (sort; a tree's is the order of its List). The page draws every module's lists the
// same way: a filter, Read again, the commands to copy, a header that sorts, a tree that folds,
// the rest asked for past a screenful.
//
// Props
//     base           the module's GET for the items
//     items          the items, for a module that reads them and changes them itself (a
//                    command's row shown at once, before the machine has done it): then this
//                    reads nothing, and the module has its own Read again
//     module, kind   whose manifest says what they are, and which of its kinds
//     offline        the machine is away: nothing to read
//     connected_at   changes each time the machine dials back in: a read that failed is tried
//                    again
//     filter         (item) => whether it is shown, for what the module narrows on its own
//                    (chips); filter_name names the one now, so the list starts from a
//                    screenful again when it changes
//     item_key       the field that names an item here, when the module's list is wider
//                    than one machine's (a volume is named on its machine)
//     columns_added  columns of the module's own, beside the manifest's: {at, key, label, …},
//                    `at` the place among them (the machine a volume is on)
//     row_class      (item) => classes of its row, such as dim
//     more           (item, key) => whether that cell has more to say in the row's details
//     reading        what is said while the list is read, when it takes a while
//     empty          what is said when there is no item at all
//     none_shown     what is said when the module's filter leaves none
//     head           false for a table with no row of column headers
//     actions_label  the header of the actions' column
//
// Slots
//     tools          {items}: the module's own buttons, after the filter
//     summary        {items, matches, answer}: a line of totals under the tools; matches is
//                    how many the filter typed lets through, null with none typed
//     cell-<key>     {item, row, more}: a cell the module draws itself, in place of its `as`
//     actions        {item, ask}, details {item}, below {item}, group_head {group, rows}: as
//                    data-table's
//
// Emits: answer(outcome), each time the list is read, for what else the module shows of it

// A list this long is read at a glance; a longer one gets a filter
const SEARCH_FROM = 10;
// Rows drawn before the rest are asked for: a machine's packages are a few thousand
const AT_ONCE = 300;

const items_view = {
    template: `
<div class="items-view">
    <div v-if="tools_shown" class="list-tools">
        <input v-if="searched" v-model.trim="query" type="search" :placeholder="search_said" spellcheck="false" :aria-label="search_said">
        <slot name="tools" :items="all"/>
        <span class="list-right">
            <span v-if="(note !== '')" :class="(bad ? 'bad' : 'muted')">{{ note }}</span>
            <span v-if="is_tree" class="seg">
                <button type="button" :class="{on: (sort === null)}" title="Each under the one it belongs to" @click="sort = null">Tree</button>
                <button type="button" :class="{on: (sort !== null)}" title="One list, sorted by a column: click its header" @click="list_show">List</button>
            </span>
            <button v-if="fold_shown" type="button" @click="fold_all">{{ (folded ? 'Unfold all' : 'Fold all') }}</button>
            <template v-if="(items === null)">
                <button type="button" :disabled="(busy || offline || (kind_now === null))" @click="read">Read again</button>
                <command-copy :commands="commands"/>
            </template>
        </span>
    </div>
    <slot name="summary" :items="all" :matches="matches" :answer="answer"/>
    <p v-if="((kind_now !== null) && read_once && (all.length === 0) && (bad === false))" class="muted">{{ empty }}</p>
    <data-table v-if="((kind_now !== null) && (all.length > 0))" :key="list_key" :columns="table_columns" :rows="rows" :row_key="v => v.key" :more="cell_more" :row_class="row_classes" :depth="(is_tree ? (v => v.depth) : null)" :branch="(is_tree ? branch_of : null)" :group="group_of" :limit="AT_ONCE" :sort="sort" :head="head" :actions_label="actions_label" :empty="matches_none" @sort="sort_by" @branch="branch_toggle">
        <template #cell="{row, column, more}">
            <slot :name="('cell-' + column.key)" :item="row.item" :row="row" :more="more">
                <template v-if="none_of(row.item, column)"><span class="muted">{{ column.none }}</span></template>
                <code v-else-if="(column.as === 'code')" :class="{muted: column.muted}">{{ row.item[column.key] }}</code>
                <span v-else-if="(column.as === 'bytes')" :class="{muted: column.muted}">{{ format_bytes(row.item[column.key]) }}</span>
                <span v-else-if="(column.as === 'count')" :class="{muted: column.muted}">{{ format_count(row.item[column.key]) }}</span>
                <span v-else-if="(column.as === 'duration')" :class="{muted: column.muted}">{{ format_ms(row.item[column.key]) }}</span>
                <span v-else-if="(column.as === 'ago')" :class="{muted: column.muted}" :title="new Date(row.item[column.key]).toLocaleString()">{{ format_ms_ago(Date.now() - row.item[column.key]) }}</span>
                <span v-else-if="(column.as === 'percent')" class="load">
                    <span class="meter" :class="level_of(row.item[column.key]/full_of(column), column)"><i :style="{width: (bar_of(row.item[column.key]/full_of(column)) + '%')}"></i></span>
                    {{ row.item[column.key].toFixed(1) }}%
                </span>
                <template v-else-if="(column.as === 'share')">
                    <span class="iv-share">
                        <span class="meter" :class="level_of(share_of(row.item, column), column)"><i :style="{width: (bar_of(share_of(row.item, column)) + '%')}"></i></span>
                        <span>{{ Math.round(share_of(row.item, column)*100) }}%</span>
                    </span>
                    <div class="muted">{{ unit_text(row.item[column.key], column) }} of {{ unit_text(row.item[column.of], column) }}</div>
                </template>
                <span v-else-if="(column.as === 'flag')" :class="{muted: (row.item[column.key] !== true)}">{{ ((row.item[column.key] === true) ? column.yes : column.no) }}</span>
                <span v-else :class="{muted: column.muted}">{{ row.item[column.key] }}</span>
            </slot>
            <span v-if="((column === table_columns[0]) && (row.hidden > 0))" class="muted"> +{{ row.hidden }}</span>
        </template>
        <template v-if="($slots.actions !== undefined)" #actions="{row, ask}"><slot name="actions" :item="row.item" :ask="ask"/></template>
        <template v-if="($slots.details !== undefined)" #details="{row}"><slot name="details" :item="row.item"/></template>
        <template v-if="($slots.below !== undefined)" #below="{row}"><slot name="below" :item="row.item"/></template>
        <template #group_head="{group, rows}"><slot name="group_head" :group="group" :rows="rows">{{ group }}</slot></template>
    </data-table>
</div>
`,
    components: {'command-copy': command_copy, 'data-table': data_table},
    props: {
        base: {type: String, default: ''},
        items: {type: Array, default: null},
        module: {type: String, required: true},
        kind: {type: String, default: ''},
        offline: {type: Boolean, default: false},
        connected_at: {type: Number, default: null},
        filter: {type: Function, default: null},
        filter_name: {type: String, default: ''},
        item_key: {type: String, default: null},
        columns_added: {type: Array, default: () => []},
        row_class: {type: Function, default: null},
        more: {type: Function, default: null},
        reading: {type: String, default: 'reading…'},
        empty: {type: String, default: 'Nothing here.'},
        none_shown: {type: String, default: 'Nothing here matches.'},
        head: {type: Boolean, default: true},
        actions_label: {type: String, default: ''},
    },
    emits: ['answer'],
    data: function () {
        // `closed` is the branches folded, by key: a read that brings the same tree back keeps
        // them. `sort` is {key, down}, or null for the tree, or for the order the list came in.
        return {AT_ONCE, kind_now: null, read_items: [], answer: null, commands: undefined, read_once: false, note: '', bad: false, busy: false, query: '', sort: null, closed: {}};
    },
    computed: {
        all: function () {
            return (this.items === null) ? this.read_items : this.items;
        },
        // The tools of a list it reads, or of one given that has something to offer: a filter,
        // the module's own buttons, the tree's
        tools_shown: function () {
            return (this.items === null) || this.searched || this.is_tree || (this.$slots.tools !== undefined) || (this.note !== '');
        },
        // The kind as this list stands: keyed as the module says, with the module's own columns
        kind_here: function () {
            const columns = this.kind_now.columns.slice();
            for (const added of this.columns_added) {
                columns.splice(added.at, 0, added);
            }
            return Object.assign({}, this.kind_now, {columns}, (this.item_key === null) ? {} : {key: this.item_key});
        },
        // A cell with nothing to say is left out of the row's details, unless its column says
        // what nothing is
        table_columns: function () {
            const view = this;
            return this.kind_here.columns.map(function (column) {
                const as = module_kind.AS.includes(column.as) ? column.as : 'text';
                return Object.assign({}, column, {as, hide: v => (view.none_of(v.item, column) && (column.none === undefined))});
            });
        },
        is_tree: function () {
            return (this.kind_now !== null) && (this.kind_now.tree !== undefined);
        },
        // A filter where there is something to filter: a list longer than a glance
        searched: function () {
            return (this.kind_now !== null) && Array.isArray(this.kind_now.search) && ((this.all.length > SEARCH_FROM) || (this.query !== ''));
        },
        matches: function () {
            return (this.query === '') ? null : this.rows.filter(v => (v.dim === false)).length;
        },
        // "Filter by command, user or pid": the search fields by their columns' names
        search_said: function () {
            const names = this.kind_now.search.map(v => this.kind_now.columns.find(vv => (vv.key === v))).filter(v => (v !== undefined)).map(v => v.label.toLowerCase());
            if (names.length < 2) {
                return 'Filter';
            }
            return `Filter by ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
        },
        shown: function () {
            return (this.filter === null) ? this.all : this.all.filter(this.filter);
        },
        rows: function () {
            if (this.kind_now === null) {
                return [];
            }
            const rows = items_rows(this.shown, this.kind_here, {query: this.query, sort: this.sort, closed: this.closed});
            const group = this.kind_now.group;
            if (group === undefined) {
                return rows;
            }
            // The rows of one group next to each other, in the order the groups first come
            const groups = new Map();
            for (const row of rows) {
                if (groups.has(row.item[group]) === false) {
                    groups.set(row.item[group], []);
                }
                groups.get(row.item[group]).push(row);
            }
            return Array.from(groups.values()).flat();
        },
        group_of: function () {
            const group = (this.kind_now === null) ? undefined : this.kind_now.group;
            if (group === undefined) {
                return null;
            }
            return function (row) {
                return row.item[group];
            };
        },
        // A branch folds only in the whole tree: a filtered one shows every match
        foldable: function () {
            return this.is_tree && (this.sort === null) && (this.query === '');
        },
        fold_shown: function () {
            return this.foldable && this.rows.some(v => (v.children > 0));
        },
        // Whether the button folds or unfolds: with nothing open below the roots, it unfolds
        folded: function () {
            return this.rows.every(v => (v.children === 0) || (this.closed[v.key] === true));
        },
        // A screenful first, the rest when asked: a new filter or order starts from a screenful
        list_key: function () {
            return JSON.stringify([this.query, this.sort, this.filter_name]);
        },
        matches_none: function () {
            return (this.query === '') ? this.none_shown : `Nothing matches “${this.query}”.`;
        },
    },
    watch: {
        connected_at: function () {
            if (this.bad && (this.offline === false)) {
                this.read();
            }
        },
    },
    methods: {
        format_bytes,
        format_count,
        format_ms,
        format_ms_ago,
        read: async function () {
            if (this.busy) {
                return;
            }
            this.busy = true;
            this.report(this.reading, false);
            try {
                if (this.kind_now === null) {
                    const kind = await module_kind(this.module, this.kind);
                    this.sort = ((kind.tree !== undefined) || (kind.sort === undefined)) ? null : kind.sort;
                    this.kind_now = kind;
                }
                if (this.items !== null) {
                    this.read_once = true;
                    this.report('', false);
                    return;
                }
                const answer = await fetch(this.base, {cache: 'no-store'});
                const outcome = await answer.json();
                if (answer.ok === false) {
                    this.report(outcome.error, true);
                    return;
                }
                this.read_items = Array.isArray(outcome) ? outcome : outcome.items;
                this.answer = outcome;
                this.commands = outcome.commands;
                this.read_once = true;
                this.$emit('answer', outcome);
                this.report(`read ${new Date().toLocaleTimeString()}`, false);
            }
            catch (error) {
                this.report((error instanceof TypeError) ? 'the answer never came back' : error.message, true);
            }
            finally {
                this.busy = false;
            }
        },
        report: function (note, bad) {
            this.note = note;
            this.bad = bad;
        },
        // Whether a cell has nothing to say: no value, an empty one, or no whole to be a share of
        none_of: function (item, column) {
            return is_none(item[column.key]) || ((column.of !== undefined) && is_none(item[column.of]));
        },
        full_of: function (column) {
            return (column.full === undefined) ? 100 : column.full;
        },
        share_of: function (item, column) {
            return (item[column.of] > 0) ? item[column.key]/item[column.of] : 0;
        },
        // A bar is never so thin it reads as nothing, nor past its end
        bar_of: function (share) {
            return Math.max(2, Math.min(100, share*100));
        },
        // How full a bar is: amber from the first of its levels, red from the second
        level_of: function (share, column) {
            const levels = Array.isArray(column.levels) ? column.levels : [0.5, 0.9];
            if (share >= levels[1]) {
                return 'full';
            }
            return (share >= levels[0]) ? 'filling' : '';
        },
        unit_text: function (value, column) {
            return (column.unit === 'count') ? format_count(value) : format_bytes(value);
        },
        // A cell cut to its row reads whole in the row's details, when it is long enough to
        // have been cut
        cell_more: function (row, key) {
            if ((this.more !== null) && this.more(row.item, key)) {
                return true;
            }
            const column = this.table_columns.find(v => (v.key === key));
            return (column.clip === true) && (String(row.item[key]).length > 40);
        },
        row_classes: function (row) {
            const classes = (this.row_class === null) ? [] : [].concat(this.row_class(row.item) || []);
            return row.dim ? classes.concat(['dim']) : classes;
        },
        // A header sorts by its column; again, the other way. Figures start from the biggest.
        sort_by: function (key) {
            if ((this.sort !== null) && (this.sort.key === key)) {
                this.sort = {key, down: (this.sort.down === false)};
                return;
            }
            const first = this.all.find(v => (v[key] !== null) && (v[key] !== undefined));
            this.sort = {key, down: ((first !== undefined) && (typeof first[key] === 'number'))};
        },
        // The list beside the tree, in the kind's order: the heaviest first, for processes
        list_show: function () {
            if (this.sort !== null) {
                return;
            }
            const column = this.kind_now.columns.find(v => (v.sort === true));
            if (this.kind_now.sort !== undefined) {
                this.sort = this.kind_now.sort;
            }
            else if (column !== undefined) {
                this.sort_by(column.key);
            }
        },
        // A branch's mark: open or closed where it can fold, none where it cannot
        branch_of: function (row) {
            if ((row.children === 0) || (this.foldable === false)) {
                return null;
            }
            return (this.closed[row.key] === true) ? 'closed' : 'open';
        },
        branch_toggle: function (row) {
            if ((row.children === 0) || (this.foldable === false)) {
                return;
            }
            if (this.closed[row.key] === true) {
                delete this.closed[row.key];
            }
            else {
                this.closed[row.key] = true;
            }
        },
        // Everything at once, both ways: folded, the tree is its roots; unfolded, all of it
        fold_all: function () {
            if (this.folded) {
                this.closed = {};
                return;
            }
            const closed = {};
            for (const row of items_rows(this.shown, this.kind_here, {query: '', sort: null, closed: {}})) {
                closed[row.key] = true;
            }
            this.closed = closed;
        },
    },
    mounted: function () {
        this.read();
    },
};

function is_none(value)
{
    return (value === null) || (value === undefined) || (value === '') || (Array.isArray(value) && (value.length === 0));
}

export default items_view;
