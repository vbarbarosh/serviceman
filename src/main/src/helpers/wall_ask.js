const http = require('http');
const pool_acquire = require('./pool_acquire');
const pool_release = require('./pool_release');
const service_ensure_running = require('./service_ensure_running');

// authwall's own door for this: the proxy in front asks, the wall answers, and nothing is
// proxied through it at all. That is what lets one wall stand in front of every name there is —
// it never has to know where any of them lead.
const SIDECAR_PATH = '/auth/sidecar';
// Where a visitor who is not signed in is sent. It is on the name they asked for, so the wall
// has to answer `/auth/…` there too — which is what the rule does, by sending that path to it.
const SIGN_IN_PATH = '/auth/sign-in';
// A wall that does not answer in this is a wall that is not answering
const ASK_MS = 10000;

// Whether the wall lets this request through, in the wall's own words: the visitor's cookie
// and where they were going, and no body at all. 200 is a yes and says who they are; 401 is a
// no; anything else is a wall that cannot be asked, which is a no as well — a door nobody can
// ask is not one to leave open.
async function wall_ask(app, wall, req, host)
{
    await service_ensure_running(app, wall);
    const instance = await pool_acquire(app, wall, Date.now() + ASK_MS);
    try {
        return await asked(instance, req, host);
    }
    finally {
        pool_release(app, wall, instance);
    }
}

wall_ask.sign_in = function (req) {
    return `${SIGN_IN_PATH}?return=${encodeURIComponent(req.url)}`;
};

// Whether this is the wall's own business rather than the service's: its sign-in page, its
// callbacks, whatever else it keeps under there
wall_ask.own = function (pathname) {
    return (pathname === '/auth') || pathname.startsWith('/auth/');
};

// A wall that cannot be reached at all — its machine's link is down — is a no like any other,
// said here rather than thrown: the pool opens its stream as the request is made
function asked(instance, req, host)
{
    return new Promise(function (resolve) {
        try {
            ask_now(instance, req, host, resolve);
        }
        catch {
            resolve({ok: false, user: ''});
        }
    });
}

function ask_now(instance, req, host, resolve)
{
    const options = {
        host: instance.upstream.host,
        port: instance.upstream.port,
        method: 'GET',
        path: SIDECAR_PATH,
        agent: instance.agent,
        headers: {
            host,
            cookie: (req.headers.cookie === undefined) ? '' : req.headers.cookie,
            'x-real-ip': (req.socket.remoteAddress === undefined) ? '' : req.socket.remoteAddress,
            'x-original-uri': `${scheme_of(req)}://${host}${req.url}`,
            'x-original-method': req.method,
            'content-length': '0',
        },
    };
    const asking = http.request(options, function (answer) {
        answer.resume();
        resolve({ok: (answer.statusCode === 200), user: (answer.headers['x-auth-user'] === undefined) ? '' : answer.headers['x-auth-user']});
    });
    asking.setTimeout(ASK_MS, function () {
        asking.destroy();
    });
    asking.on('error', function () {
        resolve({ok: false, user: ''});
    });
    asking.end();
}

// What the visitor spoke, for the address the wall sends them back to. Whatever stands in front
// of that machine wrote it down; this host answers http and would say so of every visitor.
function scheme_of(req)
{
    const said = req.headers['x-forwarded-proto'];
    if ((typeof said === 'string') && (said !== '')) {
        return said.split(',')[0].trim();
    }
    return 'http';
}

module.exports = wall_ask;
