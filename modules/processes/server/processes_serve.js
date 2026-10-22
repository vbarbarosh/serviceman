// Everything running on one machine, under whatever base the host mounts it at. The host
// gives `read()`, which asks the machine and answers {at, items, commands, cpu_window_ms}: one
// item a process, {pid, ppid, user, cpu, mem, rss, elapsed_ms, state, command}. It is read
// when asked and kept nowhere.
//
//     options = {read, tail}
async function processes_serve(req, res, options)
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

module.exports = processes_serve;
