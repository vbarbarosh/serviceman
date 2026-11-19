import CATEGORIES from './categories.js';

// Every kind of thing serviceman shows, a tile each, in its group: the way to the categories
// the first crumb's menu does not list (Health, Apps, Logline…), and the one page that says
// what each of them is for. A tile opens its page.
const categories_pane = {
    template: `
<article id="detail" class="list categories">
    <div class="list-head">
        <h1>All categories</h1>
        <span class="muted">{{ count }}</span>
    </div>
    <div v-for="group of groups" :key="group.name" class="cat-group">
        <h2>{{ group.name }}</h2>
        <div class="cat-tiles">
            <button v-for="item of group.items" :key="item.key" type="button" class="cat-tile" :class="{on: (item.key === category)}" @click="$emit('pick', item.key)">
                <span class="cat-head">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/>
                    <b class="cat-name">{{ item.name }}</b>
                    <span class="cat-count" :class="tally_of(item.key).state" :title="tally_of(item.key).title">{{ tally_of(item.key).text }}</span>
                </span>
                <span class="cat-says muted">{{ item.says }}</span>
            </button>
        </div>
    </div>
</article>
`,
    emits: ['pick'],
    props: {
        // What each category says on its right, {key: {text, state, title}}, as the first
        // crumb's menu shows it
        tallies: {type: Object, required: true},
        // The category the page came from, outlined: the way back to it is in plain sight
        category: {type: String, default: ''},
    },
    computed: {
        count: function () {
            return CATEGORIES.length;
        },
        groups: function () {
            const out = [];
            for (const item of CATEGORIES) {
                let group = out.find(v => v.name === item.group);
                if (group === undefined) {
                    group = {name: item.group, items: []};
                    out.push(group);
                }
                group.items.push(item);
            }
            return out;
        },
    },
    methods: {
        tally_of: function (key) {
            return (this.tallies[key] === undefined) ? {text: '', state: 'muted', title: ''} : this.tallies[key];
        },
    },
};

export default categories_pane;
