// The critical CVEs of one machine, under whatever base the host mounts it at. The host gives
// `read()`, which answers {at, reason, codename, kernel, list, items, commands}: one item a CVE,
// {id, score, published, description, url, state, what, fix, new, found_at, fix_at, stopgap,
// pending}, as its last look found them (vulnerabilities_match, and the host's notes of what
// is new). reason says why there are no items to say, items then null.
//
//     options = {read, tail}
async function vulnerabilities_serve(req, res, options)
{
    const tail = options.tail;
    try {
        // GET <base>
        if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
            send_json(res, 200, await options.read());
            return;
        }
        send_json(res, 404, {error: `no such door: ${tail}`});
    }
    catch (error) {
        send_json(res, (error.status === undefined) ? 502 : error.status, {error: error.message});
    }
}

function send_json(res, status, value)
{
    if (res.headersSent) {
        return;
    }
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify(value, null, 4));
}

module.exports = vulnerabilities_serve;
