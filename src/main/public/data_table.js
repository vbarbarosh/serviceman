import fold_table from './fold_table.js';

import {Comment} from 'vue';

// The one table of every page: the same look and the same behaviour wherever a list of things
// is shown. Columns that do not fit fold away, the least needed first (fold_table). A click on a
// row that has more to show, anywhere but its links, buttons and boxes, shows it whole in a bar
// at the foot of the view: every column, what folded and what has more to say, so the rows stay
// where they were clicked; a click on it again, or Close, puts the bar away. No mark down the
// left edge, no details opening under a row. Actions sit last, one style for all, and fold into
// the bar on a narrow screen.
//
// Props
//     columns    [{key, label, fold, wraps, clip, align, sort, hide, spread}]: fold a number, the
//                lowest folds first, or absent for a column that never folds; wraps for a name
//                that may wrap; clip for one line cut with … (the whole text opens under the
//                row); align 'right' for figures; sort for a header that sorts on a click;
//                hide(row) for a cell with nothing to say, left out of the details when its
//                column folds; spread(row) for the keys of the columns after it that the cell
//                takes over in that row, the ones of them shown (fold_table): a note written
//                across a row's empty cells, those cells left out and never in its details;
//                'actions' among them takes the actions' cell too
//                A row_class of dim fades the row: a row shown for its place, not for itself
//     rows       the things, one a row, already in their order (and by group, when grouped)
//     row_key    the field that names a row, or a function of the row
//     empty      the line shown in the table's place when there is no row (or slot empty)
//     more       (row, key) => whether that cell has more to say in the details
//     opens      (row) => whether the row has details of its own (slot details), in its bar
//     acts       (row) => whether the row has actions, for a table where some rows have none:
//                one whose actions folded away then has nothing to open
//     row_class  (row) => classes of the row, such as off
//     chosen     (row) => whether the row is the one picked, drawn highlighted
//     group      (row) => the group the row is in: a row of its own (slot group_head) begins
//                each, the rows of one group next to each other
//     head       false for a table with no row of column headers (the columns still measured)
//     depth      (row) => how deep the row is in a tree, its first cell indented as much
//     branch     (row) => open | closed | null: a branch's mark in its first cell, emitting
//                branch(row) on its click; the page opens and closes it
//     limit      how many rows are shown before a button shows the other ones
//     on_row     (row, event) => a click on the row is the page's too (a folder opened, a file
//                ticked); the row is still shown whole when it has more to show
//     marks      false for a table whose page shows a row whole its own way, picked by on_row:
//                the table draws no bar
//     actions_label, actions_fold   the actions column's header, and when it folds (0: first)
//     sort       {key, down}: the column sorted by, emitting sort(key) on a header's click
//     selected   the keys of the rows ticked, a box on each row, emitting selected(keys)
//
// Slots
//     cell        {row, column, more}: a cell, more true when drawn in the details; an icon
//                 goes first in it as an element with class dt-icon
//     details     {row}: more lines of the row's bar, as dt and dd
//     actions     {row, ask}: the row's actions, buttons; ask(question, yes, action) puts a
//                 question in their place, "Remove it?" with yes and Cancel, the same everywhere
//     below       {row}: rows of the page's own under the row, full width, drawn when it renders
//                 anything (a log, a form, a message)
//     group_head  {group, rows}: the row that begins a group
//     empty       the line shown when there is no row
//
// Emits: sort(key), selected(keys), branch(row)
const data_table = {
    template: `
<div class="data-table-room">
    <p v-if="(rows.length === 0)" class="muted data-table-empty"><slot name="empty">{{ empty }}</slot></p>
    <fold-table v-else v-slot="fold" :order="fold_order" @folded="v => (folded = v)">
        <table class="data-table" :class="{'dt-bare': (head === false)}">
            <thead>
                <tr>
                    <th v-if="(selected !== undefined)" class="dt-tick"><input type="checkbox" aria-label="Tick every row" :checked="all_ticked" @change="tick_all($event.target.checked)"></th>
                    <th v-for="column of columns" :key="column.key" :data-fold="fold_name(column)" :class="{wraps: (column.wraps === true), 'dt-right': (column.align === 'right')}">
                        <button v-if="(column.sort === true)" type="button" class="dt-sort" :class="{on: sorted_by(column)}" @click="$emit('sort', column.key)">{{ column.label }}<span v-if="sorted_by(column)">{{ (sort.down ? ' ↓' : ' ↑') }}</span></button>
                        <template v-else>{{ column.label }}</template>
                    </th>
                    <th v-if="has_actions" data-fold="actions" class="dt-actions">{{ actions_label }}</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="(row, index) of rows_shown" :key="key_of(row)">
                    <tr v-if="group_begins(index)" class="dt-group">
                        <td :colspan="span_of(fold.folded)"><slot name="group_head" :group="group(row)" :rows="rows.filter(v => (group(v) === group(row)))">{{ group(row) }}</slot></td>
                    </tr>
                    <tr :class="row_classes(row, fold.folded)" @click="row_click(row, fold.folded, $event)">
                        <td v-if="(selected !== undefined)" class="dt-tick"><input type="checkbox" aria-label="Tick this row" :checked="selected.includes(key_of(row))" @change="tick(row, $event.target.checked)"></td>
                        <template v-for="(column, i) of columns" :key="column.key">
                        <td v-if="(spread_over(row).includes(column.key) === false)" :data-fold="fold_name(column)" :data-spread="spread_of(row, column)" :colspan="spread_span(row, column)" :class="cell_classes(column)" :style="((i === 0) ? indent_of(row) : null)">
                            <button v-if="((i === 0) && (branch !== null) && (branch(row) !== null))" type="button" class="dt-branch" :class="branch(row)" :aria-label="((branch(row) === 'open') ? 'Close the branch' : 'Open the branch')" @click="$emit('branch', row)"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></button>
                            <span v-else-if="((i === 0) && (branch !== null))" class="dt-branch-none"></span>
                            <slot name="cell" :row="row" :column="column" :more="false">{{ row[column.key] }}</slot>
                        </td>
                        </template>
                        <td v-if="(has_actions && (spread_over(row).includes('actions') === false))" data-fold="actions" class="dt-actions">
                            <span v-if="asking_of(row)" class="dt-confirm">{{ asking.question }} <button type="button" class="danger" @click="ask_yes">{{ asking.yes }}</button><button type="button" @click="asking = null">Cancel</button></span>
                            <slot v-else name="actions" :row="row" :ask="(question, yes, action) => ask(row, question, yes, action)"/>
                        </td>
                    </tr>
                    <tr v-if="below_of(row)" class="dt-below">
                        <td :colspan="span_of(fold.folded)"><slot name="below" :row="row"/></td>
                    </tr>
                </template>
                <tr v-if="(rows_shown.length < rows.length)" class="dt-more">
                    <td :colspan="span_of(fold.folded)"><button type="button" class="link" @click="all_shown = true">Show the other {{ rows.length - rows_shown.length }}</button></td>
                </tr>
            </tbody>
        </table>
    </fold-table>
    <div v-if="whole_shown(folded)" class="dt-whole">
        <div class="dt-whole-head">
            <b><slot name="cell" :row="whole_row" :column="columns[0]" :more="true">{{ whole_row[columns[0].key] }}</slot></b>
            <button type="button" class="link" @click="whole = null">Close</button>
        </div>
        <dl class="fold-details">
            <template v-for="column of whole_columns(whole_row)" :key="('whole-' + column.key)">
                <dt>{{ column.label }}</dt>
                <dd><slot name="cell" :row="whole_row" :column="column" :more="true">{{ whole_row[column.key] }}</slot></dd>
            </template>
            <slot name="details" :row="whole_row"/>
            <template v-if="(has_actions && folded.includes('actions') && ((acts === null) || acts(whole_row)))">
                <dt>{{ actions_label }}</dt>
                <dd class="fold-actions dt-actions">
                    <span v-if="asking_of(whole_row)" class="dt-confirm">{{ asking.question }} <button type="button" class="danger" @click="ask_yes">{{ asking.yes }}</button><button type="button" @click="asking = null">Cancel</button></span>
                    <slot v-else name="actions" :row="whole_row" :ask="(question, yes, action) => ask(whole_row, question, yes, action)"/>
                </dd>
            </template>
        </dl>
    </div>
</div>
`,
    components: {'fold-table': fold_table},
    props: {
        columns: {type: Array, required: true},
        rows: {type: Array, required: true},
        row_key: {type: [String, Function], default: 'key'},
        empty: {type: String, default: 'Nothing here yet.'},
        more: {type: Function, default: null},
        opens: {type: Function, default: null},
        acts: {type: Function, default: null},
        row_class: {type: Function, default: null},
        chosen: {type: Function, default: null},
        group: {type: Function, default: null},
        head: {type: Boolean, default: true},
        depth: {type: Function, default: null},
        branch: {type: Function, default: null},
        limit: {type: Number, default: null},
        on_row: {type: Function, default: null},
        marks: {type: Boolean, default: true},
        actions_label: {type: String, default: ''},
        actions_fold: {type: Number, default: 0},
        sort: {type: Object, default: null},
        selected: {type: Array, default: undefined},
    },
    emits: ['sort', 'selected', 'branch'],
    data: function () {
        // The key of the row shown whole in the bar, or null; whether every row is shown past the
        // limit; and the question standing in a row's actions, {key, question, yes, action}
        // folded: the columns folded now, as fold_table last said, for the bar outside it
        return {whole: null, folded: [], all_shown: false, asking: null};
    },
    computed: {
        has_actions: function () {
            return (this.$slots.actions !== undefined);
        },
        rows_shown: function () {
            return ((this.limit === null) || this.all_shown) ? this.rows : this.rows.slice(0, this.limit);
        },
        // The columns that may fold, the least needed first; the actions before them all
        fold_order: function () {
            const folding = this.columns.filter(v => Number.isFinite(v.fold)).slice().sort((a, b) => (a.fold - b.fold));
            const out = folding.map(v => v.key);
            if (this.has_actions) {
                const at = folding.findIndex(v => v.fold > this.actions_fold);
                out.splice((at === -1) ? out.length : at, 0, 'actions');
            }
            return out;
        },
        // The row shown whole, while it is still among the rows
        whole_row: function () {
            return (this.whole === null) ? null : (this.rows.find(v => this.key_of(v) === this.whole) || null);
        },
        all_ticked: function () {
            return (this.rows.length > 0) && this.rows.every(v => this.selected.includes(this.key_of(v)));
        },
    },
    methods: {
        key_of: function (row) {
            return (typeof this.row_key === 'function') ? this.row_key(row) : row[this.row_key];
        },
        fold_name: function (column) {
            return Number.isFinite(column.fold) ? column.key : undefined;
        },
        sorted_by: function (column) {
            return (this.sort !== null) && (this.sort.key === column.key);
        },
        group_begins: function (index) {
            if (this.group === null) {
                return false;
            }
            return (index === 0) || (this.group(this.rows_shown[index - 1]) !== this.group(this.rows_shown[index]));
        },
        indent_of: function (row) {
            return (this.depth === null) ? null : {paddingLeft: `calc(${this.depth(row)*1.1}rem + .6rem)`};
        },
        // Whether the page has rows of its own under this one: its slot renders something
        below_of: function (row) {
            if (this.$slots.below === undefined) {
                return false;
            }
            return this.$slots.below({row}).some(v => v.type !== Comment);
        },
        // What makes a row worth a bar: every column folded away, and every one with more to say;
        // never a column a spread cell took over in this row
        details_of: function (row, folded) {
            const taken = this.spread_over(row);
            return this.columns.filter(v => (taken.includes(v.key) === false) && ((folded.includes(v.key) && said(v, row)) || ((this.more !== null) && this.more(row, v.key))));
        },
        // The keys of the columns a spread cell takes over in this row
        spread_over: function (row) {
            return this.columns.flatMap(v => ((v.spread === undefined) ? [] : (v.spread(row) || [])));
        },
        // A spread cell's colspan with every column shown, fold_table narrowing it to the shown
        // ones; bound here, so a cell that stops spreading loses it with its data-spread
        spread_span: function (row, column) {
            const keys = (column.spread === undefined) ? [] : (column.spread(row) || []);
            return (keys.length === 0) ? undefined : 1 + keys.length;
        },
        // What a cell spreads over, for fold_table to set its colspan; undefined for most cells
        spread_of: function (row, column) {
            const keys = ((column.spread === undefined) ? [] : (column.spread(row) || []));
            return (keys.length === 0) ? undefined : keys.join(' ');
        },
        opens_now: function (row, folded) {
            if ((this.details_of(row, folded).length > 0) || ((this.opens !== null) && this.opens(row))) {
                return true;
            }
            return this.has_actions && folded.includes('actions') && ((this.acts === null) || this.acts(row));
        },
        // Whether the bar is drawn: a row is shown whole, and it still has more to show at this
        // width
        whole_shown: function (folded) {
            return this.marks && (this.whole_row !== null) && this.opens_now(this.whole_row, folded);
        },
        // The row whole: every column after its name that has anything to say for it
        whole_columns: function (row) {
            const taken = this.spread_over(row);
            return this.columns.slice(1).filter(v => (taken.includes(v.key) === false) && said(v, row));
        },
        // A click on the row is the page's when it takes them, and shows the row whole when it
        // has more to show, or puts the bar away when it is the row shown; a click on a link, a
        // button or a box inside it is theirs
        row_click: function (row, folded, event) {
            if (event.target.closest('a, button, input, select, label, textarea') !== null) {
                return;
            }
            if (this.on_row !== null) {
                this.on_row(row, event);
            }
            if (this.marks && this.opens_now(row, folded)) {
                const key = this.key_of(row);
                this.whole = (this.whole === key) ? null : key;
            }
        },
        row_classes: function (row, folded) {
            const whole = (this.whole !== null) && (this.whole === this.key_of(row));
            const out = {foldable: (this.on_row !== null) || (this.marks && this.opens_now(row, folded)), open: whole, chosen: whole || ((this.chosen !== null) && this.chosen(row))};
            if (this.row_class !== null) {
                for (const name of [].concat(this.row_class(row) || [])) {
                    out[name] = true;
                }
            }
            return out;
        },
        cell_classes: function (column) {
            return {wraps: (column.wraps === true), 'dt-clip': (column.clip === true), 'dt-right': (column.align === 'right')};
        },
        // The columns shown now, for a full-width cell to span them all
        span_of: function (folded) {
            const shown = this.columns.filter(v => (folded.includes(v.key) === false)).length;
            return (shown + ((this.selected !== undefined) ? 1 : 0) + ((this.has_actions && (folded.includes('actions') === false)) ? 1 : 0));
        },
        tick: function (row, on) {
            const key = this.key_of(row);
            const rest = this.selected.filter(v => v !== key);
            this.$emit('selected', on ? rest.concat([key]) : rest);
        },
        tick_all: function (on) {
            this.$emit('selected', on ? this.rows.map(v => this.key_of(v)) : []);
        },
        // A question in a row's actions: yes does it, Cancel puts the actions back
        ask: function (row, question, yes, action) {
            this.asking = {key: this.key_of(row), question, yes, action};
        },
        asking_of: function (row) {
            return (this.asking !== null) && (this.asking.key === this.key_of(row));
        },
        ask_yes: function () {
            const action = this.asking.action;
            this.asking = null;
            action();
        },
    },
};

// Whether a column's cell has anything to say for this row
function said(column, row)
{
    return (column.hide === undefined) || (column.hide(row) === false);
}

export default data_table;
