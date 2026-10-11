const fs = require('fs');
const path = require('path');
const session_name_from_path = require('./session_name_from_path');
const sessions_list = require('./sessions_list');

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

// GET /_/sessions
// GET /_/{app,terminal,vendor}/:file
// GET /, GET /:name -- the page; its websocket opens on the same path
async function request_answer(req, res)
{
    const pathname = new URL(req.url, 'http://web-terminal.invalid').pathname;
    if (req.method !== 'GET') {
        send(res, 405, 'text/plain; charset=utf-8', 'GET only\n');
        return;
    }
    if (pathname === '/_/sessions') {
        send(res, 200, 'application/json', JSON.stringify({sessions: await sessions_list()}));
        return;
    }
    const match = /^\/_\/(app|terminal|vendor)\/([a-z0-9_-][a-z0-9_.-]*)$/.exec(pathname);
    if (match !== null) {
        file_send(res, path.join(DIRS[match[1]], match[2]));
        return;
    }
    if (session_name_from_path(pathname) === null) {
        send(res, 404, 'text/plain; charset=utf-8', 'no session has that name: lowercase letters, digits, - and _, one word after /\n');
        return;
    }
    file_send(res, path.join(DIRS.app, 'index.html'));
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
