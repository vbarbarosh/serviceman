// A row's name as the kit draws it: its icon in a tile, the name, and one line under it, the
// title or, for a row in trouble, the reason in red or orange (the row's edge says the same)
const name_cell = {
    template: `
<span class="dt-name">
    <span class="dt-name-tile" :class="tile" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="icon"/></span>
    <span class="dt-name-text">
        <span class="dt-name-main" :class="{mono}" :title="name">{{ name }}</span>
        <span v-if="(line !== '')" class="dt-name-line" :class="tone" :title="line">{{ line }}</span>
    </span>
</span>
`,
    props: {
        // The inside of a 24x24 stroked svg
        icon: {type: String, required: true},
        name: {type: String, required: true},
        // The line under the name; '' for none
        line: {type: String, default: ''},
        // '' for a title, bad or warn for a reason
        tone: {type: String, default: ''},
        // A name that is an address or a path, in mono
        mono: {type: Boolean, default: false},
        // The tile's colour where its icon is a mark: run, bad, warn; '' for the link's
        tile: {type: String, default: ''},
    },
};

export default name_cell;
