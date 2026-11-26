const assert = require('assert');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const logline_files = require('../src/main/src/helpers/logline_files');
const logline_rig = require('./logline_rig');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

const VIEWER_DIR = path.join(logline_files.dir, 'log-ui');
// A query as the viewer's page sends it
const SQL = 'SELECT Body FROM default.otel_logs WHERE positionCaseInsensitive(Body, {find:String}) > 0 LIMIT {page_size:UInt32} FORMAT JSONEachRow';

// The viewer is Logline's three files as Logline has them, served at /logline/viewer/ of the
// control page, behind its sign-in; its page asks for its files and its door beside it
test('Logline\'s viewer is served on the control page, its files as Logline has them, the owner\'s alone', async function (t) {
    const rig = await logline_rig(t, {clickhouse: answer_rows});
    for (const [asked, file] of [['/logline/viewer/', 'index.html'], ['/logline/viewer/index.html', 'index.html'], ['/logline/viewer/styles.css', 'styles.css'], ['/logline/viewer/app.js', 'app.js']]) {
        const got = await fetch_host({port: rig.port, path: asked});
        assert.strictEqual(got.status, 200, asked);
        assert.strictEqual(got.body, fs.readFileSync(path.join(VIEWER_DIR, file), 'utf8'), `${asked}: the file as it is`);
        assert.strictEqual(got.headers['cache-control'], 'no-store', 'as nginx served it: a page changed is the page shown');
    }
    const page = await fetch_host({port: rig.port, path: '/logline/viewer/'});
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(page.body, /href="styles\.css"/, 'its addresses relative to the page');
    assert.match(page.body, /src="app\.js"/);
    assert.match(page.body, /vue@3\.\d+\.\d+\/dist\/vue\.global\.prod\.js" integrity="sha384-/, 'Vue of one version, checked by its hash');
    assert.match(fs.readFileSync(path.join(VIEWER_DIR, 'app.js'), 'utf8'), /fetch\(`clickhouse\?/, 'its queries beside the page');

    const bare = await fetch_host({port: rig.port, path: '/logline/viewer?label=remote:server&range=24h'});
    assert.deepStrictEqual([bare.status, bare.headers.location], [301, '/logline/viewer/?label=remote:server&range=24h'], 'a folder, its filters kept');
    for (const missing of ['/logline/viewer/nginx.conf', '/logline/viewer/../lines/index.js', '/logline/viewer/%2e%2e/docker-compose.yml', '/logline/viewer/constructor']) {
        assert.strictEqual((await fetch_host({port: rig.port, path: missing})).status, 404, missing);
    }
    assert.strictEqual((await fetch_host({port: rig.port, method: 'PUT', path: '/logline/viewer/app.js', body: 'x'})).status, 405);

    // Nobody but the owner: a stranger's browser gets the sign-in, a token none of its rights
    const stranger = await fetch_host({port: rig.port, path: '/logline/viewer/', token: null, headers: {accept: 'text/html'}});
    assert.strictEqual(stranger.status, 401);
    assert.strictEqual(stranger.body.includes('Logline'), false, 'the sign-in, not the viewer');
    const made = await fetch_host({port: rig.port, method: 'POST', path: '/api/v1/tokens', body: JSON.stringify({label: 'an agent', remotes: ['*'], rights: ['status', 'metrics', 'ports', 'forwards', 'apps_read']})});
    assert.strictEqual(made.status, 200, made.body);
    const agent_token = JSON.parse(made.body).token;
    for (const [method, asked] of [['GET', '/logline/viewer/'], ['GET', '/logline/viewer/app.js'], ['POST', '/logline/viewer/clickhouse']]) {
        const refused = await fetch_host({port: rig.port, method, path: asked, token: agent_token, body: (method === 'POST') ? 'SELECT 1' : undefined});
        assert.strictEqual(refused.status, 403, `${method} ${asked}: ${refused.body}`);
    }
    assert.strictEqual(control_route_right('POST', '/logline/viewer/clickhouse'), null, 'no right reaches it');
    assert.strictEqual(rig.asked.length, 0, 'ClickHouse was asked nothing');
});

// Open Logline goes to the viewer the config names, and to the control page's own without one
test('the page opens the viewer the config names, the control page\'s own without one', async function (t) {
    const own = await logline_rig(t, {clickhouse: answer_rows});
    const status = JSON.parse((await fetch_host({port: own.port, path: '/api/v1/status'})).body);
    assert.deepStrictEqual([status.logline.ui, status.logline.viewer], [null, '/logline/viewer/']);
    assert.deepStrictEqual([status.remotes[0].logline.ui, status.remotes[0].logline.viewer], [null, '/logline/viewer/']);
    const named = await logline_rig(t, {clickhouse: answer_rows, logline: {endpoint: 'http://127.0.0.1:9/lines', admin: 'logline', ui: 'http://logline.example.com:8081/'}});
    const status_named = JSON.parse((await fetch_host({port: named.port, path: '/api/v1/status'})).body);
    assert.deepStrictEqual([status_named.logline.ui, status_named.logline.viewer], ['http://logline.example.com:8081/', 'http://logline.example.com:8081/']);
    assert.strictEqual(status_named.remotes[0].logline.viewer, 'http://logline.example.com:8081/');
    const unset = await logline_rig(t, {clickhouse: answer_rows, logline: null});
    const status_unset = JSON.parse((await fetch_host({port: unset.port, path: '/api/v1/status'})).body);
    assert.deepStrictEqual([status_unset.logline, status_unset.remotes[0].logline.viewer], [null, null], 'Logline not set: nowhere to open');
});

// What nginx in front of Logline's own viewer does: the query as the read-only user, with no
// credential and no header of the page's, its answer as ClickHouse gives it
test('a query goes to ClickHouse on Logline\'s machine as log_ui, with nothing of the page\'s but the query, its parameters and the format', async function (t) {
    const rig = await logline_rig(t, {clickhouse: answer_rows});
    const got = await fetch_host({
        port: rig.port,
        method: 'POST',
        path: '/logline/viewer/clickhouse?default_format=JSONEachRow&param_find=it%27s%20OR%201%3D1&param_page_size=200',
        headers: {'content-type': 'text/plain; charset=utf-8', 'cookie': 'serviceman_token=sm_not-for-clickhouse', 'x-clickhouse-user': 'default', 'x-clickhouse-key': 'secret', 'x-clickhouse-database': 'system', 'x-clickhouse-quota': 'none'},
        body: SQL,
    });
    assert.strictEqual(got.status, 200, got.body);
    assert.strictEqual(got.body, '{"Body":"main: model loaded"}\n');
    assert.strictEqual(got.headers['content-type'], 'text/plain; charset=utf-8', 'read by the page\'s script, never shown as a page');
    assert.strictEqual(got.headers['cache-control'], 'no-store');
    assert.strictEqual(rig.asked.length, 1);
    const asked = rig.asked[0];
    assert.strictEqual(asked.method, 'POST');
    assert.strictEqual(asked.path, '/');
    assert.deepStrictEqual(Array.from(asked.params.entries()), [['default_format', 'JSONEachRow'], ['param_find', 'it\'s OR 1=1'], ['param_page_size', '200']]);
    assert.strictEqual(asked.sql, SQL);
    assert.strictEqual(asked.headers['x-clickhouse-user'], 'log_ui', 'Logline\'s read-only user, whoever the page says');
    for (const name of ['authorization', 'cookie', 'x-clickhouse-key', 'x-clickhouse-database', 'x-clickhouse-quota']) {
        assert.strictEqual(asked.headers[name], undefined, `${name} is not the page's to send`);
    }

    // ClickHouse's own refusal, as it said it: the viewer shows it
    const refusing = await logline_rig(t, {clickhouse: function (item, res) {
        res.writeHead(500, {'content-type': 'text/plain; charset=UTF-8'});
        res.end('Code: 164. DB::Exception: log_ui: Cannot execute query in readonly mode. (READONLY)\n');
    }});
    const write = await fetch_host({port: refusing.port, method: 'POST', path: '/logline/viewer/clickhouse', body: 'INSERT INTO default.otel_logs (Body) VALUES (\'x\')'});
    assert.deepStrictEqual([write.status, write.body], [500, 'Code: 164. DB::Exception: log_ui: Cannot execute query in readonly mode. (READONLY)\n']);
});

// Nothing in the address picks another user, a password, a role, a session or a setting: the
// query's parameters and the format alone go on
test('the door refuses a user, a password, a role, a setting and another method, and asks ClickHouse nothing', async function (t) {
    const rig = await logline_rig(t, {clickhouse: answer_rows});
    for (const query of ['user=default', 'password=x', 'user=default&password=', 'role=admin', 'quota_key=x', 'session_id=s1', 'database=system', 'query=SELECT%201', 'readonly=0', 'max_execution_time=3600', 'max_threads=64', 'cancel_http_readonly_queries_on_client_close=0', 'param_=x', 'param_a-b=x', 'default_format=JSON&user=default', 'Param_x=1']) {
        const refused = await fetch_host({port: rig.port, method: 'POST', path: `/logline/viewer/clickhouse?${query}`, body: 'SELECT 1'});
        assert.strictEqual(refused.status, 400, `${query}: ${refused.body}`);
        assert.match(refused.body, /^Logline's ClickHouse is asked with the query's parameters \(param_<name>\) and default_format alone, not "/, query);
    }
    for (const method of ['GET', 'PUT', 'DELETE']) {
        const refused = await fetch_host({port: rig.port, method, path: '/logline/viewer/clickhouse?query=SELECT%201'});
        assert.deepStrictEqual([refused.status, refused.headers.allow], [405, 'POST'], method);
    }
    for (const tail of ['/', '/play', '/ping', '/replicas_status']) {
        assert.strictEqual((await fetch_host({port: rig.port, method: 'POST', path: `/logline/viewer/clickhouse${tail}`, body: 'SELECT 1'})).status, 404, `ClickHouse's ${tail} is not reached`);
    }
    // Another site cannot send a query from the owner's browser
    const cross = await fetch_host({port: rig.port, method: 'POST', path: '/logline/viewer/clickhouse', headers: {'sec-fetch-site': 'cross-site'}, body: 'SELECT 1'});
    assert.strictEqual(cross.status, 403);
    const stranger = await fetch_host({port: rig.port, method: 'POST', path: '/logline/viewer/clickhouse', token: null, body: 'SELECT 1'});
    assert.strictEqual(stranger.status, 401);
    const large = await fetch_host({port: rig.port, method: 'POST', path: '/logline/viewer/clickhouse', body: 'x'.repeat(1024*1024 + 1)});
    assert.strictEqual(large.status, 413, 'a query, not a load');
    assert.strictEqual(rig.asked.length, 0, 'ClickHouse was asked nothing');
});

// A range picked again lets go of the older request: its connection to ClickHouse goes, and
// ClickHouse stops the query (cancel_http_readonly_queries_on_client_close)
test('a query the page lets go of closes its way to ClickHouse, which stops it there', async function (t) {
    const rig = await logline_rig(t, {clickhouse: function () {}});
    const request = http.request({host: '127.0.0.1', port: rig.port, method: 'POST', path: '/logline/viewer/clickhouse?param_find=slow', agent: false, headers: {host: '127.0.0.1', authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}});
    request.on('error', () => {});
    request.end(SQL);
    for (let i = 0; rig.asked.length === 0; i++) {
        assert.ok(i < 400, 'the query reaches ClickHouse');
        await timers.setTimeout(25);
    }
    request.destroy();
    const closed = await Promise.race([rig.asked[0].closed.then(() => 'closed'), timers.setTimeout(5000, 'still open')]);
    assert.strictEqual(closed, 'closed', 'the connection to ClickHouse goes with the page\'s');
});

// What keeps the viewer from its lines is said in words, as the viewer shows what ClickHouse says
test('Logline\'s machine away, ClickHouse not answering there, or no service logline: said in words', async function (t) {
    const rig = await logline_rig(t, {clickhouse: answer_rows});
    await rig.clickhouse_stop();
    const down = await fetch_host({port: rig.port, method: 'POST', path: '/logline/viewer/clickhouse', body: SQL});
    assert.deepStrictEqual([down.status, down.body], [502, `ClickHouse does not answer on server: nothing listens on 127.0.0.1:${process.env.SERVICEMAN_LOGLINE_CLICKHOUSE_PORT} there, so Logline is not running or not started yet\n`]);
    await rig.agent_stop();
    const away = await fetch_host({port: rig.port, method: 'POST', path: '/logline/viewer/clickhouse', body: SQL});
    assert.deepStrictEqual([away.status, away.body], [503, 'server, where Logline runs, is not connected\n']);
    const lines = await fetch_host({port: rig.port, path: '/api/v1/services/notes/lines'});
    assert.deepStrictEqual([lines.status, JSON.parse(lines.body)], [503, {error: 'server, where Logline runs, is not connected'}], 'the Logs tab says the same');

    const none = await logline_rig(t, {clickhouse: answer_rows, services: [{name: 'notes', type: 'external', remote: 'server', upstream: '127.0.0.1:9', publish: {host: 'notes.test'}}]});
    const unknown = await fetch_host({port: none.port, method: 'POST', path: '/logline/viewer/clickhouse', body: SQL});
    assert.strictEqual(unknown.status, 503);
    assert.match(unknown.body, /^no service is named logline: /);
});

// ClickHouse's answer to a query: one row
function answer_rows(item, res)
{
    res.writeHead(200, {'content-type': 'application/x-ndjson; charset=UTF-8'});
    res.end('{"Body":"main: model loaded"}\n');
}
