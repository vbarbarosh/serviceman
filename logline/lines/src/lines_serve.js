const clickhouse_query = require('./clickhouse_query');
const crypto = require('crypto');
const http = require('http');
const ip_allowed = require('./ip_allowed');
const lines_from_json = require('./lines_from_json');
const log_days = require('./log_days');
const log_say = require('./log_say');
const rows_from_lines = require('./rows_from_lines');
const token_find = require('./token_find');
const token_issue = require('./token_issue');
const tokens_read = require('./tokens_read');
const tokens_write = require('./tokens_write');

const BODY_BYTES = 8*1024*1024;
const DEDUP_WINDOW = 10000;
const DEDUP_RETRY_MS = 60000;
const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

// Logline's one door. Machines POST their lines to /lines; serviceman asks /tokens for the
// token each machine sends, /days for what each day of lines takes, and /days/forget to drop
// the days before one. A token works only from the addresses it was issued for.
//
// config: {port, bind, admin_token, admin_ips, admin_off, clickhouse, table, tokens_file, uid}
// `admin_off` says why no token may be issued, when admin_token is null
function lines_serve(config)
{
    const app = {config, tokens: tokens_read(config.tokens_file), forgetting: false};
    const server = http.createServer(function (req, res) {
        request_handle(app, req, res).catch(function (error) {
            // The reason goes to the log, where whoever runs Logline reads it; a machine is told
            // that it did not work, and nothing of this host's insides
            log_say(config.uid, 'lines_error', {method: req.method, path: req.url, reason: error.message});
            send_json(res, 500, {error: 'Logline could not take that: its log says why'});
        });
    });
    // The first batch waits for the first try, so it is not the one batch that could be stored
    // twice
    app.dedup_tried = dedup_ensure(app);
    return server;
}

async function request_handle(app, req, res)
{
    const url = new URL(req.url, 'http://lines');
    if ((req.method === 'POST') && (url.pathname === '/lines')) {
        await lines_post(app, req, res);
        return;
    }
    if ((req.method === 'POST') && (url.pathname === '/tokens')) {
        await tokens_post(app, req, res);
        return;
    }
    const revoke = /^\/tokens\/([^/]+)$/.exec(url.pathname);
    if ((req.method === 'DELETE') && (revoke !== null)) {
        token_delete(app, req, res, decodeURIComponent(revoke[1]));
        return;
    }
    if ((req.method === 'GET') && (url.pathname === '/days')) {
        await days_get(app, req, res);
        return;
    }
    if ((req.method === 'POST') && (url.pathname === '/days/forget')) {
        await days_forget(app, req, res);
        return;
    }
    send_json(res, 404, {error: 'POST /lines, POST /tokens, DELETE /tokens/<name>, GET /days and POST /days/forget are all there is'});
}

// POST /lines (body, header:authorization)
// A batch of lines, stored whole or not at all. 200 means they are in ClickHouse; anything
// else means the sender keeps them and sends the same bytes again. The same bytes are stored
// once however often they come.
async function lines_post(app, req, res)
{
    const from = req.socket.remoteAddress;
    const item = token_find(app.tokens, bearer_of(req));
    if ((item === null) || (ip_allowed(from, item.ips) === false)) {
        const reason = (item === null) ? 'no such token' : 'not from an address this token was issued for';
        log_say(app.config.uid, 'lines_refused', {from, remote: (item === null) ? undefined : item.name, reason});
        send_json(res, 401, {error: reason});
        return;
    }
    const body = await body_read(req, res);
    if (body === null) {
        return;
    }
    let items;
    try {
        items = lines_from_json(JSON.parse(body.toString('utf8')));
    }
    catch (error) {
        log_say(app.config.uid, 'lines_refused', {from, remote: item.name, reason: error.message});
        send_json(res, 400, {error: error.message});
        return;
    }
    if (items.length === 0) {
        send_json(res, 200, {stored: 0});
        return;
    }
    await app.dedup_tried;
    const time0 = Date.now();
    const rows = rows_from_lines(items, item.name).map(v => JSON.stringify(v)).join('\n');
    const sql = `INSERT INTO ${app.config.table} (Timestamp, ServiceName, Body, ResourceAttributes, LogAttributes) FORMAT JSONEachRow`;
    try {
        await clickhouse_query(app.config.clickhouse, sql, rows, {
            insert_deduplication_token: crypto.createHash('sha256').update(body).digest('hex'),
            date_time_input_format: 'best_effort',
            // The token is kept only by an ordinary insert. ClickStack turns asynchronous inserts
            // on, and one of those would store a resent batch twice.
            async_insert: 0,
        });
    }
    catch (error) {
        log_say(app.config.uid, 'lines_store_error', {remote: item.name, count: items.length, reason: error.message});
        send_json(res, 502, {error: error.message});
        return;
    }
    log_say(app.config.uid, 'lines_stored', {remote: item.name, count: items.length, took: `${((Date.now() - time0)/1000).toFixed(3)}s`});
    send_json(res, 200, {stored: items.length});
}

