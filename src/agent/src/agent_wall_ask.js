const http = require('http');

// authwall's own door for this: the door asks, the wall answers, and nothing is carried
// through it at all
const SIDECAR_PATH = '/auth/sidecar';
// A wall that does not answer in this is a wall that is not answering
const ASK_MS = 10000;

// Whether the wall lets this request through: {said: 'yes', user}, {said: 'no'}, or
// {said: 'unreachable'} for a wall that could not be asked — which is never a yes. 200 is a yes
// and says who the visitor is; 401 and 403 are a no; anything else is a wall that did not
// answer the question.
function agent_wall_ask(target, req, host, extra)
{
    return new Promise(function (resolve) {
        const headers = Object.assign({
            host,
            cookie: (req.headers.cookie === undefined) ? '' : req.headers.cookie,
            'x-real-ip': client_of(req),
            'x-original-uri': `${scheme_of(req)}://${host}${req.url}`,
            'x-original-method': req.method,
            'content-length': '0',
        }, extra);
        const asking = http.request({host: target.host, port: target.port, method: 'GET', path: SIDECAR_PATH, headers, agent: false}, function (answer) {
            answer.resume();
            if (answer.statusCode === 200) {
                resolve({said: 'yes', user: String(answer.headers['x-auth-user'] || '')});
                return;
            }
            resolve({said: [401, 403].includes(answer.statusCode) ? 'no' : 'unreachable'});
        });
        asking.setTimeout(ASK_MS, function () {
            asking.destroy(new Error('the wall did not answer in time'));
        });
        asking.on('error', function () {
            resolve({said: 'unreachable'});
        });
        asking.end();
    });
}

agent_wall_ask.sign_in = function (req) {
    return `/auth/sign-in?return=${encodeURIComponent(req.url)}`;
};

// Whether this is the wall's own business: its sign-in page, its callbacks, whatever else it
// keeps under /auth
agent_wall_ask.own = function (url) {
    const mark = url.indexOf('?');
    const pathname = (mark === -1) ? url : url.slice(0, mark);
    return (pathname === '/auth') || pathname.startsWith('/auth/');
};

// Who is asking, as the server in front wrote it down: this door is a file, so the socket
// itself says nothing about the visitor
function client_of(req)
{
    const forwarded = req.headers['x-forwarded-for'];
    if ((typeof forwarded === 'string') && (forwarded !== '')) {
        return forwarded.split(',')[0].trim();
    }
    return String(req.headers['x-real-ip'] || '');
}

function scheme_of(req)
{
    const said = req.headers['x-forwarded-proto'];
    if ((typeof said === 'string') && (said !== '')) {
        return said.split(',')[0].trim();
    }
    return 'http';
}

module.exports = agent_wall_ask;
