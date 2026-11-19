// A row's state as the kit draws it: a pill, soft, edged, with its dot: run green, idle grey
// (asleep, an empty ring), bad red, busy orange, acc the accent
const state_pill = {
    template: `<span class="st-pill" :class="tone"><i aria-hidden="true"/>{{ text }}</span>`,
    props: {
        tone: {type: String, required: true},
        text: {type: String, required: true},
    },
};

export default state_pill;