// POST /tokens (body, header:authorization)
// {name, ips} -> {name, token}. Asked by serviceman, with the admin token, from an admin
// address. The same name and addresses get the same token; new addresses replace it.
async function tokens_post(app, req, res)
{
    if (admin_refused(app, req, res)) {
        return;
    }
    const body = await body_read(req, res);
    if (body === null) {
        return;
    }
    let json;
    try {
        json = JSON.parse(body.toString('utf8'));
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
        return;
    }
    if ((json === null) || (typeof json !== 'object') || (typeof json.name !== 'string') || (RE_NAME.test(json.name) === false)) {
        send_json(res, 400, {error: 'name: lowercase letters, digits, - and _'});
        return;
    }
    if ((Array.isArray(json.ips) === false) || (json.ips.length === 0) || json.ips.some(v => (typeof v !== 'string') || (ip_allowed(v.split('/')[0], [v]) === false))) {
        send_json(res, 400, {error: 'ips: a list of addresses and ranges, 100.64.0.20 or 100.64.0.0/10'});
        return;
    }
    const issued = token_issue(app.tokens, json.name, json.ips, Date.now());
    if (issued.tokens !== app.tokens) {
        tokens_write(app.config.tokens_file, issued.tokens);
        app.tokens = issued.tokens;
        log_say(app.config.uid, 'token_issued', {name: json.name, ips: issued.item.ips});
    }
    send_json(res, 200, {name: issued.item.name, token: issued.item.token});
}

// DELETE /tokens/<name> (header:authorization)
function token_delete(app, req, res, name)
{
    if (admin_refused(app, req, res)) {
        return;
    }
    const next = app.tokens.filter(v => v.name !== name);
    const removed = (next.length !== app.tokens.length);
    if (removed) {
        tokens_write(app.config.tokens_file, next);
        app.tokens = next;
        log_say(app.config.uid, 'token_revoked', {name});
    }
    send_json(res, 200, {removed});
}

// GET /days (header:authorization)
// What each day of lines takes, as log_days says it. Asked by serviceman, with the admin token:
// the sizes are no secret, but the door beside it drops lines.
async function days_get(app, req, res)
{
    if (admin_refused(app, req, res, 'days are not told here')) {
        return;
    }
    try {
        send_json(res, 200, Object.assign({table: app.config.table}, await log_days(app.config.clickhouse, app.config.table)));
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// POST /days/forget (body, header:authorization)
// {before: '2026-10-17'} -> {before, dropped: [{day, rows, bytes}], rows, bytes}: every day of
// lines before that one dropped. One at a time: a second ask while one runs is refused.
async function days_forget(app, req, res)
{
    if (admin_refused(app, req, res, 'no day is dropped here')) {
        return;
    }
    const body = await body_read(req, res);
    if (body === null) {
        return;
    }
    let json;
    try {
        json = JSON.parse(body.toString('utf8'));
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
        return;
    }
    if (app.forgetting) {
        send_json(res, 409, {error: 'days are being dropped already: ask again once that is done'});
        return;
    }
    app.forgetting = true;
    try {
        const done = await log_days.forget(app.config.clickhouse, app.config.table, (json === null) ? undefined : json.before);
        log_say(app.config.uid, 'days_forgotten', {before: done.before, days: done.dropped.length, rows: done.rows, bytes: done.bytes});
        send_json(res, 200, done);
    }
    catch (error) {
        log_say(app.config.uid, 'days_forget_error', {before: (json === null) ? undefined : json.before, reason: error.message});
        send_json(res, error.status || 502, {error: error.message});
    }
    finally {
        app.forgetting = false;
    }
}

// Whether this is not the admin — the wrong token, or the right one from elsewhere — answered
// if so. Without an admin token nobody is: what is then not done here is said.
function admin_refused(app, req, res, undone = 'no token is issued here')
{
    const from = req.socket.remoteAddress;
    if ((app.config.admin_token === null) || (app.config.admin_token === undefined)) {
        send_json(res, 503, {error: `${undone}: ${app.config.admin_off || 'ADMIN_TOKEN is not set'}`});
        return true;
    }
    const given = crypto.createHash('sha256').update(bearer_of(req)).digest();
    const kept = crypto.createHash('sha256').update(app.config.admin_token).digest();
    if (crypto.timingSafeEqual(given, kept) && ip_allowed(from, app.config.admin_ips)) {
        return false;
    }
    log_say(app.config.uid, 'admin_refused', {from, path: req.url});
    send_json(res, 401, {error: 'the admin token, from an admin address, is required'});
    return true;
}

function bearer_of(req)
{
    const found = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    return (found === null) ? '' : found[1];
}

// The whole body, or null once a body too big has been answered
function body_read(req, res)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let bytes = 0;
        req.on('data', function (chunk) {
            bytes += chunk.length;
            if (bytes <= BODY_BYTES) {
                chunks.push(chunk);
            }
        });
        req.on('end', function () {
            if (bytes > BODY_BYTES) {
                send_json(res, 413, {error: `a batch is kept under ${BODY_BYTES} bytes`});
                resolve(null);
                return;
            }
            resolve(Buffer.concat(chunks));
        });
        req.on('error', reject);
    });
}

function send_json(res, status, value)
{
    if (res.headersSent) {
        res.end();
        return;
    }
    const text = JSON.stringify(value);
    res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(text)});
    res.end(text);
}

// A batch sent twice is stored once only when the table remembers the batches it was given.
// otel_logs is a plain MergeTree, which forgets them unless told otherwise; this tells it, and
// tries again until the table is there and the setting has taken.
function dedup_ensure(app)
{
    const sql = `ALTER TABLE ${app.config.table} MODIFY SETTING non_replicated_deduplication_window = ${DEDUP_WINDOW}`;
    return clickhouse_query(app.config.clickhouse, sql).then(function () {
        log_say(app.config.uid, 'lines_dedup_ok', {table: app.config.table, window: DEDUP_WINDOW});
    }, function (error) {
        log_say(app.config.uid, 'lines_dedup_error', {table: app.config.table, reason: error.message, then: `tries again in ${DEDUP_RETRY_MS/1000}s`});
        setTimeout(dedup_ensure, DEDUP_RETRY_MS, app).unref();
    });
}

module.exports = lines_serve;
