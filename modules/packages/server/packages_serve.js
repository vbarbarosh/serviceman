// The doors of the upgrade's run: the option each one asks, and the status of its answer
const RUN_DOORS = {
    'POST /upgrade': {option: 'upgrade', status: 202},
    'GET /upgrade': {option: 'run', status: 200},
    'POST /cancel': {option: 'cancel', status: 200},
};

// The packages of one machine, under whatever base the host mounts it at. The host gives
// `read()`, which asks the machine and answers {at, items, manual_known, updates_known,
// commands}: one item a package, {name, arch, version, size, section, summary, manual, held,
// broken, update}. It is read when asked and kept nowhere.
//
// Installing what waits is a run of minutes, which the host keeps: `upgrade()` starts it and
// answers at once, `run()` is how it goes ({phase, lines, started_at, ended_at, error}), read
// back while it does, and `cancel()` stops it. A host that installs nothing leaves them out.
// Each throws an error with the status to answer for what it refuses.
//
//     options = {read, upgrade, run, cancel, tail}
async function packages_serve(req, res, options)
{
    const tail = options.tail;
    try {
        // GET <base>
        if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
            send_json(res, 200, await options.read());
            return;
        }
        // POST <base>/upgrade
        // GET <base>/upgrade
        // POST <base>/cancel
        const run = RUN_DOORS[`${req.method} ${tail}`];
        if (run !== undefined) {
            if (options[run.option] === undefined) {
                send_json(res, 501, {error: 'updates are not installed from here'});
                return;
            }
            send_json(res, run.status, await options[run.option]());
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

module.exports = packages_serve;
