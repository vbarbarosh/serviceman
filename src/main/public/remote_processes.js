import processes from 'processes/processes.js';

// Everything running on one machine, through the Processes module: its API is this host's
// /api/v1/remotes/<name>/processes, where the machine's agent runs ps. A machine not seen yet,
// or one whose agent is older than the list, gets a note here instead.
const remote_processes = {
    template: `
<article v-if="(view.machine === null)" id="detail" class="procs-pane">
    <p class="muted">This machine has not connected since serviceman last started, so what its agent can do is not known yet. A running agent dials in by itself; the Install tab has the command for a machine without one.</p>
</article>
<article v-else-if="(able === false)" id="detail" class="procs-pane">
    <p class="muted">The agent on this machine is from before the process list, so what it is running cannot be read yet.</p>
    <p class="muted">It updates itself within a minute or two of being connected; the Overview says when it refuses, and why.</p>
</article>
<processes v-else id="detail" :base="base" :offline="(view.phase !== 'online')" :connected_at="view.connected_at" :cores="cores"/>
`,
    components: {processes},
    props: ['view'],
    computed: {
        base: function () {
            return `/api/v1/remotes/${encodeURIComponent(this.view.name)}/processes`;
        },
        // An old agent updates itself while this pane is open; the list then opens by itself
        able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('proc_list');
        },
        cores: function () {
            const machine = this.view.machine;
            return ((machine === null) || !machine.cpu) ? 1 : Math.max(1, machine.cpu.count);
        },
    },
};

export default remote_processes;
