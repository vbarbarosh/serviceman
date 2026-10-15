// One end of a forward as a person types it: `3100` is a port on that machine's loopback,
// `/run/app.sock` or `~/app.sock` a socket file, and `10.0.0.5:3100` an address that machine
// reaches. Answers with the end as the config holds it, or with a sentence saying what is wrong.
function forward_end_parse(remote, text)
{
    const said = text.trim();
    if (/^\d+$/.test(said)) {
        return {remote, port: Number(said)};
    }
    if (said.startsWith('/') || said.startsWith('~/')) {
        return {remote, socket: said};
    }
    const found = /^([A-Za-z0-9._-]+):(\d+)$/.exec(said);
    if (found !== null) {
        return {remote, host: found[1], port: Number(found[2])};
    }
    return 'a port (3100), a socket file (~/app.sock), or an address and a port (10.0.0.5:3100)';
}

export default forward_end_parse;
