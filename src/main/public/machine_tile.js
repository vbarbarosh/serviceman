// A machine as a tile to pick in a step: its icon in a tile, a dot for whether its agent is
// online, its name, its lines and a meter of its memory (machine_card makes the item). The
// picked one is drawn on; a click is the tile's own, given by the step that holds it
const machine_tile = {
    template: `
<button type="button" role="radio" class="machine-card" :class="{on: on, away: item.away}" :aria-checked="on">
    <span class="kt-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" v-html="item.icon"/></span>
    <span v-if="(item.dot !== '')" class="mc-dot" :class="item.dot" :title="((item.dot === 'on') ? 'online' : 'offline')"/>
    <b :title="item.title">{{ item.title }}</b>
    <span v-for="line of item.lines" :key="line" class="muted">{{ line }}</span>
    <span v-if="(item.meter !== null)" class="mc-meter" :title="(Math.round(item.meter.used*100) + '% of its memory used')"><i :class="{low: item.meter.low}" :style="{width: ((item.meter.used*100) + '%')}"/></span>
</button>
`,
    props: {
        // {title, icon, dot ('on', 'off' or ''), lines, meter ({used, low} or null), away}
        item: {type: Object, required: true},
        on: {type: Boolean, default: false},
    },
};

export default machine_tile;
