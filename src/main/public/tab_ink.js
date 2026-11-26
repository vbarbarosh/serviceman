// The underline of the open tab, as one element for the whole row: when the pick changes it
// slides from where it was to where it belongs, instead of appearing there
const tab_ink = {
    template: `<span class="tabink" :class="{still}" :style="{transform: 'translate(' + left + 'px, ' + top + 'px)', width: width + 'px'}"/>`,
    // The pick goes in the mark, and a changed mark slides the line to the tab picked. Whatever
    // else moves or resizes a tab of the row (a count that arrives after the page opened, a
    // label, a skin's faces, a tab shown or gone) is measured again as it happens: the line
    // stays under its tab, with no slide (ResizeObserver, MutationObserver)
    props: ['mark'],
    data: function () {
        return {left: 0, top: 0, width: 0, still: true};
    },
    watch: {
        mark: function () {
            this.$nextTick(() => this.place());
        },
    },
    methods: {
        allow_slides: function () {
            this.still = false;
        },
        // The row changed under the line: it goes straight to the tab's new place
        follow: function () {
            const was = this.still;
            this.still = true;
            this.place();
            if (was === false) {
                requestAnimationFrame(() => requestAnimationFrame(this.allow_slides));
            }
        },
        // Every tab of the row and the row itself, the line's own element left out
        watch_row: function () {
            this.sizes.disconnect();
            const row = this.$el.parentElement;
            this.sizes.observe(row);
            for (const item of row.children) {
                if (item !== this.$el) {
                    this.sizes.observe(item);
                }
            }
        },
        place: function () {
            const row = this.$el.parentElement;
            const on = row.querySelector('.tab.on');
            if (on === null) {
                this.width = 0;
                return;
            }
            // Under the tab itself, on whichever row it is: a narrow page wraps the tabs. Measured
            // from the row: More ▾ sits in a wrapper of its own, which its offsets start from
            let left = 0;
            let top = 0;
            for (let at = on; (at !== null) && (at !== row); at = at.offsetParent) {
                left += at.offsetLeft;
                top += at.offsetTop;
            }
            this.left = left;
            this.top = top + on.offsetHeight - 1;
            this.width = on.offsetWidth;
        },
    },
    mounted: function () {
        // A page opened anew draws the line under its tab at once; only a move after that
        // slides, rather than the line flying in from the corner
        this.place();
        requestAnimationFrame(() => requestAnimationFrame(this.allow_slides));
        // A narrower window wraps the row; web fonts landing after the first paint, a count, a
        // skin picked make a tab wider; a tab shown or gone moves the ones after it
        this.sizes = new ResizeObserver(() => this.follow());
        this.tabs = new MutationObserver(() => this.watch_row());
        this.tabs.observe(this.$el.parentElement, {childList: true});
        this.watch_row();
    },
    unmounted: function () {
        this.sizes.disconnect();
        this.tabs.disconnect();
    },
};

export default tab_ink;
