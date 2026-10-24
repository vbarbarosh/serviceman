// The disks of one machine, under whatever base the host mounts it at. The host gives
// `read()`, which asks the machine and answers {at, items, commands}: one item a mount,
// {device, type, mounts, disk, total, used, free, inodes_total, inodes_used, inodes_free,
// encrypted, key_of}. It is read when asked and kept nowhere.
//
// And `usage({path, extras})`, what takes the space in one folder of that machine, counted on
// that one disk: {path, total, files, folders: [{path, size}], unread: [path], took_ms, extras}.
// files is what lies in the folder itself, unread what could not be read; extras, when asked,
// what docker and the journal keep, which the folders do not always show. And
// `usage_progress({path})`, how such a count goes while it runs: {path, counting, took_ms,
// folders: [{path, size}], waiting, waiting_shown: [path]}.
//
//     options = {read, usage, usage_progress, tail}
async function disks_serve(req, res, options)
{
    const tail = options.tail;
    try {
        // GET <base>
        if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
            send_json(res, 200, await options.read());
            return;
        }
        // GET <base>/usage?path=/var&extras=1
        // GET <base>/usage/progress?path=/var
        const door = tail.split('?')[0];
        const usage = (door === '/usage') ? options.usage : ((door === '/usage/progress') ? options.usage_progress : undefined);
        if ((usage !== undefined) && (req.method === 'GET')) {
            const query = new URL(req.url, 'http://host').searchParams;
            const asked = query.get('path');
            if ((asked === null) || (asked.startsWith('/') === false)) {
                send_json(res, 400, {error: 'path: the folder to count, from the root: /var'});
                return;
            }
            send_json(res, 200, await usage((door === '/usage') ? {path: asked, extras: (query.get('extras') === '1')} : {path: asked}));
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

module.exports = disks_serve;
