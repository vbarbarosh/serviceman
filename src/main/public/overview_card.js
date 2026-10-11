import overview_icons from './overview_icons.js';

// One subject in a card: its title, an aside, a way to the tab that does more with it, a
// sentence where there are no facts to list, and its facts as dt and dd in the default slot
const overview_card = {
    template: `
<section class="card ov-card">
    <div class="ov-card-head">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" v-html="icons[icon]"/>
        <b>{{ title }}</b>
        <span v-if="$slots.aside" class="ov-card-aside"><slot name="aside"/></span>
        <button v-if="tab" type="button" class="link ov-go" @click="$emit('tab', tab)">{{ go }} →</button>
    </div>
    <p v-if="$slots.note" class="ov-note"><slot name="note"/></p>
    <dl><slot/></dl>
</section>
`,
    // tab  the name of another tab of this machine's page, in the address: configure, logs, …
    props: ['icon', 'title', 'tab', 'go'],
    emits: ['tab'],
    computed: {
        icons: function () {
            return overview_icons;
        },
    },
};

export default overview_card;
