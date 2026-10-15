// Where a forward shows up on serviceman itself, as a person types it: `3100` is a port on its
// loopback, `sockets/loki.sock` a socket file inside its state dir. Answers with the end as the
// config holds it, or with a sentence saying what is wrong — the server says the same.
function forward_here_parse(text)
{
    const said = text.trim();
    if (/^\d+$/.test(said)) {
        return {here: true, port: Number(said)};
    }
    if (/^[A-Za-z0-9._-]+:\d+$/.test(said)) {
        return 'a port or a socket here: it listens on its loopback, not on an address';
    }
    if (said.startsWith('/') || said.startsWith('~')) {
        return 'a path inside serviceman\'s state dir, written from it: sockets/loki.sock';
    }
    if ((said.length > 100) || (said.split('/').every(v => (v !== '') && (v !== '.') && (v !== '..')) === false)) {
        return 'a path that stays inside serviceman\'s state dir, with no .. in it, of at most 100 characters';
    }
    return {here: true, socket: said};
}

export default forward_here_parse;
