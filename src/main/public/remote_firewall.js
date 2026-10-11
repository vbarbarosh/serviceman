import firewall from 'firewall/firewall.js';

// The firewall of one machine and the ports it listens on, through the Firewall module: its API
// is this host's /api/v1/remotes/<name>/firewall, which runs ufw as root through the machine's
// agent
const remote_firewall = {
    template: `
<firewall id="detail" class="list" :base="base" :offline="(view.phase !== 'online')" :addresses="addresses" stays="serviceman still reaches it: its agent dials out."/>
`,
    components: {firewall},
    props: ['view'],
    computed: {
        base: function () {
            return `/api/v1/remotes/${encodeURIComponent(this.view.name)}/firewall`;
        },
        // How far a port on every address reaches depends on what the machine's addresses are
        addresses: function () {
            const machine = this.view.machine;
            return (((machine === null) || (machine.addresses === undefined)) ? null : machine.addresses);
        },
    },
};

export default remote_firewall;
