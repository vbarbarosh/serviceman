// The address of Logline's viewer showing only the lines of one machine or one service, live
// over the last day; null where serviceman is not told where the viewer is (`ui` of `logline`
// in the config).
//
// A machine's lines carry its name as `remote`. A service's carry its name as `service` — and
// lines from before the agent said so carry the container's name, serviceman-<name>, which is
// asked for beside it: two values of one label are either of them, and two labels are both.
//
// `remotes` are the machines a service runs on, as its config names them: its link shows the
// lines those machines sent and no other's, since `service` is a label a machine writes as it
// likes, and `remote` the one Logline writes from the machine's token. A `#tag` names a kind of
// machine, not one, and narrows nothing; a service with no machine runs here, and its lines
// are the host's own.
function logline_link(logline, kind, name, remotes = [])
{
    if ((logline === null) || (logline === undefined) || !logline.ui) {
        return null;
    }
    const url = new URL(logline.ui, window.location.href);
    url.searchParams.append('label', `${kind}:${name}`);
    if (kind === 'service') {
        url.searchParams.append('label', `service:serviceman-${name}`);
        for (const remote of remotes) {
            if (remote.startsWith('#') === false) {
                url.searchParams.append('label', `remote:${remote}`);
            }
        }
    }
    url.searchParams.set('range', '24h');
    return url.toString();
}

export default logline_link;
