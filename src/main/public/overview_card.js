import overview_icons from './overview_icons.js';

// One subject in a card: its title, an aside, and its facts as dt and dd in the default slot.
// What a tab of the page shows has no card here: the tab is the place for it.
const overview_card = {
    template: `
<section class="card ov-card">
    <div class="ov-card-head">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons[icon]"/>
        <b>{{ title }}</b>
        <span v-if="$slots.aside" class="ov-card-aside"><slot name="aside"/></span>
    </div>
    <dl><slot/></dl>
</section>
`,
    props: ['icon', 'title'],
    computed: {
        icons: function () {
            return overview_icons;
        },
    },
};

export default overview_card;
