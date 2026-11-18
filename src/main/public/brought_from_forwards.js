// The forwards that are part of a program, as its card "Its port on another machine" holds them:
// the port it listens on, and each machine that port is brought to, as a socket file or a port.
// What the card cannot write is kept as written and goes back as it was: a forward from a socket
// file, from an address the machine reaches, or from another port than the first one.
//
//     forwards  the config file's forwards whose `service` is the program, as the file has them
//
// Gives {port, targets: [{key, remote, kind, socket, port, original}], kept: [forward]}: `port`
// and the targets' boxes as text, `remote` the machine's name or null for this host, where
// serviceman runs (`to.here`), `kind` 'socket' or 'port', `original` the forward it was read from
function brought_from_forwards(forwards)
{
    const out = {port: '', targets: [], kept: []};
    for (const forward of forwards) {
        const port = port_from_forward(forward);
        if ((port === '') || ((out.targets.length > 0) && (port !== out.port))) {
            out.kept.push(forward);
            continue;
        }
        out.port = port;
        out.targets.push({
            key: forward.label,
            remote: (forward.to.here === true) ? null : forward.to.remote,
            kind: (forward.to.socket === undefined) ? 'port' : 'socket',
            socket: (forward.to.socket === undefined) ? '' : forward.to.socket,
            port: (forward.to.port === undefined) ? '' : String(forward.to.port),
            original: forward,
        });
    }
    return out;
}

// The port a forward brings over from the loopback of its program's machine, as the card shows
// it, or '' for a forward the card cannot write
function port_from_forward(forward)
{
    const from = forward.from;
    const to = forward.to;
    if ((from === null) || (typeof from !== 'object') || (to === null) || (typeof to !== 'object')) {
        return '';
    }
    if ((Number.isInteger(from.port) === false) || (from.host !== undefined) || (from.socket !== undefined)) {
        return '';
    }
    // A machine of its own, or serviceman itself, and on it a socket file or a port
    const place = (to.here === undefined) ? (typeof to.remote === 'string') : ((to.here === true) && (to.remote === undefined));
    if ((place === false) || (to.host !== undefined) || ((to.socket === undefined) === (to.port === undefined))) {
        return '';
    }
    return String(from.port);
}

export default brought_from_forwards;
