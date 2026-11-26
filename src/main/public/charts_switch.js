import CHARTS_RANGES from './charts_ranges.js';
import CHARTS_RATES from './charts_rates.js';
import charts_range_of from './charts_range_of.js';

// A machine's charts' range and rate, at its head's top right: the range its head's CPU, Memory
// and Disk and its History below all show, and how often the ten minutes are read again. The
// rate is for the ten minutes alone, and stands disabled for the longer ranges, which are read
// every half minute; an agent from before the ten minutes has them disabled too, its version
// said on them.
//
//     view     a remote of the status: {agent_version, machine: {can}}
//     range    the range read: '10m', '1h', '24h', '7d', '30d'
//     rate     how often the ten minutes are read, in ms: 1000, 2000, 5000
//     @range   a range picked: '24h'
//     @rate    a rate picked: 5000
const charts_switch = {
    template: `
<span class="charts-switch">
    <span class="seg" role="group" aria-label="The range the charts show">
        <button v-for="item of ranges" :key="item.value" type="button" :class="{on: item.on}" :disabled="item.disabled" :title="item.title" @click="$emit('range', item.value)">{{ item.label }}</button>
    </span>
    <span class="seg" role="group" aria-label="How often the ten minutes are read">
        <button v-for="item of rates" :key="item.value" type="button" :class="{on: item.on}" :disabled="item.disabled" :title="item.title" @click="$emit('rate', item.value)">{{ item.label }}</button>
    </span>
</span>
`,
    props: ['view', 'range', 'rate'],
    emits: ['range', 'rate'],
    computed: {
        // Whether its agent reads the ten minutes (1.32 and newer)
        live: function () {
            return charts_range_of(this.view, '10m') === '10m';
        },
        // What says the ten minutes are not for this machine
        live_missing: function () {
            return `The ten minutes need agent 1.32 or newer; this machine runs ${this.view.agent_version || 'an older one'}`;
        },
        // The ranges, the one read on; the ten minutes disabled for an agent before them
        ranges: function () {
            const self = this;
            return CHARTS_RANGES.map(function (range) {
                const disabled = (range.value === '10m') && (self.live === false);
                return {value: range.value, label: range.label, on: (range.value === self.range), disabled, title: disabled ? self.live_missing : `The last ${range.said}`};
            });
        },
        // The rates, the one picked on while the ten minutes are read; disabled, none on, with why,
        // for the longer ranges
        rates: function () {
            const self = this;
            const is_ten = (this.range === '10m');
            const why = this.live ? '1h and longer gain a point every half minute, and are read every 30 seconds' : `${this.live_missing}: 1h and longer are read every 30 seconds`;
            return CHARTS_RATES.map(function (rate) {
                return {value: rate.value, label: rate.label, on: is_ten && (rate.value === self.rate), disabled: (is_ten === false), title: is_ten ? `The ten minutes, read again ${rate.said}` : why};
            });
        },
    },
};

export default charts_switch;
