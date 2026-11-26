const body_bytes_read = require('../body_bytes_read');
const fs = require('fs');
const logline_clickhouse = require('../helpers/logline_clickhouse');
const logline_files = require('../helpers/logline_files');
const logline_viewer_of = require('../helpers/logline_viewer_of');
const mime_type_from_path = require('../helpers/mime_type_from_path');
const path = require('path');
const render_error_page = require('../helpers/render_error_page');
const stream = require('stream');

// Where the control page serves Logline's viewer, and the door its page sends its queries to,
// beside it, where the page asks for it
const BASE = logline_viewer_of.BASE;
const DOOR = `${BASE}clickhouse`;
// The viewer's three files, as Logline has them, by the name its page asks for each
const FILES = {'': 'index.html', 'index.html': 'index.html', 'styles.css': 'styles.css', 'app.js': 'app.js'};
const VIEWER_DIR = path.join(logline_files.dir, 'log-ui');
// A query, not a load: nginx's client_max_body_size in front of Logline's own viewer
const SQL_LIMIT_BYTES = 1024*1024;
// The viewer runs on the control page's own address: its scripts are its own and Vue from
// unpkg (a version its page names, checked by its hash), its requests go to this door alone,
// and no other page holds it in a frame
const VIEWER_CSP = 'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' https://unpkg.com; connect-src \'self\'; base-uri \'none\'; frame-ancestors \'none\'';

// GET /logline/viewer/                       Logline's viewer, its index.html
// GET /logline/viewer/<file>                 its styles.css and app.js
// POST /logline/viewer/clickhouse (body, query)   a query of the viewer's, param_<name> and
//                                            default_format: ClickHouse's answer as it comes
//
// True when the request was one of these. The owner's alone, as every route no right names:
// the viewer reads every machine's lines, and a token's machines would not keep it to its own.
async function handle_logline_viewer(app, req, res, url)
{
    if (url.pathname === BASE.slice(0, -1)) {
        // Its page asks for its files and its door beside it, so it is served as a folder
        res.writeHead(301, {location: `${BASE}${url.search}`});
        res.end();
        return true;
    }
    if (url.pathname.startsWith(BASE) === false) {
        return false;
    }
    if (url.pathname === DOOR) {
        if (req.method !== 'POST') {
            text_send(res, 405, 'Logline\'s ClickHouse is asked with POST, the query as the body', {allow: 'POST'});
            return true;
        }
        await query_answer(app, req, res, url);
        return true;
    }
    const name = url.pathname.slice(BASE.length);
    if (Object.hasOwn(FILES, name) === false) {
        render_error_page(res, 404, 'No such page', url.pathname);
        return true;
    }
    if ((req.method !== 'GET') && (req.method !== 'HEAD')) {
        render_error_page(res, 405, 'Only GET is served here', 'Logline\'s viewer is a page of files');
        return true;
    }
    await file_send(res, path.join(VIEWER_DIR, FILES[name]), req.method);
    return true;
}

// One query, sent on to ClickHouse on Logline's machine (logline_clickhouse) and its answer
// streamed back. A page that lets go of it, a range picked again, closes the way to ClickHouse,
// and ClickHouse stops the query. What keeps it from ClickHouse is said in words, as text, the
// way the viewer shows what ClickHouse says.
async function query_answer(app, req, res, url)
{
    const sql = await body_bytes_read(req, SQL_LIMIT_BYTES);
    const controller = new AbortController();
    res.once('close', function () {
        if (res.writableFinished === false) {
            controller.abort();
        }
    });
    let answer;
    try {
        answer = await logline_clickhouse(app, url.searchParams, sql, controller.signal);
    }
    catch (error) {
        if (controller.signal.aborted) {
            return;
        }
        if (typeof error.status !== 'number') {
            throw error;
        }
        text_send(res, error.status, error.message, {});
        return;
    }
    // Text, whatever format was asked: what comes back is read by the page's script, never
    // shown by the browser as a page of the control page's address
    res.writeHead(answer.statusCode, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
    stream.pipeline(answer, res, () => {});
}

// As nginx served them in front of Logline: never kept by the browser, so a page changed is
// the page shown
async function file_send(res, file_path, method)
{
    const text = await fs.promises.readFile(file_path);
    const headers = {'content-type': mime_type_from_path(file_path), 'content-length': text.length, 'cache-control': 'no-store'};
    if (file_path.endsWith('.html')) {
        headers['content-security-policy'] = VIEWER_CSP;
    }
    res.writeHead(200, headers);
    res.end((method === 'HEAD') ? undefined : text);
}

function text_send(res, status, text, headers)
{
    res.writeHead(status, Object.assign({'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'}, headers));
    res.end(`${text}\n`);
}

handle_logline_viewer.DOOR = DOOR;

module.exports = handle_logline_viewer;
