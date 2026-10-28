// Where the light sits on each drawing, in its own 100 units
const LIGHT_AT = {server: {x: 79, y: 27}, laptop: {x: 80, y: 79}, home: {x: 85, y: 22}};

// A machine drawn as what it is, in a box of 100 by 100 units: a server, a laptop or a home
// computer, its screen lit while it is connected, and its one light: green, amber, red or
// dark; a blue dashed ring turns around the light while work runs on it. An SVG group, for an
// <svg> around it (the Canvas, a machine's Settings).
//
// Props
//     kind    server | laptop | home
//     light   green | amber | red | dark
//     work    true while work runs on the machine
const machine_drawing = {
    template: `
<g class="machine-drawing">
    <template v-if="(kind === 'laptop')">
        <path d="M18 10 H82 a4 4 0 0 1 4 4 V64 H14 V14 a4 4 0 0 1 4 -4 Z" class="canvas-body"/>
        <rect x="20" y="16" width="60" height="42" rx="2" :class="['canvas-screen', {off: (light === 'dark')}]"/>
        <path d="M4 68 H96 L90 90 H10 Z" class="canvas-base"/>
    </template>
    <template v-else-if="(kind === 'home')">
        <rect x="2" y="16" width="64" height="46" rx="4" class="canvas-body"/>
        <rect x="7" y="21" width="54" height="36" rx="2" :class="['canvas-screen', {off: (light === 'dark')}]"/>
        <path d="M28 62 h12 l3 14 h-18 z" class="canvas-stand"/><rect x="19" y="76" width="30" height="5" rx="2.5" class="canvas-stand"/>
        <rect x="72" y="10" width="26" height="74" rx="4" class="canvas-body"/>
    </template>
    <template v-else>
        <rect x="6" y="10" width="88" height="84" rx="8" class="canvas-body"/>
        <template v-for="unit of [0, 1, 2]" :key="unit">
            <rect x="12" :y="(16 + unit * 26)" width="76" height="22" rx="4" class="canvas-unit"/>
            <rect v-for="bay of ((unit === 0) ? 4 : 5)" :key="bay" :x="(6 + bay * 12)" :y="(21 + unit * 26)" width="9" height="12" rx="1.5" class="canvas-bay"/>
        </template>
    </template>
    <g :transform="('translate(' + at.x + ' ' + at.y + ')')">
        <circle v-if="(light !== 'dark')" r="8" :class="['canvas-glow', light]"/>
        <circle r="4.6" :class="['canvas-light', light]"/>
        <circle v-if="work" r="10.5" class="canvas-ring"/>
    </g>
</g>
`,
    props: {
        kind: {type: String, default: 'server'},
        light: {type: String, default: 'green'},
        work: {type: Boolean, default: false},
    },
    computed: {
        at: function () {
            return (LIGHT_AT[this.kind] === undefined) ? LIGHT_AT.server : LIGHT_AT[this.kind];
        },
    },
};

export default machine_drawing;
