import overview_icons from './overview_icons.js';

// A number at a glance: a label, the big value, a bar under it and a note. `value` is between 0
// and 1 for the bar, or null for none: the bar turns amber from 0.8 and red from 0.92, the way
// a disk that fills does.
const overview_tile = {
    template: `
<div class="card ov-tile">
    <span class="ov-label"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons[icon]"/>{{ label }}</span>
    <b><slot/></b>
    <div v-if="(share !== null)" class="meter" :class="level"><i :style="{width: (Math.max(2, Math.round(share*100)) + '%')}"></i></div>
    <small class="muted">{{ note }}</small>
</div>
`,
    props: ['icon', 'label', 'value', 'note'],
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
            if (this.share >= 0.92) {
                return 'full';
            }
            return (this.share >= 0.8) ? 'filling' : '';
        },
    },
};

export default overview_tile;
