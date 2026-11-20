import CATEGORIES, {ALL} from './categories.js';

// Where you are, on top of every page: `All categories › Remotes › vps1 › Settings`. The first
// two crumbs are buttons, All categories and the category, each opening its page at once, the
// category's list from the list itself too; no menu. Every other crumb but the last goes back up
// to it. On All categories' own page its button is the only crumb, its icon in the accent; on a
// phone it is its icon alone, so the trail keeps one line.
const crumbs_bar = {
    template: `
<div class="crumbs-bar" role="navigation" aria-label="Where you are">
    <button type="button" class="crumb-pick crumb-home" :class="{here: (category === 'categories')}" :title="all.says" :aria-label="all.name" @click="$emit('pick', 'categories')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="all.icon"/>
        <span class="crumb-name">{{ all.name }}</span>
    </button>
    <!-- A step keeps its › with it: a narrow screen wraps a whole step, never the › alone -->
    <span v-if="(category !== 'categories')" class="crumb-step">
        <span class="crumb-sep" aria-hidden="true">›</span>
        <button type="button" class="crumb-pick" :title="now.says" @click="$emit('pick', category)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="now.icon"/>
            <span class="crumb-name">{{ now.name }}</span>
        </button>
    </span>
    <span v-for="(crumb, index) of trail" :key="index" class="crumb-step">
        <span class="crumb-sep" aria-hidden="true">›</span>
        <button v-if="(crumb.to !== null)" type="button" class="crumb-link" @click="$emit('go', crumb.to)">{{ crumb.label }}</button>
        <b v-else class="crumb-here" aria-current="page">{{ crumb.label }}</b>
    </span>
</div>
`,
    emits: ['go', 'pick'],
    props: {
        // The category open, a key of categories.js, or 'categories' for All categories
        category: {type: String, required: true},
        // The crumbs after the first two, as page_crumbs makes them
        trail: {type: Array, required: true},
    },
    data: function () {
        return {all: ALL};
    },
    computed: {
        now: function () {
            return CATEGORIES.find(v => v.key === this.category) || ALL;
        },
    },
};

export default crumbs_bar;
