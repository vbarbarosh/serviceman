// The agent's pill where the place already says it is about the agent: a column or a card of
// that name; the same pill, its words without "agent"
const agent_pill_short = {
    template: `<span v-if="(current !== null)" class="pill agent-pill" :class="(current ? 'running' : 'starting')" :title="title">{{ (current ? 'up to date' : 'outdated') }}</span>`,
    props: ['current'],
    computed: {
        title: function () {
            return this.current ? 'It runs the agent this host serves' : 'It runs an older agent than this host serves; Configure updates it';
        },
    },
};

export default agent_pill_short;
