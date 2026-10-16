import fold_table from './fold_table.js';

// The one table of every page: the same look and the same behaviour wherever a list of things
// is shown. Columns that do not fit fold into the row's details, the least needed first
// (fold_table). A row that has more to show always says so with its mark, and opens on a click
// anywhere but its links, buttons and boxes; its details list what folded and what has more to
// say. Actions sit last, one style for all, and fold into the details on a narrow screen.
//
//     columns    [{key, label, fold, wraps, sort, hide}]: fold a number, the lowest folds first,
//                or absent for a column that never folds; wraps for a name that may wrap; sort
//                for a header that sorts on a click; hide(row) for a cell with nothing to say,
//                left out of the details when its column folds
//     rows       the things, one a row
//     row_key    the field that names a row, or a function of the row
//     empty      the line shown in the table's place when there is no row (or slot empty)
//     more       (row, key) => whether that cell has more to say in the details
//     opens      (row) => whether the row has details of its own (slot details)
//     row_state  (row) => ok | warn | bad | none, drawn as the stripe at the row's start
//     row_class  (row) => classes of the row, such as off
//     actions_label, actions_fold   the actions column's header, and when it folds (0: first)
//     sort       {key, down}: the column sorted by, emitting sort(key) on a header's click
//     selected   the keys of the rows ticked, a box on each row, emitting selected(keys)
//
// Slots: cell {row, column, more}, more true in the details; details {row}; actions {row};
// empty.
const data_table = {
    template: `
<div class="data-table-room">
    <p v-if="(rows.length === 0)" class="muted data-table-empty"><slot name="empty">{{ empty }}</slot></p>
    <fold-table v-else v-slot="fold" :order="fold_order" :caret_kept="true">
        <table class="data-table">
            <thead>
                <tr>
                    <th v-if="caret_shown(fold.folded)" class="fold-caret"></th>
                    <th v-if="(selected !== undefined)" class="dt-tick"><input type="checkbox" aria-label="Tick every row" :checked="all_ticked" @change="tick_all($event.target.checked)"></th>
                    <th v-for="column of columns" :key="column.key" :data-fold="fold_name(column)" :class="{wraps: (column.wraps === true)}">
                        <button v-if="(column.sort === true)" type="button" class="dt-sort" :class="{on: sorted_by(column)}" @click="$emit('sort', column.key)">{{ column.label }}<span v-if="sorted_by(column)">{{ (sort.down ? ' ↓' : ' ↑') }}</span></button>
                        <template v-else>{{ column.label }}</template>
                    </th>
                    <th v-if="has_actions" data-fold="actions" class="dt-actions">{{ actions_label }}</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="row of rows" :key="key_of(row)">
                    <tr :class="row_classes(row, fold.folded)" @click="row_click(row, fold.folded, $event)">
                        <td v-if="caret_shown(fold.folded)" class="fold-caret"><svg v-if="opens_now(row, fold.folded)" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></td>
                        <td v-if="(selected !== undefined)" class="dt-tick"><input type="checkbox" aria-label="Tick this row" :checked="selected.includes(key_of(row))" @change="tick(row, $event.target.checked)"></td>
                        <td v-for="(column, i) of columns" :key="column.key" :data-fold="fold_name(column)" :class="cell_classes(row, column, i)">
                            <slot name="cell" :row="row" :column="column" :more="false">{{ row[column.key] }}</slot>
                        </td>
                        <td v-if="has_actions" data-fold="actions" class="dt-actions"><slot name="actions" :row="row"/></td>
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
                                    <dd class="fold-actions dt-actions"><slot name="actions" :row="row"/></dd>
                                </template>
                            </dl>
                        </td>
                    </tr>
                </template>
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
        row_state: {type: Function, default: null},
        row_class: {type: Function, default: null},
        actions_label: {type: String, default: ''},
        actions_fold: {type: Number, default: 0},
        sort: {type: Object, default: null},
        selected: {type: Array, default: undefined},
    },
    emits: ['sort', 'selected'],
    data: function () {
        // The rows whose details are open, by their key
        return {opened: {}};
    },
    computed: {
        has_actions: function () {
            return (this.$slots.actions !== undefined);
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
            return this.rows.some(v => this.opens_now(v, folded));
        },
        is_open: function (row, folded) {
            return ((this.opened[this.key_of(row)] === true) && this.opens_now(row, folded));
        },
        row_click: function (row, folded, event) {
            if ((this.opens_now(row, folded) === false) || (event.target.closest('a, button, input, select, label, textarea') !== null)) {
                return;
            }
            const key = this.key_of(row);
            this.opened = Object.assign({}, this.opened, {[key]: (this.opened[key] !== true)});
        },
        row_classes: function (row, folded) {
            const out = {foldable: this.opens_now(row, folded), open: this.is_open(row, folded)};
            if (this.row_class !== null) {
                for (const name of [].concat(this.row_class(row) || [])) {
                    out[name] = true;
                }
            }
            return out;
        },
        // The first column carries the row's state as a straight stripe at its start
        cell_classes: function (row, column, i) {
            const out = {wraps: (column.wraps === true)};
            if ((i === 0) && (this.row_state !== null)) {
                out['dt-stripe'] = true;
                out[`dt-state-${this.row_state(row)}`] = true;
            }
            return out;
        },
        // The columns shown now, for the details' cell to span them all
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
    },
};

// Whether a column's cell has anything to say for this row
function said(column, row)
{
    return ((column.hide === undefined) || (column.hide(row) === false));
}

export default data_table;
