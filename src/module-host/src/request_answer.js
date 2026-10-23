const crypto = require('crypto');
const fs = require('fs');
const machine_host = require('./machine_host');
const machine_read = require('./machine_read');
const modules_served = require('./modules_served');
const page_key = require('./page_key');
const path = require('path');
const request_allowed = require('./request_allowed');
const stream_read = require('../../main/src/helpers/stream_read');
const streams_of = require('../../main/src/helpers/streams_of');

// The page's own files, from where they sit in the serviceman repo; each module's page half
// is served under its key
const DIRS = {
    app: path.resolve(__dirname, '../public'),
    main: path.resolve(__dirname, '../../main/public'),
    vendor: path.resolve(__dirname, '../../main/public/vendor'),
};

const TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.mjs': 'text/javascript; charset=utf-8',
};

// The control page's files every module's tables are drawn with, and what they import: a
// module asks for them beside itself, as they are served on the control page
const SHARED = [
    '/command_copy.js',
    '/remote_shell.js',
    '/data_table.js',
    '/fold_table.js',
    '/format_bytes.js',
    '/format_count.js',
    '/format_ms.js',
    '/format_ms_ago.js',
    '/items_rows.js',
    '/items_view.js',
    '/module_kind.js',
    '/to_clipboard.js',
];

// GET /                         the page
// GET /api/modules              [{key, title, page}]
// GET /api/machine              {hostname, user, cores, addresses}
// GET /api/v1/modules           {modules}: each one's manifest and where it is mounted, as serviceman answers them
// GET /api/v1/streams (query)   the streams of lines kept now, a module's by its base
// GET /api/v1/streams/<id>      one of them, from its first line kept, then as it goes
// *   /api/<key>...             the module's API
// GET /_/{app,vendor,<key>}/:file, GET /_/serviceman.css, GET /<the files of SHARED>
//
// GET /?key=<key> puts the key in this browser and opens the page (request_allowed)
async function request_answer(req, res)
{
    if (request_allowed(req) === false) {
        send(res, 403, 'application/json', JSON.stringify({error: 'this is the page of the user who started module-host: open it at the address module-host printed, with its key'}));
        return;
    }
    const url = new URL(req.url, 'http://module-host.invalid');
    const pathname = url.pathname;
    if ((pathname === '/') && (req.method === 'GET') && url.searchParams.has('key')) {
        const held = Buffer.from(url.searchParams.get('key'));
        const key = Buffer.from(page_key());
        if ((held.length !== key.length) || (crypto.timingSafeEqual(held, key) === false)) {
            send(res, 403, 'text/plain; charset=utf-8', 'not the key module-host printed\n');
            return;
        }
        res.writeHead(303, {'location': '/', 'set-cookie': `${request_allowed.COOKIE}=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`, 'cache-control': 'no-store'});
        res.end();
        return;
    }
    if ((pathname === '/') && (req.method === 'GET')) {
        file_send(res, path.join(DIRS.app, 'index.html'));
        return;
    }
    if ((pathname === '/api/modules') && (req.method === 'GET')) {
        send(res, 200, 'application/json', JSON.stringify(modules_served.map(v => ({key: v.key, title: v.title, page: (v.page === undefined) ? `/_/${v.key}/${v.key}.js` : v.page}))));
        return;
    }
    // The items view draws a module's lists from its manifest, read here as on the control page
    if ((pathname === '/api/v1/modules') && (req.method === 'GET')) {
        send(res, 200, 'application/json', JSON.stringify({modules: modules_served.map(v => Object.assign({base: `/api/${v.key}`}, v.manifest))}));
        return;
    }
    if ((pathname === '/api/machine') && (req.method === 'GET')) {
        send(res, 200, 'application/json', JSON.stringify(machine_read()));
        return;
    }
    // A long command's lines, as serviceman keeps them: the page reads them at the url the
    // command answered, and finds its own again by the module's base after a reload
    if ((pathname === '/api/v1/streams') && (req.method === 'GET')) {
        const base = url.searchParams.get('base');
        const items = Array.from(streams_of(machine_host().app).values()).filter(v => (v.kind === 'lines') && ((base === null) || (v.base === base)));
        send(res, 200, 'application/json', JSON.stringify({items: items.map(v => ({id: v.id, url: v.url, title: v.title, base: v.base, command: v.command, item: v.item, started_at: v.started_at, ended_at: v.ended_at, state: v.state}))}));
        return;
    }
    const stream_asked = /^\/api\/v1\/streams\/([^/]+)$/.exec(pathname);
    if ((stream_asked !== null) && (req.method === 'GET')) {
        const stream = streams_of(machine_host().app).get(stream_asked[1]);
        if ((stream === undefined) || (stream.kind !== 'lines')) {
            send(res, 404, 'application/json', JSON.stringify({error: `no stream ${stream_asked[1]}: it ended over ten minutes ago, or module-host restarted since`}));
            return;
        }
        stream_read(stream, res);
        return;
    }
    const api = /^\/api\/([a-z_]+)(\/.*)?$/.exec(pathname);
    const served = (api === null) ? undefined : modules_served.find(v => v.key === api[1]);
    if (served !== undefined) {
        await served.serve(req, res, (api[2] === undefined) ? '' : api[2]);
        return;
    }
    if (req.method !== 'GET') {
        send(res, 405, 'text/plain; charset=utf-8', 'GET only\n');
        return;
    }
    if (pathname === '/_/serviceman.css') {
        file_send(res, path.join(DIRS.main, 'serviceman.css'));
        return;
    }
    if (SHARED.includes(pathname)) {
        file_send(res, path.join(DIRS.main, pathname.slice(1)));
        return;
    }
    const file = /^\/_\/([a-z_]+)\/([a-z0-9_-][a-z0-9_.-]*)$/.exec(pathname);
    if (file !== null) {
        const module = modules_served.find(v => v.key === file[1]);
        const dir = (module === undefined) ? DIRS[file[1]] : module.ui;
        if ((dir !== undefined) && (file[1] !== 'main')) {
            file_send(res, path.join(dir, file[2]));
            return;
        }
    }
    send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
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
