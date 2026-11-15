// A machine's name on the tailnet, as its agent read it from Tailscale: '' for a machine never
// seen, one off a tailnet, or one whose agent is too old to say
function tailnet_name_of(machine)
{
    if ((machine === null) || (machine === undefined) || (machine.tailnet === null) || (machine.tailnet === undefined) || (machine.tailnet.name === null)) {
        return '';
    }
    return machine.tailnet.name;
}

export default tailnet_name_of;
