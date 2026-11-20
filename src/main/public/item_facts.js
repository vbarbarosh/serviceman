import share_level from './share_level.js';

// The facts in a page's head, between its name and its buttons: a label over a value, a note
// beside the value, and a bar under the ones that have one, amber from 0.8 and red from 0.92 as
// a filling disk's. A dim fact is the last number known, shown without its bar.
//
//     facts    [{label: 'Memory', value: '35%', small: 'of 8 GB', share: 0.35, title: '…',
//               dim: false, mono: false}, …]
const item_facts = {
    template: `
<dl class="item-facts">
    <div v-for="fact of facts" :key="fact.label" :title="fact.title">
        <dt>{{ fact.label }}</dt>
        <dd :class="{dim: (fact.dim === true)}">{{ fact.value }}<small v-if="(fact.small !== '')" :class="{mono: (fact.mono === true)}">{{ fact.small }}</small></dd>
        <span v-if="((fact.share !== null) && (fact.dim !== true))" class="meter" :class="level(fact.share)"><i :style="{width: (Math.max(2, Math.round(fact.share*100)) + '%')}"/></span>
    </div>
</dl>
`,
    props: ['facts'],
    methods: {
        level: share_level,
    },
};

export default item_facts;
