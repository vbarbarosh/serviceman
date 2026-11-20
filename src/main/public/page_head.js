import CATEGORIES, {ALL} from './categories.js';

// The head of a category's page, as the kit draws it: the category's icon in a tile, its name
// and a chip with its count, one line of what the page is, and its actions on the right, the
// primary last. What more there is to say waits behind How it works, a card that opens under
// the head, never a paragraph above the page.
//
//     slots   acts: the page's buttons; state: a chip in place of the count; how: the text
//             How it works opens
const page_head = {
    template: `
<div class="page-head">
    <span class="page-head-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="item.icon"/></span>
    <div class="page-head-text">
        <h1>{{ item.name }}<span v-if="(count !== null)" class="page-head-count">{{ count }}</span><slot name="state"/></h1>
        <p class="page-head-says">{{ says }}<button v-if="$slots.how" type="button" class="link page-head-how" :aria-expanded="String(how_open)" @click="how_open = !how_open">{{ how_label }}</button></p>
    </div>
    <div v-if="$slots.acts" class="page-head-acts"><slot name="acts"/></div>
</div>
<section v-if="($slots.how && how_open)" class="card page-how">
    <div class="card-head">
        <h2>{{ how_label }}</h2>
        <button type="button" class="link" @click="how_open = false">Close</button>
    </div>
    <div class="card-body page-how-body"><slot name="how"/></div>
</section>
`,
    props: {
        // A key of CATEGORIES, or 'categories' for All categories: its name, icon and line
        category: {type: String, required: true},
        // The chip beside the name; null for none
        count: {type: [Number, String], default: null},
        // The words of the link that opens the rest: How it works, How doors work
        how_label: {type: String, default: 'How it works'},
        // A sentence after the line, for this page alone: what to do on it, as the menus' line
        // never says (Map: Point at anything…); '' for none
        more: {type: String, default: ''},
    },
    data: function () {
        return {how_open: false};
    },
    computed: {
        item: function () {
            const found = CATEGORIES.find(v => v.key === this.category);
            return (found === undefined) ? ALL : found;
        },
        // The line under the name, and this page's sentence after it
        says: function () {
            return (this.more === '') ? `${this.item.says}.` : `${this.item.says}. ${this.more}`;
        },
    },
};

export default page_head;
