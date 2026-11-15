// Where a new agent dials serviceman: its own name on the tailnet, at the control port, where
// tailscale has given it one; else the address this page was opened on, which no other machine
// may reach (serviceman.localhost), left for the person to change
function agent_url_of(tailnet, port)
{
    if ((typeof tailnet === 'string') && (tailnet !== '') && (port !== null) && (port !== undefined)) {
        return `http://${tailnet}:${port}`;
    }
    return `${location.protocol}//${location.host}`;
}

export default agent_url_of;
