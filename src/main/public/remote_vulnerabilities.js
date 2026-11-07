import vulnerabilities from 'vulnerabilities/vulnerabilities.js';

// The critical CVEs of one machine, through the Vulnerabilities module: its API is this host's
// /api/v1/remotes/<name>/vulnerabilities, which answers what the machine's last Security look
// found, held against Ubuntu's list. A machine not seen yet, or one whose agent is older than
// the check, gets a note here instead.
const remote_vulnerabilities = {
    template: `
<article v-if="(view.machine === null)" id="detail" class="list">
    <p class="muted">This machine has not connected since serviceman last started, so what its agent can do is not known yet. A running agent dials in by itself; the Install tab has the command for a machine without one.</p>
</article>
<article v-else-if="(able === false)" id="detail" class="list">
    <p class="muted">The agent on this machine is from before the CVE check, so what hits it cannot be said yet.</p>
    <p class="muted">It updates itself within a minute or two of being connected; the Configure tab says when it refuses, and why.</p>
</article>
<vulnerabilities v-else id="detail" class="list" :base="base" :offline="(view.phase !== 'online')" :connected_at="view.connected_at"/>
`,
    components: {vulnerabilities},
    props: ['view'],
    computed: {
        base: function () {
            return `/api/v1/remotes/${encodeURIComponent(this.view.name)}/vulnerabilities`;
        },
        // An old agent updates itself while this pane is open; the list then opens by itself
        able: function () {
            const machine = this.view.machine;
            return (machine !== null) && (machine.can !== null) && machine.can.includes('package_versions');
        },
    },
};

export default remote_vulnerabilities;
