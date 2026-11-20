import head_spark from './head_spark.js';
import share_level from './share_level.js';

// The facts in a page's head, between its name and its buttons: a label over a value, a note
// beside the value, and under it a small chart of its last hour where it has one (head_spark),
// else a bar, amber from 0.8 and red from 0.92 as a filling disk's. A dim fact is the last
// number known: its chart grey with no dot, and no bar.
//
//     facts    [{label: 'Memory', value: '35%', small: 'of 8 GB', share: 0.35, title: '…',
//               dim: false, mono: false, spark: null or head_spark's, empty while read}, …]
const item_facts = {
    template: `
<dl class="item-facts">
    <div v-for="fact of facts" :key="fact.label" :title="fact.title">
        <dt>{{ fact.label }}</dt>
        <dd :class="{dim: (fact.dim === true)}">{{ fact.value }}<small v-if="(fact.small !== '')" :class="{mono: (fact.mono === true)}">{{ fact.small }}</small></dd>
        <span v-if="((fact.spark !== null) && (fact.spark !== undefined))" class="spark" :class="{dim: (fact.dim === true)}">
            <svg :viewBox="('0 0 ' + SPARK_W + ' ' + SPARK_H)" preserveAspectRatio="none" aria-hidden="true"><path class="spark-area" :d="fact.spark.area"/><path class="spark-line" :d="fact.spark.line"/></svg>
            <i v-if="((fact.dim !== true) && (fact.spark.last !== null))" class="spark-dot" :style="{left: (fact.spark.last.x/SPARK_W*100 + '%'), top: (fact.spark.last.y/SPARK_H*100 + '%')}"/>
        </span>
        <span v-else-if="((fact.share !== null) && (fact.dim !== true))" class="meter" :class="level(fact.share)"><i :style="{width: (Math.max(2, Math.round(fact.share*100)) + '%')}"/></span>
    </div>
</dl>
`,
    props: ['facts'],
    data: function () {
        return {SPARK_W: head_spark.W, SPARK_H: head_spark.H};
    },
    methods: {
        level: share_level,
    },
};

export default item_facts;
