// Whether a machine runs the agent this host serves, as a pill: current is true or false, or
// null where it cannot be told, which shows nothing (agent_current)
const agent_pill = {
    template: `<span v-if="(current !== null)" class="pill agent-pill" :class="(current ? 'running' : 'starting')" :title="title">{{ (current ? 'agent up to date' : 'agent outdated') }}</span>`,
    props: ['current'],
    computed: {
        title: function () {
            return this.current ? 'It runs the agent this host serves' : 'It runs an older agent than this host serves; Configure updates it';
        },
    },
};

export default agent_pill;
