const http = require('http');
const net = require('net');

// How long a peer has to answer before it counts as not there, and how long one that was not
// there is not asked again: serviceman's links carry the streams meanwhile
const ANSWER_MS = 3000;
const AWAY_MS = 30000;

// The upgrade a stream is asked with, beside a websocket's on the same port
const STREAM_UPGRADE = 'serviceman-stream';

// The peers that did not answer lately, by address and port: {'100.64.0.20:7303': until_ms}
const away = {};

// A stream to another machine's agent, straight over the tailnet, for a forward or a mount of
// this machine whose far end is there: asked with the token serviceman gave that machine, it is
// joined there to the service or the folder (agent_peer_serve), and is a socket here once that
// end is open. Its addresses are tried in turn.
//
//     peer    {addresses, port, token}, as serviceman told it
//     kind    'forward' or 'mount'
//     name    the forward's or the mount's name
//
// Throws with `code` EPEERREFUSED when the peer was reached and the service there refused, with
// its reason; EPEERAWAY when no address answered as an agent of this fleet — the caller then goes
// through serviceman, as before.
async function agent_peer_stream(peer, kind, name)
{
    let last = null;
    for (const host of peer.addresses) {
        const where = `${host}:${peer.port}`;
        if ((away[where] !== undefined) && (away[where] > Date.now())) {
            last = `${where} did not answer lately`;
            continue;
        }
        try {
            return await ask(host, peer, kind, name);
        }
        catch (error) {
            if (error.code === 'EPEERREFUSED') {
                throw error;
            }
            if (error.reached !== true) {
                away[where] = Date.now() + AWAY_MS;
            }
            last = `${where}: ${error.message}`;
        }
    }
    throw failure('EPEERAWAY', (last === null) ? 'the peer said nowhere it listens' : last, false);
}

// One address asked: the socket once the peer says 101, or thrown. A peer that answers anything
// else was reached (`reached`), and is asked again next time: a table not told yet, say.
function ask(host, peer, kind, name)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({
            host,
            port: peer.port,
            path: `/${kind}/${encodeURIComponent(name)}`,
            headers: {'connection': 'Upgrade', 'upgrade': STREAM_UPGRADE, 'x-serviceman-peer': peer.token},
            agent: false,
            // Half open, as the forward's own listener is: either end may say it is done and
            // still be sent the answer
            createConnection: function (options) {
                return net.connect({host: options.host, port: options.port, allowHalfOpen: true});
            },
        });
        const timer = setTimeout(function () {
            req.destroy(new Error(`no answer within ${ANSWER_MS/1000} s`));
        }, ANSWER_MS);
        req.on('upgrade', function (res, socket, head) {
            clearTimeout(timer);
            if (head.length > 0) {
                socket.unshift(head);
            }
            resolve(socket);
        });
        req.on('response', function (res) {
            clearTimeout(timer);
            let text = '';
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                text = (text + chunk).slice(0, 1000);
            });
            res.on('end', function () {
                const reason = (text === '') ? `${res.statusCode} ${http.STATUS_CODES[res.statusCode]}` : text;
                reject(failure((res.statusCode === 502) ? 'EPEERREFUSED' : 'EPEERAWAY', reason, true));
            });
        });
        req.on('error', function (error) {
            clearTimeout(timer);
            reject(failure('EPEERAWAY', error.message, false));
        });
        req.end();
    });
}

function failure(code, message, reached)
{
    return Object.assign(new Error(message), {code, reached});
}

agent_peer_stream.STREAM_UPGRADE = STREAM_UPGRADE;

module.exports = agent_peer_stream;
