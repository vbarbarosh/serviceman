// A table that keeps every column while it fits, and folds columns into its rows' details only
// where it does not: the least needed first, as many as it must at that width (the rulebook's
// UI-21 to UI-23). It measures, never guesses: each column's one-line width against its own
// room, again on a resize and after every change of the rows.
//
// The table goes in the slot. A cell of a column that may fold carries `data-fold` with the
// column's name, its header cell too; `order` names those columns, the least needed first. A
// column with no `data-fold` (what a row is, its state) never folds. The slot is given:
//   folded         the names folded now, in `order`'s order
//   span           the columns shown now, for a details cell's colspan
//   is_open(key)   whether that row's details are open
//   toggle(key, event)  a click on the row; a click on a link, a button or a box inside it is theirs
// `caret_kept` says the chevron's column is there whether anything folds or not: it is
// measured as part of the table, not added when the first column folds. A cell that spreads
// over the columns after it carries `data-spread` with their names: its colspan is set here, to
// those shown now, and what it says is left out of the measure, so it wraps in the room it gets.
const fold_table = {
    template: `
<div ref="room" class="fold-room">
    <slot :folded="folded" :span="span" :is_open="is_open" :toggle="toggle"/>
</div>
`,
    props: ['order', 'caret_kept'],
    emits: [],
    data: function () {
        // `opened` is the rows whose details are shown, by the key the slot gives
        return {folded: [], span: 0, opened: {}};
    },
    mounted: function () {
        // Measured on the next frame and only for a new width: folding changes the room's height,
        // and measuring inside the observer's own call made Chrome report a loop as an error
        this.observer = new ResizeObserver(this.resized);
        this.observer.observe(this.$refs.room);
        this.measure();
    },
    updated: function () {
        this.measure();
    },
    unmounted: function () {
        this.observer.disconnect();
        cancelAnimationFrame(this.frame);
    },
    methods: {
        resized: function () {
            const width = this.$refs.room.clientWidth;
            if (width === this.width) {
                return;
            }
            this.width = width;
            cancelAnimationFrame(this.frame);
            this.frame = requestAnimationFrame(() => this.measure());
        },
        is_open: function (key) {
            return (this.folded.length > 0) && (this.opened[key] === true);
        },
        toggle: function (key, event) {
            if ((this.folded.length === 0) || (event.target.closest('a, button, input, select, label, textarea') !== null)) {
                return;
            }
            this.opened = Object.assign({}, this.opened, {[key]: (this.opened[key] !== true)});
        },
        // Every cell shown on one line for a moment, measured, and the columns that do not fit
        // hidden again before the browser paints
        measure: function () {
            const room = this.$refs.room;
            const table = room.querySelector('table');
            const head = (table === null) ? null : table.querySelector('thead tr');
            if ((head === null) || (room.clientWidth === 0)) {
                return;
            }
            const cells = table.querySelectorAll('[data-fold]');
            for (const cell of cells) {
                cell.hidden = false;
            }
            const spreads = table.querySelectorAll('[data-spread]');
            for (const cell of spreads) {
                cell.colSpan = 1 + cell.dataset.spread.split(' ').length;
            }
            table.classList.add('fold-measure');
            const caret = head.querySelector('.fold-caret');
            const kept = (caret !== null) && (this.caret_kept === true);
            const caret_width = ((caret === null) || kept) ? 0 : caret.offsetWidth;
            let width = (table.offsetWidth - caret_width);
            const widths = {};
            for (const cell of head.querySelectorAll('[data-fold]')) {
                widths[cell.dataset.fold] = ((widths[cell.dataset.fold] || 0) + cell.offsetWidth);
            }
            table.classList.remove('fold-measure');
            const folded = [];
            for (const name of this.order) {
                if (width <= room.clientWidth) {
                    break;
                }
                if ((folded.length === 0) && (kept === false)) {
                    width += (caret === null) ? CARET_WIDTH : caret_width;
                }
                folded.push(name);
                width -= widths[name] || 0;
            }
            for (const cell of cells) {
                cell.hidden = folded.includes(cell.dataset.fold);
            }
            for (const cell of spreads) {
                cell.colSpan = 1 + cell.dataset.spread.split(' ').filter(v => folded.includes(v) === false).length;
            }
            const span = (head.children.length - head.querySelectorAll('[hidden]').length - ((caret === null) ? 0 : 1) + ((folded.length === 0) ? 0 : 1));
            if (folded.join(' ') !== this.folded.join(' ')) {
                this.folded = folded;
            }
            if (span !== this.span) {
                this.span = span;
            }
        },
    },
};

// The chevron's column before it is drawn, as .fold-caret is wide in serviceman.css
const CARET_WIDTH = 24;

export default fold_table;
