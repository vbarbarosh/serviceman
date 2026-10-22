import disks from 'disks/disks.js';

// The disks of one machine, through the Disks module: its API is this host's
// /api/v1/remotes/<name>/disks, where the machine's agent runs df. A machine not seen yet, or
// one whose agent is older than the list, gets a note here instead.
const remote_disks = {
    template: `
<article v-if="(view.machine === null)" id="detail" class="list">
    <p class="muted">This machine has not connected since serviceman last started, so what its agent can do is not known yet. A running agent dials in by itself; the Install tab has the command for a machine without one.</p>
</article>
<article v-else-if="(able === false)" id="detail" class="list">
    <p class="muted">The agent on this machine is from before the disk list, so its disks cannot be read yet.</p>
    <p class="muted">It updates itself within a minute or two of being connected; the Overview says when it refuses, and why.</p>
</article>
<disks v-else id="detail" class="list" :base="base" :offline="(view.phase !== 'online')" :connected_at="view.connected_at"/>
`,
    components: {disks},
    props: ['view'],
    computed: {
        base: function () {
            return `/api/v1/remotes/${encodeURIComponent(this.view.name)}/disks`;
        },
        // An old agent updates itself while this pane is open; the list then opens by itself
        able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('disk_list');
        },
    },
};

export default remote_disks;
