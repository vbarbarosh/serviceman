// The arrow beside a kind of the rail whose items are listed under it while it is open (its
// services, its machines): it folds that list away and back, and the page shown stays as it is
const rail_fold = {
    template: `
<button type="button" class="rail-fold" :class="{folded}" :aria-expanded="(folded === false)" :title="(folded ? ('Show the ' + what + ' here') : ('Fold the ' + what + ' away'))" :aria-label="(folded ? ('Show the ' + what) : ('Fold the ' + what + ' away'))" @click="$emit('toggle')">
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
</button>
`,
    props: {
        folded: {type: Boolean, required: true},
        // What the list holds, in a few words: machines, services
        what: {type: String, required: true},
    },
    emits: ['toggle'],
};

export default rail_fold;
