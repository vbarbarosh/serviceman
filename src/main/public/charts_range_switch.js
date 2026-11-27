import CHARTS_RANGES from './charts_ranges.js';
import charts_range_of from './charts_range_of.js';

// The span History shows, in History's own head: 10m, 1h, 24h, 7d, 30d. It is History's alone:
// the machine's head always charts its last ten minutes. The ten minutes are read with the head's
// numbers, at the rate picked there; the longer spans every half minute, as their agent writes
// them. An agent from before the ten minutes has them disabled, its version said on them.
//
//     view     a remote of the status: {agent_version, machine: {can}}
//     range    the span read: '10m', '1h', '24h', '7d', '30d'
//     @range   a span picked: '24h'
const charts_range_switch = {
    template: `
<span class="charts-switch">
    <span class="seg" role="group" aria-label="The span History shows">
        <button v-for="item of ranges" :key="item.value" type="button" :class="{on: item.on}" :disabled="item.disabled" :title="item.title" @click="$emit('range', item.value)">{{ item.label }}</button>
    </span>
</span>
`,
    props: ['view', 'range'],
    emits: ['range'],
    computed: {
        // The spans, the one read on; the ten minutes disabled for an agent from before them
        ranges: function () {
            const self = this;
            const live = (charts_range_of(this.view, '10m') === '10m');
            return CHARTS_RANGES.map(function (range) {
                const disabled = (range.value === '10m') && (live === false);
                return {value: range.value, label: range.label, on: (range.value === self.range), disabled, title: title_of(range, disabled, self.view)};
            });
        },
    },
};

// What a span's button says of it: what it shows and how often it is read, or why it is off
function title_of(range, disabled, view)
{
    if (disabled) {
        return `The ten minutes need agent 1.32 or newer; this machine runs ${view.agent_version || 'an older one'}`;
    }
    if (range.value === '10m') {
        return 'The last ten minutes, read with the numbers at the head';
    }
    return `The last ${range.said}, read again every half minute`;
}

export default charts_range_switch;
