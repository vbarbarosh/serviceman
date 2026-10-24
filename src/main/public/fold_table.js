// A table that keeps every column while it fits, and folds columns away only where it does not,
// for the row's whole view to show: the least needed first, as many as it must at that width (the
// rulebook's UI-21 to UI-23). It measures, never guesses: each column's one-line width against
// its own room, again on a resize and after every change of the rows.
//
// The table goes in the slot. A cell of a column that may fold carries `data-fold` with the
// column's name, its header cell too; `order` names those columns, the least needed first. A
// column with no `data-fold` (what a row is, its state) never folds. The slot is given:
//   folded         the names folded now, in `order`'s order
//   span           the columns shown now, for a full-width cell's colspan
// and the names folded are told as `folded` each time they change, for what the page draws
// outside the table.
// A cell that spreads
// over the columns after it carries `data-spread` with their names: its colspan is set here, to
// those shown now, and what it says is left out of the measure, so it wraps in the room it gets.
const fold_table = {
    template: `
<div ref="room" class="fold-room">
    <slot :folded="folded" :span="span"/>
</div>
`,
    props: ['order'],
    emits: ['folded'],
    data: function () {
        return {folded: [], span: 0};
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
        // Every cell shown on one line for a moment, measured, and the columns that do not fit
        // hidden again before the browser paints
        measure: function () {
            const room = this.$refs.room;
            const table = room.querySelector(':scope > table');
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
            let width = table.offsetWidth;
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
                folded.push(name);
                width -= widths[name] || 0;
            }
            for (const cell of cells) {
                cell.hidden = folded.includes(cell.dataset.fold);
            }
            for (const cell of spreads) {
                cell.colSpan = 1 + cell.dataset.spread.split(' ').filter(v => folded.includes(v) === false).length;
            }
            const span = (head.children.length - head.querySelectorAll('[hidden]').length);
            if (folded.join(' ') !== this.folded.join(' ')) {
                this.folded = folded;
                this.$emit('folded', folded);
            }
            if (span !== this.span) {
                this.span = span;
            }
        },
    },
};

export default fold_table;
