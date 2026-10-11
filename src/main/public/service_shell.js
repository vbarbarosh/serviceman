import terminal from 'terminal/terminal.js';

// A shell inside one container: the pane speaks to docker through serviceman, nothing else
const service_shell = {
    template: `
<terminal id="detail" :url="url" :theme="theme">
    <template #head><h1>{{ view.title || view.name }}<span v-if="(view.instances.length > 1)"> #{{ slot }}</span></h1></template>
    <div v-if="(running.length > 0)" class="actions">
        <button v-for="item of running" :key="item.slot" type="button" :disabled="(item.slot === slot)" @click="slot = item.slot">
            Instance #{{ item.slot }}
        </button>
    </div>
</terminal>
`,
    components: {terminal},
    props: ['view', 'theme'],
    data: function () {
        return {slot: first_running_slot(this.view)};
    },
    computed: {
        running: function () {
            if (this.view.instances.length < 2) {
                return [];
            }
            return this.view.instances.filter(v => v.phase === 'running');
        },
        url: function () {
            return `/api/v1/shell?service=${encodeURIComponent(this.view.name)}&slot=${this.slot}`;
        },
    },
};

function first_running_slot(view)
{
    const running = view.instances.filter(v => v.phase === 'running');
    return ((running.length > 0) ? running[0].slot : 1);
}

export default service_shell;
