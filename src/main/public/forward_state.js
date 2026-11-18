import forward_now_said from './forward_now_said.js';

// A forward's state, its dot and its word or two, in the colour of an error when it is one: the
// same on Forwards and on the page of the service it is part of. `reason` adds what stands in its
// way, in full, where the word does not say it all.
const forward_state = {
    template: `
<span><span class="dt-state" :class="{bad: said.bad}"><span class="dot" :class="said.dot"/>{{ said.word }}</span><span v-if="(reason && said.problem !== null)" class="bad"> — {{ said.problem }}</span></span>
`,
    props: ['forward', 'remotes', 'reason'],
    computed: {
        said: function () {
            return forward_now_said(this.forward, this.remotes);
        },
    },
};

export default forward_state;
