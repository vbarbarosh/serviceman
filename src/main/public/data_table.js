import fold_table from './fold_table.js';

import {Comment} from 'vue';

// The one table of every page: the same look and the same behaviour wherever a list of things
// is shown. Columns that do not fit fold into the row's details, the least needed first
// (fold_table). A row that has more to show always says so with its mark, and opens on a click
// anywhere but its links, buttons and boxes; its details list what folded and what has more to
// say. Actions sit last, one style for all, and fold into the details on a narrow screen.
//
// Props
//     columns    [{key, label, fold, wraps, clip, align, sort, hide}]: fold a number, the lowest
//                folds first, or absent for a column that never folds; wraps for a name that may
//                wrap; clip for one line cut with … (the whole text opens under the row); align
//                'right' for figures; sort for a header that sorts on a click; hide(row) for a
//                cell with nothing to say, left out of the details when its column folds
//                A row_class of dim fades the row: a row shown for its place, not for itself
//     rows       the things, one a row, already in their order (and by group, when grouped)
//     row_key    the field that names a row, or a function of the row
//     empty      the line shown in the table's place when there is no row (or slot empty)
//     more       (row, key) => whether that cell has more to say in the details
//     opens      (row) => whether the row has details of its own (slot details)
//     row_class  (row) => classes of the row, such as off
//     chosen     (row) => whether the row is the one picked, drawn highlighted
//     group      (row) => the group the row is in: a row of its own (slot group_head) begins
//                each, the rows of one group next to each other
//     head       false for a table with no row of column headers (the columns still measured)
//     depth      (row) => how deep the row is in a tree, its first cell indented as much
//     branch     (row) => open | closed | null: a branch's mark in its first cell, emitting
//                branch(row) on its click; the page opens and closes it
//     limit      how many rows are shown before a button shows the other ones
//     on_row     (row, event) => a click on the row is the page's (a folder opened): the
//                details open on the row's mark instead
//     actions_label, actions_fold   the actions column's header, and when it folds (0: first)
//     sort       {key, down}: the column sorted by, emitting sort(key) on a header's click
//     selected   the keys of the rows ticked, a box on each row, emitting selected(keys)
//
// Slots
//     cell        {row, column, more}: a cell, more true when drawn in the details; an icon
//                 goes first in it as an element with class dt-icon
//     details     {row}: more lines of the row's details, as dt and dd
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
    <fold-table v-else v-slot="fold" :order="fold_order" :caret_kept="true">
        <table class="data-table" :class="{'dt-bare': (head === false)}">
            <thead>
                <tr>
                    <th v-if="caret_shown(fold.folded)" class="fold-caret"></th>
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
                        <td v-if="caret_shown(fold.folded)" class="fold-caret" @click.stop="toggle(row, fold.folded)"><svg v-if="opens_now(row, fold.folded)" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td v-if="(selected !== undefined)" class="dt-tick"><input type="checkbox" aria-label="Tick this row" :checked="selected.includes(key_of(row))" @change="tick(row, $event.target.checked)"></td>
                        <td v-for="(column, i) of columns" :key="column.key" :data-fold="fold_name(column)" :class="cell_classes(column)" :style="((i === 0) ? indent_of(row) : null)">
                            <button v-if="((i === 0) && (branch !== null) && (branch(row) !== null))" type="button" class="dt-branch" :class="branch(row)" :aria-label="((branch(row) === 'open') ? 'Close the branch' : 'Open the branch')" @click="$emit('branch', row)"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></button>
                            <span v-else-if="((i === 0) && (branch !== null))" class="dt-branch-none"></span>
                            <slot name="cell" :row="row" :column="column" :more="false">{{ row[column.key] }}</slot>
                        </td>
                        <td v-if="has_actions" data-fold="actions" class="dt-actions">
                            <span v-if="asking_of(row)" class="dt-confirm">{{ asking.question }} <button type="button" class="danger" @click="ask_yes">{{ asking.yes }}</button><button type="button" @click="asking = null">Cancel</button></span>
                            <slot v-else name="actions" :row="row" :ask="(question, yes, action) => ask(row, question, yes, action)"/>
                        </td>
                    </tr>
                    <tr v-if="is_open(row, fold.folded)" class="fold-more">
                        <td :colspan="span_of(fold.folded)">
                            <dl class="fold-details">
                                <template v-for="column of details_of(row, fold.folded)" :key="('more-' + column.key)">
                                    <dt>{{ column.label }}</dt>
                                    <dd><slot name="cell" :row="row" :column="column" :more="true">{{ row[column.key] }}</slot></dd>
                                </template>
                                <slot name="details" :row="row"/>
                                <template v-if="(has_actions && fold.folded.includes('actions'))">
                                    <dt>{{ actions_label }}</dt>
                                    <dd class="fold-actions dt-actions">
                                        <span v-if="asking_of(row)" class="dt-confirm">{{ asking.question }} <button type="button" class="danger" @click="ask_yes">{{ asking.yes }}</button><button type="button" @click="asking = null">Cancel</button></span>
                                        <slot v-else name="actions" :row="row" :ask="(question, yes, action) => ask(row, question, yes, action)"/>
                                    </dd>
                                </template>
                            </dl>
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
        row_class: {type: Function, default: null},
        chosen: {type: Function, default: null},
        group: {type: Function, default: null},
        head: {type: Boolean, default: true},
        depth: {type: Function, default: null},
        branch: {type: Function, default: null},
        limit: {type: Number, default: null},
        on_row: {type: Function, default: null},
        actions_label: {type: String, default: ''},
        actions_fold: {type: Number, default: 0},
        sort: {type: Object, default: null},
        selected: {type: Array, default: undefined},
    },
    emits: ['sort', 'selected', 'branch'],
    data: function () {
        // The rows whose details are open, by their key; whether every row is shown past the
        // limit; and the question standing in a row's actions, {key, question, yes, action}
        return {opened: {}, all_shown: false, asking: null};
    },
    computed: {
        has_actions: function () {
            return (this.$slots.actions !== undefined);
        },
        rows_shown: function () {
            return (((this.limit === null) || this.all_shown) ? this.rows : this.rows.slice(0, this.limit));
        },
        // The columns that may fold, the least needed first; the actions before them all
        fold_order: function () {
            const folding = this.columns.filter(v => Number.isFinite(v.fold)).slice().sort((a, b) => (a.fold - b.fold));
            const out = folding.map(v => v.key);
            if (this.has_actions) {
                const at = folding.findIndex(v => v.fold > this.actions_fold);
                out.splice(((at === -1) ? out.length : at), 0, 'actions');
            }
            return out;
        },
        all_ticked: function () {
            return ((this.rows.length > 0) && this.rows.every(v => this.selected.includes(this.key_of(v))));
        },
    },
    methods: {
        key_of: function (row) {
            return ((typeof this.row_key === 'function') ? this.row_key(row) : row[this.row_key]);
        },
        fold_name: function (column) {
            return (Number.isFinite(column.fold) ? column.key : undefined);
        },
        sorted_by: function (column) {
            return ((this.sort !== null) && (this.sort.key === column.key));
        },
        group_begins: function (index) {
            if (this.group === null) {
                return false;
            }
            return ((index === 0) || (this.group(this.rows_shown[index - 1]) !== this.group(this.rows_shown[index])));
        },
        indent_of: function (row) {
            return ((this.depth === null) ? null : {paddingLeft: `calc(${this.depth(row)*1.1}rem + .6rem)`});
        },
        // Whether the page has rows of its own under this one: its slot renders something
        below_of: function (row) {
            if (this.$slots.below === undefined) {
                return false;
            }
            return this.$slots.below({row}).some(v => v.type !== Comment);
        },
        // What a row's details list: every column folded away, and every one with more to say
        details_of: function (row, folded) {
            return this.columns.filter(v => ((folded.includes(v.key) && said(v, row)) || ((this.more !== null) && this.more(row, v.key))));
        },
        opens_now: function (row, folded) {
            if ((this.details_of(row, folded).length > 0) || ((this.opens !== null) && this.opens(row))) {
                return true;
            }
            return (this.has_actions && folded.includes('actions'));
        },
        caret_shown: function (folded) {
            return this.rows_shown.some(v => this.opens_now(v, folded));
        },
        is_open: function (row, folded) {
            return ((this.opened[this.key_of(row)] === true) && this.opens_now(row, folded));
        },
        toggle: function (row, folded) {
            if (this.opens_now(row, folded) === false) {
                return;
            }
            const key = this.key_of(row);
            this.opened = Object.assign({}, this.opened, {[key]: (this.opened[key] !== true)});
        },
        // A click on the row opens it, or is the page's when it takes them; a click on a link,
        // a button or a box inside it is theirs
        row_click: function (row, folded, event) {
            if (event.target.closest('a, button, input, select, label, textarea') !== null) {
                return;
            }
            if (this.on_row !== null) {
                this.on_row(row, event);
                return;
            }
            this.toggle(row, folded);
        },
        row_classes: function (row, folded) {
            const out = {foldable: ((this.on_row !== null) || this.opens_now(row, folded)), open: this.is_open(row, folded), chosen: ((this.chosen !== null) && this.chosen(row))};
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
            return (shown + (this.caret_shown(folded) ? 1 : 0) + ((this.selected !== undefined) ? 1 : 0) + ((this.has_actions && (folded.includes('actions') === false)) ? 1 : 0));
        },
        tick: function (row, on) {
            const key = this.key_of(row);
            const rest = this.selected.filter(v => v !== key);
            this.$emit('selected', (on ? rest.concat([key]) : rest));
        },
        tick_all: function (on) {
            this.$emit('selected', (on ? this.rows.map(v => this.key_of(v)) : []));
        },
        // A question in a row's actions: yes does it, Cancel puts the actions back
        ask: function (row, question, yes, action) {
            this.asking = {key: this.key_of(row), question, yes, action};
        },
        asking_of: function (row) {
            return ((this.asking !== null) && (this.asking.key === this.key_of(row)));
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
    return ((column.hide === undefined) || (column.hide(row) === false));
}

export default data_table;
