const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const service_lines = require('../src/main/src/helpers/service_lines');
const test = require('node:test');

// A service's Logs tab reads its lines from Logline's viewer, through its /clickhouse, as the
// viewer's own page does: what is asked goes as a parameter, never into the query
test('a service\'s lines: the last ones oldest first, how many in all, what is asked a parameter', async function (t) {
    const viewer = await viewer_start(t, function (asked) {
        if (asked.sql.includes('count()')) {
            return {status: 200, text: '{"total":"1234"}\n'};
        }
        return {status: 200, text: [
            {time_ms: '1700000002000', line: 'main: model loaded', stream: 'stdout'},
            {time_ms: '1700000001000', line: 'error: the request exceeds the context', stream: 'stderr'},
        ].map(v => JSON.stringify(v)).join('\n') + '\n'};
    });
    const find = 'it\'s\' OR 1=1 --';
    const read = await service_lines({ui: viewer.ui}, {name: 'notes', remotes: ['vps1']}, find);
    assert.deepStrictEqual(read, {total: 1234, lines: [
        {time_ms: 1700000001000, line: 'error: the request exceeds the context', stream: 'stderr'},
        {time_ms: 1700000002000, line: 'main: model loaded', stream: 'stdout'},
    ]});
    assert.strictEqual(viewer.asked.length, 2, 'the lines and their count');
    for (const asked of viewer.asked) {
        assert.strictEqual(asked.method, 'POST');
        assert.strictEqual(asked.path, '/clickhouse');
        assert.strictEqual(asked.params.get('param_name'), 'notes');
        assert.strictEqual(asked.params.get('param_container'), 'serviceman-notes', 'lines from before the agent named the service');
        assert.strictEqual(asked.params.get('param_remote_0'), 'vps1', 'from the machines it runs on alone');
        assert.strictEqual(asked.params.get('param_find'), find);
        assert.strictEqual(asked.sql.includes(find), false, 'a find is never in the query');
        assert.match(asked.sql, /INTERVAL 1 DAY/);
    }
});

test('a service\'s lines with no find, on no machine: neither asked of Logline', async function (t) {
    const viewer = await viewer_start(t, function () {
        return {status: 200, text: ''};
    });
    assert.deepStrictEqual(await service_lines({ui: viewer.ui}, {name: 'notes', remotes: []}, ''), {total: 0, lines: []});
    for (const asked of viewer.asked) {
        assert.strictEqual(asked.params.has('param_find'), false);
        assert.strictEqual(asked.params.has('param_remote_0'), false);
        assert.strictEqual(asked.sql.includes('positionCaseInsensitive'), false);
        assert.strictEqual(asked.sql.includes('ResourceAttributes'), false);
    }
});

// What the tab says when Logline does not give the lines: what it answered, a wall in front of
// it, or that nothing answered
test('Logline\'s refusal, a wall in front of its viewer, a page that is not lines, and no answer', async function (t) {
    const failing = await viewer_start(t, function () {
        return {status: 500, text: 'Code: 60. DB::Exception: Table default.otel_logs does not exist. (UNKNOWN_TABLE)'};
    });
    await assert.rejects(service_lines({ui: failing.ui}, {name: 'notes', remotes: []}, ''), {message: 'Logline answered 500: Table default.otel_logs does not exist. (UNKNOWN_TABLE)'});
    const walled = await viewer_start(t, function () {
        return {status: 302, text: ''};
    });
    await assert.rejects(service_lines({ui: walled.ui}, {name: 'notes', remotes: []}, ''), {message: `Logline's viewer at ${new URL(walled.ui).origin} sends serviceman on elsewhere (302), to a sign-in most likely: its lines are read past no wall`});
    const page = await viewer_start(t, function () {
        return {status: 200, text: '<!doctype html><title>Sign in</title>'};
    });
    await assert.rejects(service_lines({ui: page.ui}, {name: 'notes', remotes: []}, ''), /answered a page, not lines: <!doctype html><title>Sign in<\/title>$/);
    const gone = await viewer_start(t, function () {
        return {status: 200, text: ''};
    });
    await new Promise(v => gone.server.close(v));
    await assert.rejects(service_lines({ui: gone.ui}, {name: 'notes', remotes: []}, ''), /^Error: Logline does not answer at http:\/\/127\.0\.0\.1:\d+: connect ECONNREFUSED/);
});

