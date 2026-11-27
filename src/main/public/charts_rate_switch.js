import CHARTS_RATES from './charts_rates.js';
import charts_range_of from './charts_range_of.js';

// How often a machine's head reads its numbers again, at its head's top right and at its slim
// row's end, the same switch in both: its CPU, Memory and Disk, their small charts of the last
// ten minutes, and History while it shows those ten minutes, all of one reading. History's longer
// spans are read every half minute whatever is picked here. An agent from before the ten minutes
// has the rates disabled, its version said on them: its head reads its hour every half minute.
//
//     view     a remote of the status: {agent_version, machine: {can}}
//     rate     how often the head reads, in ms: 1000, 2000, 5000
//     @rate    a rate picked: 5000
const charts_rate_switch = {
    template: `
<span class="charts-switch">
    <span class="seg" role="group" aria-label="How often the numbers are read">
        <button v-for="item of rates" :key="item.value" type="button" :class="{on: item.on}" :disabled="item.disabled" :title="item.title" @click="$emit('rate', item.value)">{{ item.label }}</button>
    </span>
</span>
`,
    props: ['view', 'rate'],
    emits: ['rate'],
    computed: {
        // The rates, the one picked on; disabled, none on, with why, for an agent from before the
        // ten minutes
        rates: function () {
            const self = this;
            const live = (charts_range_of(this.view, '10m') === '10m');
            const why = `Read every 30 seconds: the numbers each second need agent 1.32 or newer; this machine runs ${this.view.agent_version || 'an older one'}`;
            return CHARTS_RATES.map(function (rate) {
                return {value: rate.value, label: rate.label, on: live && (rate.value === self.rate), disabled: (live === false), title: live ? `The numbers and the last ten minutes, read again ${rate.said}` : why};
            });
        },
    },
};

export default charts_rate_switch;
