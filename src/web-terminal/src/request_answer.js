const caller_allowed = require('./caller_allowed');
const fs = require('fs');
const path = require('path');
const session_name_from_path = require('./session_name_from_path');
const sessions_list = require('./sessions_list');
const sign_in_page = require('./sign_in_page');

// The page's own files under /_/, from where they sit in the serviceman repo
const DIRS = {
    app: path.resolve(__dirname, '../public'),
    terminal: path.resolve(__dirname, '../../../modules/terminal/ui'),
    vendor: path.resolve(__dirname, '../../main/public/vendor'),
};

const TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
};

const BODY_LIMIT_BYTES = 16*1024;
// A year: the page stays signed in until the token changes
const COOKIE_MAX_AGE_S = 365*24*60*60;

// GET /_/{app,terminal,vendor}/:file   the page's own files, open to anyone: no secret in them
// POST /_/session (body)               the token, once: {token}; the answer is the cookie
// GET /_/sessions                      the kept sessions, with the token
// GET /, GET /:name                    the page, with the token; its websocket opens on the same path
//
// A terminal is a shell for whoever reaches it, so everything but the page's files wants the
// token: a browser without it gets the sign-in form, a program a 401.
async function request_answer(req, res, token)
{
    const pathname = new URL(req.url, 'http://web-terminal.invalid').pathname;
    const match = /^\/_\/(app|terminal|vendor)\/([a-z0-9_-][a-z0-9_.-]*)$/.exec(pathname);
    if ((match !== null) && (req.method === 'GET')) {
        file_send(res, path.join(DIRS[match[1]], match[2]));
        return;
    }
    if ((pathname === '/_/session') && (req.method === 'POST')) {
        await session_open(req, res, token);
        return;
    }
    if (req.method !== 'GET') {
        send(res, 405, 'text/plain; charset=utf-8', 'GET only\n');
        return;
    }
    if (caller_allowed(req, token) === false) {
        if (pathname === '/_/sessions') {
            send(res, 401, 'application/json', JSON.stringify({error: 'the token goes as Authorization: Bearer <token>, or once on the page'}));
            return;
        }
        send(res, 401, 'text/html; charset=utf-8', sign_in_page());
        return;
    }
    if (pathname === '/_/sessions') {
        send(res, 200, 'application/json', JSON.stringify({sessions: await sessions_list()}));
        return;
    }
    if (session_name_from_path(pathname) === null) {
        send(res, 404, 'text/plain; charset=utf-8', 'no session has that name: lowercase letters, digits, - and _, one word after /\n');
        return;
    }
    file_send(res, path.join(DIRS.app, 'index.html'));
}

// The token goes once, in a POST; the answer is a cookie only this page's own requests carry,
// never read by a script, and never over plain http once the page came over https
async function session_open(req, res, token)
{
    let body;
    try {
        body = JSON.parse(await body_read(req));
    }
    catch (error) {
        send(res, 400, 'application/json', JSON.stringify({error: error.message}));
        return;
    }
    const given = ((body !== null) && (typeof body === 'object') && (typeof body.token === 'string')) ? body.token.trim() : '';
    if (caller_allowed({headers: {authorization: `Bearer ${given}`}}, token) === false) {
        send(res, 401, 'application/json', JSON.stringify({error: 'That is not the token'}));
        return;
    }
    const proto = String((req.headers['x-forwarded-proto'] === undefined) ? '' : req.headers['x-forwarded-proto']).split(',')[0].trim();
    const secure = (req.socket.encrypted === true) || (proto === 'https');
    res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'set-cookie': `${caller_allowed.COOKIE}=${encodeURIComponent(given)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`,
    });
    res.end('{}');
}

// The body as text, or a refusal above the limit: a token is one line
function body_read(req)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let length = 0;
        req.on('data', function (chunk) {
            length += chunk.length;
            if (length > BODY_LIMIT_BYTES) {
                reject(new Error(`the body is over ${BODY_LIMIT_BYTES} bytes`));
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

function file_send(res, file)
{
    fs.readFile(file, function (error, body) {
        if (error) {
            send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
            return;
        }
        send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', body);
    });
}

function send(res, status, type, body)
{
    res.writeHead(status, {'content-type': type, 'cache-control': 'no-store'});
    res.end(body);
}

module.exports = request_answer;
