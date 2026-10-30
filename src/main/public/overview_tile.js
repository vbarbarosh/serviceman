import overview_icons from './overview_icons.js';
import share_level from './share_level.js';

// A number at a glance: a label, the big value, a bar under it and a note. `value` is between 0
// and 1 for the bar, or null for none: the bar turns amber from 0.8 and red from 0.92, the way
// a disk that fills does. `rail` puts a tick in its corner, whether the number shows beside
// every machine in the rail: true or false, or none for a number the rail does not show.
const overview_tile = {
    template: `
<div class="card ov-tile">
    <span class="ov-label"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons[icon]"/>{{ label }}<input v-if="(rail === true || rail === false)" type="checkbox" class="ov-rail" :checked="rail" :title="rail_title" :aria-label="rail_title" @change="$emit('rail', $event.target.checked)"></span>
    <b><slot/></b>
    <div v-if="(share !== null)" class="meter" :class="level"><i :style="{width: (Math.max(2, Math.round(share*100)) + '%')}"></i></div>
    <small class="muted">{{ note }}</small>
    <button v-if="(go !== undefined && go !== null)" type="button" class="link ov-go" @click="$emit('tab', tab)">{{ go }}</button>
</div>
`,
    // go: a link under the note to the tab that says more, tab its name
    props: ['icon', 'label', 'value', 'note', 'go', 'tab', 'rail'],
    emits: ['rail', 'tab'],
    computed: {
        icons: function () {
            return overview_icons;
        },
        share: function () {
            if ((this.value === null) || (this.value === undefined)) {
                return null;
            }
            return Math.min(1, Math.max(0, Number(this.value) || 0));
        },
        level: function () {
            return share_level(this.share);
        },
        rail_title: function () {
            return `${this.label} beside every machine in the rail: ${this.rail ? 'shown, untick to hide' : 'hidden, tick to show'}`;
        },
    },
};

export default overview_tile;