// GET /api/v1/services/<name>/lines: the owner's alone, as every route no right names
test('the route: a service\'s lines, 404 for no service, 409 with no viewer, 502 when Logline fails', async function (t) {
    let fail = false;
    const viewer = await viewer_start(t, function (asked) {
        if (fail) {
            return {status: 500, text: 'Code: 60. DB::Exception: Table default.otel_logs does not exist.'};
        }
        if (asked.sql.includes('count()')) {
            return {status: 200, text: '{"total":"1"}\n'};
        }
        return {status: 200, text: JSON.stringify({time_ms: '1700000000000', line: `found ${asked.params.get('param_find')}`, stream: 'stdout'}) + '\n'};
    });
    const control = await serviceman_start(t, {endpoint: 'http://127.0.0.1:9/lines', admin: 'logline', ui: viewer.ui});
    const found = await fetch_host({port: control, path: '/api/v1/services/notes/lines?find=error'});
    assert.strictEqual(found.status, 200, found.body);
    assert.deepStrictEqual(JSON.parse(found.body), {total: 1, lines: [{time_ms: 1700000000000, line: 'found error', stream: 'stdout'}]});
    const long = await fetch_host({port: control, path: `/api/v1/services/notes/lines?find=${'x'.repeat(5000)}`});
    assert.strictEqual(JSON.parse(long.body).lines[0].line, `found ${'x'.repeat(200)}`, 'a find is cut to 200 characters');
    const none = await fetch_host({port: control, path: '/api/v1/services/nothing/lines'});
    assert.deepStrictEqual([none.status, JSON.parse(none.body)], [404, {error: 'no service named "nothing"'}]);
    fail = true;
    const failed = await fetch_host({port: control, path: '/api/v1/services/notes/lines'});
    assert.deepStrictEqual([failed.status, JSON.parse(failed.body)], [502, {error: 'Logline answered 500: Table default.otel_logs does not exist.'}]);
    const stranger = await fetch_host({port: control, path: '/api/v1/services/notes/lines', token: null});
    assert.notStrictEqual(stranger.status, 200, 'no lines without the owner\'s token');
    assert.strictEqual(stranger.body.includes('found'), false);
    assert.strictEqual(control_route_right('GET', '/api/v1/services/notes/lines'), null, 'no token but the owner\'s reads lines');

    const bare = await serviceman_start(t, {endpoint: 'http://127.0.0.1:9/lines', admin: 'logline'});
    const unset = await fetch_host({port: bare, path: '/api/v1/services/notes/lines'});
    assert.deepStrictEqual([unset.status, JSON.parse(unset.body)], [409, {error: 'Where Logline\'s viewer is is not set: a machine\'s Logs tab has the form for it'}]);
});

// A line as the tab draws it: its time, its words without a terminal's colours, a red edge for
// "error" and an amber one for "warn" as words of their own, pink when it came on stderr
test('a line as the Logs tab draws it: time, words, its edge, its stream', async function () {
    const line_row = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'line_row.js'))).default;
    const at = new Date(2026, 10, 20, 23, 42, 16, 7);
    function row(line, stream) {
        return line_row({time_ms: at.getTime(), line, stream});
    }
    assert.deepStrictEqual(row('\x1b[32msrv  load_model:\x1b[0m loading model', 'stdout'), {time: '23:42:16.007', when: at.toString(), text: 'srv  load_model: loading model', kind: '', stderr: false});
    assert.deepStrictEqual(['send_error: task 2251, error: too long', 'ERROR something', 'Error:'].map(v => row(v).kind), ['line-error', 'line-error', 'line-error']);
    assert.deepStrictEqual(['warning: context 61% full', 'WARN slow', '[warn]'].map(v => row(v).kind), ['line-warn', 'line-warn', 'line-warn']);
    assert.deepStrictEqual(['0 errors', 'error_count=0', 'stderr', 'warnings: none', 'forewarned'].map(v => row(v).kind), ['', '', '', '', ''], 'only the word itself');
    assert.strictEqual(row('an error and a warning').kind, 'line-error', 'error over warn');
    assert.strictEqual(row('llama_model_loader: loaded', 'stderr').stderr, true);
    assert.strictEqual(row('', 'stdout').text, '', 'an empty line stays a row');
});

// A stand-in for Logline's viewer: each request kept as {method, path, params, sql}, answered
// as `answer` says
async function viewer_start(t, answer)
{
    const asked = [];
    const server = http.createServer(function (req, res) {
        const chunks = [];
        req.on('data', function (chunk) {
            chunks.push(chunk);
        });
        req.on('end', function () {
            const url = new URL(req.url, 'http://viewer');
            const item = {method: req.method, path: url.pathname, params: url.searchParams, sql: Buffer.concat(chunks).toString('utf8')};
            asked.push(item);
            const given = answer(item);
            res.writeHead(given.status, (given.status === 302) ? {location: '/sign-in'} : {'content-type': 'text/plain'});
            res.end(given.text);
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.close();
    });
    return {server, asked, ui: `http://127.0.0.1:${server.address().port}/`};
}

// serviceman with one service, notes, and Logline as `logline` says: its control door's port
async function serviceman_start(t, logline)
{
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-lines-'));
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        logline,
        services: [{name: 'notes', type: 'files', publish: {host: 'notes.test'}}],
    }, state);
    const servers = await server_start(app_from_config(config));
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    return servers.control.address().port;
}
