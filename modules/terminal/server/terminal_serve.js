const BODY_LIMIT_BYTES = 16*1024;

const RE_DOOR = /^\/([^/]+)\/(end|signal)$/;

// The kept terminals of one machine, under whatever base the host mounts it at: listed, made,
// signalled and ended. Joining one is terminal_attach, over a WebSocket. The host gives
// `call(method, params)`, which asks the machine (term_list, term_create, term_signal,
// term_end) and answers its value, or throws an error with the status to answer: whether the
// machine can, and whether it takes a name, an env or a folder, is the host's to say.
//
//     options = {call, tail}
async function terminal_serve(req, res, options)
{
    const tail = options.tail;
    try {
        // GET <base>
        if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
            send_json(res, 200, await options.call('term_list', {}));
            return;
        }
        // POST <base> {name, cols, rows, env, cwd}
        // One with no name is given the first number no terminal has
        if (((tail === '') || (tail === '/')) && (req.method === 'POST')) {
            const body = await body_json(req);
            const name = ((body.name === undefined) || (body.name === null)) ? await name_free(options) : body.name;
            send_json(res, 200, await options.call('term_create', {name, cols: body.cols, rows: body.rows, env: body.env, cwd: body.cwd}));
            return;
        }
        // POST <base>/<name>/end
        // POST <base>/<name>/signal {signal, to}
        // The × of a terminal's tab ends it: the shell is hung up, as closing a terminal window
        // does, and the terminal is gone at once. A signal goes to its shell (to: shell, the
        // default), or to what runs in it in front (to: foreground), which SIGINT stops as
        // Ctrl-C does.
        const door = RE_DOOR.exec(tail);
        if ((door !== null) && (req.method === 'POST')) {
            const name = decodeURIComponent(door[1]);
            if (door[2] === 'end') {
                send_json(res, 200, await options.call('term_end', {name}));
                return;
            }
            const body = await body_json(req);
            send_json(res, 200, await options.call('term_signal', {name, signal: body.signal, to: body.to}));
            return;
        }
        send_json(res, 404, {error: `no such door: ${tail}`});
    }
    catch (error) {
        send_json(res, (error.status === undefined) ? 502 : error.status, {error: error.message});
    }
}

async function name_free(options)
{
    const listed = await options.call('term_list', {});
    let n = 1;
    while (listed.items.some(v => v.name === String(n))) {
        n++;
    }
    return String(n);
}

function status_error(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
}

function body_json(req)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let bytes = 0;
        req.on('data', function (chunk) {
            bytes += chunk.length;
            if (bytes > BODY_LIMIT_BYTES) {
                reject(status_error(413, 'the body is too big'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                resolve(((parsed === null) || (typeof parsed !== 'object')) ? {} : parsed);
            }
            catch {
                reject(status_error(400, 'the body is not JSON'));
            }
        });
        req.on('error', reject);
    });
}

function send_json(res, status, value)
{
    if (res.headersSent) {
        return;
    }
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify(value, null, 4));
}

module.exports = terminal_serve;
