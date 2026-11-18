const file_manager_serve = require('../../server/file_manager_serve');
const fs = require('fs');
const page_file_by_address = require('./page_file_by_address');
const path = require('path');

// How long a request that came before the agent's hello waits for it: the agent in this process
// says hello within a second or two of the start, and again a second after a link that dropped
const HELLO_WAIT_MS = 10000;
const HELLO_STEP_MS = 50;

const RE_API = /^\/api\/files(\/.*)?$/;

const TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
};

// The app's page and its API. Who may open it is serviceman's to say, by the wall in front of
// the app; this end takes a change only from a page of its own name, or from no page at all, so
// another site open in the same browser, and a file of the folder opened in a tab (served
// sandboxed, of no origin), cannot post to it.
//
// GET /                the page: the File Manager in the whole window
// GET /api/root        {path, machine}: where the files are, for the page's head
// *   /api/files...    the File Manager's API, over the folder (folder_disk)
// GET the page's files (page_file_by_address)
//
//     ctx = {disk, remote, root, machine, log}
async function files_app_answer(req, res, ctx)
{
    const url = new URL(req.url, 'http://files-app.invalid');
    const reading = (req.method === 'GET') || (req.method === 'HEAD');
    if ((reading === false) && (origin_allowed(req.headers) === false)) {
        send_json(res, 403, {error: `a change is taken from this app's own page only, and ${JSON.stringify(String(req.headers.origin))} is another`});
        return;
    }
    const api = RE_API.exec(url.pathname);
    if (api !== null) {
        const ready = await online(ctx.remote);
        if (ready === false) {
            send_json(res, 503, {error: 'the agent in this app did not start: the app\'s log says why'});
            return;
        }
        await file_manager_serve(req, res, {disk: ctx.disk, tail: (api[1] === undefined) ? '' : api[1], log: ctx.log, name: 'files', sandbox: true});
        return;
    }
    if ((url.pathname === '/api/root') && reading) {
        send_json(res, 200, {path: ctx.root, machine: ctx.machine});
        return;
    }
    if (reading === false) {
        send_json(res, 405, {error: `${req.method} is not taken here: only the API takes changes`});
        return;
    }
    if (Object.hasOwn(page_file_by_address, url.pathname)) {
        file_send(res, page_file_by_address[url.pathname]);
        return;
    }
    send_json(res, 404, {error: `no such page: ${url.pathname}`});
}

// No Origin is no page: a script or curl, which the wall in front lets through or not. A page
// says where it is, and its name is the one this request was asked by, here or in front.
function origin_allowed(headers)
{
    if (headers.origin === undefined) {
        return true;
    }
    let origin;
    try {
        origin = new URL(headers.origin);
    }
    catch {
        return false;
    }
    return [headers.host, headers['x-forwarded-host']].includes(origin.host);
}

// The agent says hello once its link is up; a page opened with the app's start asks before that
async function online(remote)
{
    for (let waited = 0; (remote.state.phase !== 'online') && (waited < HELLO_WAIT_MS); waited += HELLO_STEP_MS) {
        await new Promise(v => setTimeout(v, HELLO_STEP_MS));
    }
    return (remote.state.phase === 'online');
}

function file_send(res, file)
{
    fs.readFile(file, function (error, body) {
        if (error) {
            send_json(res, 404, {error: `the page's file ${path.basename(file)} is not in the app`});
            return;
        }
        res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'});
        res.end(body);
    });
}

function send_json(res, status, value)
{
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify(value, null, 4));
}

module.exports = files_app_answer;
