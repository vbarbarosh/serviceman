// The calls on a machine's kept terminals that are not a socket: make one, signal one, end one.
// Each answers the JSON serviceman answers, or throws its error with the answer's `status`.
// `token` is the owner's, sent as Authorization: Bearer; without one serviceman answers 401.
//
//     terminal_call({url, remote, token}, 'create', {name, cols, rows})   → {name, created}
//     terminal_call({url, remote, token}, 'signal', {name, signal, to})   → {name, signal, to, pid | pgid}
//     terminal_call({url, remote, token}, 'end', {name})                  → {ended}
async function terminal_call(options, action, params)
{
    const base = `/api/v1/remotes/${encodeURIComponent(options.remote)}/terminals`;
    const path = ((action === 'create') ? base : `${base}/${encodeURIComponent(params.name)}/${action}`);
    const headers = {'content-type': 'application/json'};
    if ((typeof options.token === 'string') && (options.token !== '')) {
        headers.authorization = `Bearer ${options.token}`;
    }
    const answer = await fetch(new URL(path, options.url), {method: 'POST', headers, body: JSON.stringify(params)});
    const body = await answer.json();
    if (answer.ok === false) {
        throw Object.assign(new Error(body.error), {status: answer.status});
    }
    return body;
}

module.exports = terminal_call;
