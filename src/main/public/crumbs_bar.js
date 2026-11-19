import CATEGORIES, {ALL} from './categories.js';

// Where you are, on top of every page: `Remotes ▾ › vps1 › Settings`. The first crumb names
// the category and opens a menu of them, each with its count, then All categories…; every other
// crumb but the last goes back up to it. A category the menu does not list stands first in it
// while it is open, so the menu always shows where you are.
const crumbs_bar = {
    template: `
<div class="crumbs-bar" role="navigation" aria-label="Where you are">
    <div class="crumb-first">
        <button ref="pick" type="button" class="crumb-pick" :class="{open}" aria-haspopup="menu" :aria-expanded="String(open)" :title="now.says" @click="toggle">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="now.icon"/>
            <span class="crumb-name">{{ now.name }}</span>
            <svg class="crumb-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <button v-if="open" type="button" class="crumb-back" tabindex="-1" aria-label="Close the menu" @click="open = false"></button>
        <div v-if="open" class="crumb-menu" role="menu" :aria-label="('Categories, ' + now.name + ' open')">
            <button v-for="item of menu" :key="item.key" type="button" role="menuitem" class="crumb-item" :class="{on: (item.key === category), apart: (item.menu === 0)}" :title="item.says" @click="pick(item.key)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/>
                <span class="crumb-name">{{ item.name }}</span>
                <span class="crumb-count" :class="tally_of(item.key).state" :title="tally_of(item.key).title">{{ tally_of(item.key).text }}</span>
            </button>
            <button type="button" role="menuitem" class="crumb-item crumb-all" :class="{on: (category === 'categories')}" :title="all.says" @click="pick('categories')">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="all.icon"/>
                <span class="crumb-name">All categories…</span>
            </button>
        </div>
    </div>
    <!-- A step keeps its › with it: a narrow screen wraps a whole step, never the › alone -->
    <span v-for="(crumb, index) of trail" :key="index" class="crumb-step">
        <span class="crumb-sep" aria-hidden="true">›</span>
        <button v-if="(crumb.to !== null)" type="button" class="crumb-link" @click="$emit('go', crumb.to)">{{ crumb.label }}</button>
        <b v-else class="crumb-here" aria-current="page">{{ crumb.label }}</b>
    </span>
</div>
`,
    emits: ['go', 'open', 'pick'],
    props: {
        // The category open, a key of categories.js, or 'categories' for All categories
        category: {type: String, required: true},
        // The crumbs after the first, as page_crumbs makes them
        trail: {type: Array, required: true},
        // What each category's line says on its right, {key: {text, state, title}}; none for a
        // category that says nothing
        tallies: {type: Object, required: true},
    },
    data: function () {
        return {open: false, all: ALL};
    },
    computed: {
        now: function () {
            return CATEGORIES.find(v => v.key === this.category) || ALL;
        },
        menu: function () {
            const listed = CATEGORIES.filter(v => v.menu > 0).sort((a, b) => a.menu - b.menu);
            return ((this.now.menu === 0) && (this.now !== ALL)) ? [this.now, ...listed] : listed;
        },
    },
    // Esc closes the menu, wherever the focus went
    mounted: function () {
        const self = this;
        this.escape_listener = function (event) {
            if ((event.key === 'Escape') && self.open) {
                self.open = false;
                self.$refs.pick.focus();
            }
        };
        document.addEventListener('keydown', this.escape_listener);
    },
    unmounted: function () {
        document.removeEventListener('keydown', this.escape_listener);
    },
    methods: {
        toggle: function () {
            this.open = (this.open === false);
            if (this.open) {
                this.$emit('open');
            }
        },
        pick: function (key) {
            this.open = false;
            this.$emit('pick', key);
        },
        tally_of: function (key) {
            return (this.tallies[key] === undefined) ? {text: '', state: 'muted', title: ''} : this.tallies[key];
        },
    },
};

export default crumbs_bar;
