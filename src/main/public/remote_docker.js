import docker from 'docker/docker.js';

// The containers of one machine, through the Docker module: its API is this host's
// /api/v1/remotes/<name>/docker, which reaches the engine over the link the agent dialled
const remote_docker = {
    template: `
<article v-if="(view.machine === null)" id="detail" class="list">
    <p class="muted">This machine has not connected since serviceman last started, so whether it has docker is not known yet.</p>
</article>
<docker v-else id="detail" class="list" :base="base" :offline="(view.phase !== 'online')" :theme="theme" :files_base="files_base" :shell_url="shell_url"/>
`,
    components: {docker},
    props: ['view', 'theme'],
    computed: {
        base: function () {
            return `/api/v1/remotes/${encodeURIComponent(this.view.name)}/docker`;
        },
    },
    methods: {
        // A container's files, the File Manager's API over a disk inside it
        files_base: function (item) {
            return `${this.base}/containers/${item.id}/fs`;
        },
        // A shell in a container, the Terminal module's websocket
        shell_url: function (item) {
            return `/api/v1/shell?remote=${encodeURIComponent(this.view.name)}&container=${item.id}`;
        },
    },
};

export default remote_docker;
