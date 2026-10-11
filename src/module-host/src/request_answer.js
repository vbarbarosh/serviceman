const fs = require('fs');
const machine_read = require('./machine_read');
const modules_served = require('./modules_served');
const path = require('path');
const request_allowed = require('./request_allowed');

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

// GET /                         the page
// GET /api/modules              [{key, title}]
// GET /api/machine              {hostname, addresses}
// *   /api/<key>...             the module's API
// GET /_/{app,vendor,<key>}/:file, GET /_/serviceman.css
async function request_answer(req, res)
{
    if (request_allowed(req) === false) {
        send(res, 403, 'text/plain; charset=utf-8', 'only this computer\'s own page may ask: open it at http://localhost\n');
        return;
    }
    const pathname = new URL(req.url, 'http://module-host.invalid').pathname;
    if ((pathname === '/') && (req.method === 'GET')) {
        file_send(res, path.join(DIRS.app, 'index.html'));
        return;
    }
    if ((pathname === '/api/modules') && (req.method === 'GET')) {
        send(res, 200, 'application/json', JSON.stringify(modules_served.map(v => ({key: v.key, title: v.title}))));
        return;
    }
    if ((pathname === '/api/machine') && (req.method === 'GET')) {
        send(res, 200, 'application/json', JSON.stringify(machine_read()));
        return;
    }
    const api = /^\/api\/([a-z_]+)(\/.*)?$/.exec(pathname);
    const served = ((api === null) ? undefined : modules_served.find(v => v.key === api[1]));
    if (served !== undefined) {
        await served.serve(req, res, ((api[2] === undefined) ? '' : api[2]));
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
    const file = /^\/_\/([a-z_]+)\/([a-z0-9_-][a-z0-9_.-]*)$/.exec(pathname);
    if (file !== null) {
        const module = modules_served.find(v => v.key === file[1]);
        const dir = ((module === undefined) ? DIRS[file[1]] : module.ui);
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
