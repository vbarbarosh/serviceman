// The calls on a machine's kept terminals that are not a socket: make one, signal one, end one.
// Each answers the JSON serviceman answers, or throws its error.
//
//     terminal_call({url, remote}, 'create', {name, cols, rows})   → {name, created}
//     terminal_call({url, remote}, 'signal', {name, signal, to})   → {name, signal, to, pid | pgid}
//     terminal_call({url, remote}, 'end', {name})                  → {ended}
async function terminal_call(options, action, params)
{
    const base = `/api/v1/remotes/${encodeURIComponent(options.remote)}/terminals`;
    const path = ((action === 'create') ? base : `${base}/${encodeURIComponent(params.name)}/${action}`);
    const answer = await fetch(new URL(path, options.url), {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(params)});
    const body = await answer.json();
    if (answer.ok === false) {
        throw new Error(body.error);
    }
    return body;
}

module.exports = terminal_call;
