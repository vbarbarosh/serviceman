const BODY_LIMIT_BYTES = 64*1024;

const RE_CANCEL = /^\/([0-9a-f]+)\/cancel$/;

// The copies between disks, under whatever base the host mounts them at: what is under way,
// a new copy, a copy given up, and the list cleared of what is over. The host gives the queue
// (transfer_queue) and says which disk names there are; who may ask is the host's business.
//
//     options = {queue, tail, disk_known}
//     disk_known(name)   whether a disk of that name is one a copy may name
async function file_manager_transfers_serve(req, res, options)
{
    const url = new URL(req.url, 'http://file-manager.invalid');
    const tail = options.tail;
    const queue = options.queue;
    // GET <base>
    if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
        send_json(res, 200, {items: queue.items.map(item_view)});
        return;
    }
    // POST <base> (body)
    if (((tail === '') || (tail === '/')) && (req.method === 'POST')) {
        let body;
        try {
            body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
        }
        catch (error) {
            send_json(res, 400, {error: error.message});
            return;
        }
        const from = (((body === null) || (typeof body.from !== 'object') || (body.from === null)) ? {} : body.from);
        const to = (((body === null) || (typeof body.to !== 'object') || (body.to === null)) ? {} : body.to);
        if ((options.disk_known(from.disk) === false) || (typeof from.path !== 'string') || (from.path === '')) {
            send_json(res, 400, {error: 'a copy comes from a file of a disk: from.disk, from.path'});
            return;
        }
        if ((options.disk_known(to.disk) === false) || (typeof to.dir !== 'string') || (to.dir.trim() === '')) {
            send_json(res, 400, {error: 'a copy goes into a folder of a disk: to.disk, to.dir'});
            return;
        }
        send_json(res, 200, item_view(queue.add(from, {disk: to.disk, dir: to.dir.trim()})));
        return;
    }
    // POST <base>/<id>/cancel
    const cancel = RE_CANCEL.exec(tail);
    if ((cancel !== null) && (req.method === 'POST')) {
        if (queue.cancel(cancel[1]) === false) {
            send_json(res, 404, {error: `no copy ${cancel[1]}`});
            return;
        }
        send_json(res, 200, {});
        return;
    }
    // POST <base>/clear
    if ((tail === '/clear') && (req.method === 'POST')) {
        queue.clear();
        send_json(res, 200, {});
        return;
    }
    send_json(res, 404, {error: `no such door: ${url.pathname}`});
}

// A copy as the page sees it: no timers, no flags of the queue's own. `ms` is how long it has
// run, on this host's clock, so a page with a clock of its own can still tell the rate.
function item_view(item)
{
    return {
        id: item.id,
        from: item.from,
        to: item.to,
        name: item.name,
        size: item.size,
        received: item.received,
        began_at: item.began_at,
        ms: ((item.began_ms === null) ? 0 : Date.now() - item.began_ms),
        phase: item.phase,
        said: item.said,
        wait_s: item.wait_s,
        path: item.path,
    };
}

// A small request body; a body above the limit is refused, not buffered
function body_read(req, limit_bytes)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (chunk) {
            size += chunk.length;
            if (size > limit_bytes) {
                reject(new Error(`the body is above ${limit_bytes} bytes`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

function send_json(res, status, value)
{
    const text = JSON.stringify(value, null, 4);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
    });
    res.end(text);
}

module.exports = file_manager_transfers_serve;
