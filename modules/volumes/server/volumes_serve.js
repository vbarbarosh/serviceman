const BODY_LIMIT_BYTES = 16*1024;

const RE_DOOR = /^\/([a-z0-9][a-z0-9-]{0,39})\/(open|close|grow|delete)$/;
const LOGGED = {create: 'volume_created', open: 'volume_opened', close: 'volume_closed', grow: 'volume_grown', delete: 'volume_deleted'};

// The encrypted volumes of one machine, under whatever base the host mounts it at. The host
// gives `call(params)`, which asks the machine's root half and answers its value: a volume or
// the list, or {ok: false, status, error} for a refusal. `key_safe` says whether this request
// came over a link a key may travel on; open and create carry one and are refused otherwise.
//
//     options = {call, key_safe, tail, log}
async function volumes_serve(req, res, options)
{
    const log = ((options.log === undefined) ? function () {} : options.log);
    const tail = options.tail;
    try {
        // GET <base>
        if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
            answer_send(res, await options.call({action: 'list', look: true}));
            return;
        }
        // POST <base> {name, owner, target, size, key, passphrase, plain_remove}
        if (((tail === '') || (tail === '/')) && (req.method === 'POST')) {
            const body = await body_json(req);
            await action_serve(res, options, log, Object.assign(fields_of(body, ['name', 'owner', 'target', 'size', 'key', 'passphrase', 'plain_remove']), {action: 'create'}));
            return;
        }
        // POST <base>/<name>/open {key}
        // POST <base>/<name>/close
        // POST <base>/<name>/grow {size}
        // POST <base>/<name>/delete
        const door = RE_DOOR.exec(tail);
        if ((door !== null) && (req.method === 'POST')) {
            const body = await body_json(req);
            await action_serve(res, options, log, Object.assign(fields_of(body, ['key', 'size']), {action: door[2], name: door[1]}));
            return;
        }
        send_json(res, 404, {error: `no such door: ${tail}`});
    }
    catch (error) {
        send_json(res, ((error.status === undefined) ? 502 : error.status), {error: error.message});
    }
}

async function action_serve(res, options, log, params)
{
    if ((params.key !== undefined) && (options.key_safe !== true)) {
        send_json(res, 403, {code: 'key_not_safe', error: 'a key is taken only over https or from this machine'});
        return;
    }
    const value = await options.call(params);
    if (value.ok !== false) {
        log(LOGGED[params.action], Object.assign({name: value.name, owner: value.owner}, ((params.action === 'grow') ? {size: value.size} : {}), ((value.already === true) ? {already: true} : {})));
    }
    answer_send(res, value);
}

// Only the fields a door takes: nothing else of a body goes to the machine
function fields_of(body, names)
{
    const out = {};
    for (const name of names) {
        if (body[name] !== undefined) {
            out[name] = body[name];
        }
    }
    return out;
}

function answer_send(res, value)
{
    if (value.ok === false) {
        const refusal = Object.assign({}, value);
        delete refusal.ok;
        delete refusal.status;
        send_json(res, value.status, refusal);
        return;
    }
    const body = Object.assign({}, value);
    delete body.ok;
    send_json(res, 200, body);
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

module.exports = volumes_serve;
