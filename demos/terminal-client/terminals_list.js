// The terminals kept running on a machine: GET /api/v1/remotes/<remote>/terminals on the
// control port. Each item is {name, created_at, attached, command}: `attached` counts who has
// it open, `command` joins it by hand.
//
//     options = {url, remote}
//     url      the control port, http://127.0.0.1:8081 by default
async function terminals_list(options)
{
    const url = new URL(`/api/v1/remotes/${encodeURIComponent(options.remote)}/terminals`, options.url);
    const answer = await fetch(url, {headers: {accept: 'application/json'}});
    const body = await answer.json();
    if (answer.ok === false) {
        throw new Error(body.error);
    }
    return body;
}

module.exports = terminals_list;
