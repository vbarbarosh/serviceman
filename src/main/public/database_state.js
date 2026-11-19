// How a database server stands, as a row and a page say it: {word, dot, pill, bad, detail}, the
// word with its dot and its pill's colour, bad when it needs you, and what a row's Detail says:
// what it is doing while it comes up, why it failed, that its machine is away
function database_state(server)
{
    if (server.phase === 'starting') {
        return {word: 'coming up', dot: 'starting', pill: 'waiting', bad: false, detail: server.said || ''};
    }
    if (server.phase === 'failed') {
        return {word: 'failed', dot: 'failed', pill: 'failed', bad: true, detail: server.error || ''};
    }
    if (server.phase === 'removing') {
        return {word: 'being removed', dot: 'stopping', pill: '', bad: false, detail: ''};
    }
    if (server.online === false) {
        return {word: 'machine offline', dot: 'failed', pill: 'failed', bad: true, detail: `${server.title} is offline: its databases show once it is back`};
    }
    return {word: 'running', dot: 'running', pill: 'running', bad: false, detail: ''};
}

export default database_state;
