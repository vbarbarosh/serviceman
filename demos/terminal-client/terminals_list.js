// The terminals kept running on a machine: GET /api/v1/remotes/<remote>/terminals on the
// control port. Each item is {name, created_at, attached, command}: `attached` counts who has
// it open, `command` joins it by hand.
//
//     options = {url, remote, token}
//     url      the control port, http://127.0.0.1:8081 by default
//     token    the owner's token, sent as Authorization: Bearer; without one serviceman answers 401
//
// An error thrown carries the answer's `status`.
async function terminals_list(options)
{
    const url = new URL(`/api/v1/remotes/${encodeURIComponent(options.remote)}/terminals`, options.url);
    const headers = {accept: 'application/json'};
    if ((typeof options.token === 'string') && (options.token !== '')) {
        headers.authorization = `Bearer ${options.token}`;
    }
    const answer = await fetch(url, {headers});
    const body = await answer.json();
    if (answer.ok === false) {
        throw Object.assign(new Error(body.error), {status: answer.status});
    }
    return body;
}

module.exports = terminals_list;
