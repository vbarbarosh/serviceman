// The lines of one machine or one service in Logline, the last 24 hours, as a tag: kind is
// remote or service; a url of null, where Logline's viewer is not set, shows nothing
const logs_link = {
    template: `<a v-if="(url !== null)" class="tag" :href="url" target="_blank" rel="noopener" :title="title" @click.stop>logs ↗</a>`,
    props: ['url', 'kind'],
    computed: {
        title: function () {
            return (this.kind === 'service') ? 'This service\'s lines in Logline, the last 24 hours' : 'This machine\'s lines in Logline, the last 24 hours';
        },
    },
};

export default logs_link;
