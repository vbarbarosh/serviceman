const assert = require('assert');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const fetch_host = require('./fetch_host');
const logline_rig = require('./logline_rig');
const path = require('path');
const service_lines = require('../src/main/src/helpers/service_lines');
const test = require('node:test');

// A service's Logs tab reads its lines from ClickHouse on Logline's machine, through its agent,
// as the viewer's own page does: what is asked goes as a parameter, never into the query
test('a service\'s lines: the last ones oldest first, how many in all, what is asked a parameter', async function (t) {
    const viewer = await clickhouse_start(t, function (asked) {
        if (asked.sql.includes('count()')) {
            return {status: 200, text: '{"total":"1234"}\n'};
        }
        return {status: 200, text: [
            row_of({at: '2026-11-20 14:02:18.000000000', time_ms: '1700000002000', line: 'main: model loaded', stream: 'stdout'}),
            row_of({at: '2026-11-20 14:02:17.000000000', time_ms: '1700000001000', line: 'error: the request exceeds the context', stream: 'stderr'}),
        ].map(v => JSON.stringify(v)).join('\n') + '\n'};
    });
    const find = 'it\'s\' OR 1=1 --';
    const read = await service_lines(viewer.app, {name: 'notes', remotes: ['vps1']}, {find, labels: [], around_ms: null});
    assert.deepStrictEqual(read, {total: 1234, label_sets: [{remote: 'vps1', service: 'notes', stream: 'stderr'}, {remote: 'vps1', service: 'notes', stream: 'stdout'}], lines: [
        {time_ms: 1700000001000, line: 'error: the request exceeds the context', stream: 'stderr', label_set: 0},
        {time_ms: 1700000002000, line: 'main: model loaded', stream: 'stdout', label_set: 1},
    ]});
    assert.strictEqual(viewer.asked.length, 2, 'the lines and their count');
    for (const asked of viewer.asked) {
        assert.strictEqual(asked.method, 'POST');
        assert.strictEqual(asked.path, '/');
        assert.strictEqual(asked.headers['x-clickhouse-user'], 'log_ui', 'Logline\'s read-only user, as its viewer asks');
        assert.strictEqual(asked.params.get('param_name'), 'notes');
        assert.strictEqual(asked.params.get('param_container'), 'serviceman-notes', 'lines from before the agent named the service');
        assert.strictEqual(asked.params.get('param_remote_0'), 'vps1', 'from the machines it runs on alone');
        assert.strictEqual(asked.params.get('param_find'), find);
        assert.strictEqual(asked.sql.includes(find), false, 'a find is never in the query');
        assert.match(asked.sql, /INTERVAL 1 DAY/);
    }
});

// What a line's detail shows comes with it: its fields when it has them, and its labels as the
// viewer names them, each set of them once however many lines share it
test('a line\'s fields only when it has them, its labels in the viewer\'s names and order, each set once', async function (t) {
    const viewer = await clickhouse_start(t, function (asked) {
        if (asked.sql.includes('count()')) {
            return {status: 200, text: '{"total":"3"}\n'};
        }
        const resource = {'container.id': 'abc123', 'region': 'eu', 'host.name': 'vps1', 'remote': 'vps1', 'container.image.name': '', 'constructor': 'x'};
        return {status: 200, text: [
            row_of({at: '2026-11-20 14:02:19.000000000', time_ms: '1700000003000', line: 'b', stream: 'stderr', resource}),
            row_of({at: '2026-11-20 14:02:18.000000000', time_ms: '1700000002000', line: '[c7t0xb1m][send_error] parent=c1a0root too long', stream: 'stderr', severity: 'ERROR', subject: 'send_error', group_uid: 'c7t0xb1m', parent_group_uid: 'c1a0root', resource}),
            row_of({at: '2026-11-20 14:02:17.000000000', time_ms: '1700000001000', line: 'a', stream: '', resource: {remote: 'vps1'}}),
        ].map(v => JSON.stringify(v)).join('\n') + '\n'};
    });
    const read = await service_lines(viewer.app, {name: 'notes', remotes: ['vps1']}, {find: '', labels: [], around_ms: null});
    assert.deepStrictEqual(read.label_sets, [
        {remote: 'vps1', service: 'notes'},
        {remote: 'vps1', host: 'vps1', service: 'notes', stream: 'stderr', container_id: 'abc123', constructor: 'x', region: 'eu'},
    ], 'the viewer\'s order, then the rest by name; an empty label left out; a name like an object\'s own, a label');
    assert.deepStrictEqual(read.lines, [
        {time_ms: 1700000001000, line: 'a', stream: '', label_set: 0},
        {time_ms: 1700000002000, line: '[c7t0xb1m][send_error] parent=c1a0root too long', stream: 'stderr', label_set: 1, severity: 'ERROR', subject: 'send_error', group: 'c7t0xb1m', parent: 'c1a0root'},
        {time_ms: 1700000003000, line: 'b', stream: 'stderr', label_set: 1},
    ]);
    const sql = viewer.asked.find(v => v.sql.includes('Body AS line')).sql;
    assert.match(sql, /if\(empty\(LogAttributes\['group_uid'\]\), extract\(Body, /, 'a group its own, or read from its words, as the viewer reads it');
});

// A click on a label keeps the lines with it; Surroundings asks for 2 minutes either side of a
// line, the nearest first, given back in time's order
test('the lines with some labels, and a line\'s surroundings, all asked as parameters', async function (t) {
    const viewer = await clickhouse_start(t, function (asked) {
        if (asked.sql.includes('count()')) {
            return {status: 200, text: '{"total":"2"}\n'};
        }
        return {status: 200, text: [
            row_of({at: '2026-11-20 14:02:17.930000000', time_ms: '1700000000930', line: 'the line', stream: 'stderr'}),
            row_of({at: '2026-11-20 14:02:17.929000001', time_ms: '1700000000929', line: 'just before', stream: 'stderr'}),
            row_of({at: '2026-11-20 14:03:00.000000000', time_ms: '1700000043000', line: 'later', stream: 'stderr'}),
        ].map(v => JSON.stringify(v)).join('\n') + '\n'};
    });
    const labels = [{name: 'stream', value: 'stderr'}, {name: 'host', value: 'vps1'}, {name: 'region', value: 'eu\' OR 1=1'}, {name: 'toString', value: 'x'}];
    const read = await service_lines(viewer.app, {name: 'notes', remotes: []}, {find: '', labels, around_ms: 1700000000930});
    assert.deepStrictEqual(read.lines.map(v => v.line), ['just before', 'the line', 'later'], 'in time\'s order, to the nanosecond');
    for (const asked of viewer.asked) {
        assert.strictEqual(asked.params.get('param_label_0'), 'stderr');
        assert.strictEqual(asked.params.get('param_label_1'), 'vps1');
        assert.strictEqual(asked.params.get('param_label_2'), 'eu\' OR 1=1');
        assert.strictEqual(asked.params.get('param_label_key_2'), 'region', 'a label of its own name is a key, a parameter too');
        assert.match(asked.sql, /LogAttributes\['log\.iostream'\] = \{label_0:String\}/);
        assert.match(asked.sql, /ResourceAttributes\['host\.name'\] = \{label_1:String\}/);
        assert.match(asked.sql, /ResourceAttributes\[\{label_key_2:String\}\] = \{label_2:String\}/);
        assert.strictEqual(asked.params.get('param_label_key_3'), 'toString', 'a name like an object\'s own, a key');
        assert.strictEqual(asked.sql.includes('native code'), false);
        assert.strictEqual(asked.sql.includes('eu\''), false);
        assert.strictEqual(asked.params.get('param_around'), '1700000000930');
        assert.strictEqual(asked.params.get('param_from_s'), '1699999880');
        assert.strictEqual(asked.params.get('param_to_s'), '1700000121');
        assert.match(asked.sql, /abs\(toUnixTimestamp64Milli\(Timestamp\) - \{around:Int64\}\) <= 120000/);
        assert.strictEqual(asked.sql.includes('INTERVAL 1 DAY'), false, 'its 4 minutes, not the last day');
    }
    assert.match(viewer.asked.find(v => v.sql.includes('Body AS line')).sql, /ORDER BY\s+abs\(toUnixTimestamp64Milli\(Timestamp\) - \{around:Int64\}\) ASC/, 'the nearest lines when there are more than it shows');
});

test('a service\'s lines with no find, on no machine: neither asked of Logline', async function (t) {
    const viewer = await clickhouse_start(t, function () {
        return {status: 200, text: ''};
    });
    assert.deepStrictEqual(await service_lines(viewer.app, {name: 'notes', remotes: []}, ASK_ALL), {total: 0, lines: [], label_sets: []});
    for (const asked of viewer.asked) {
        assert.strictEqual(asked.params.has('param_find'), false);
        assert.strictEqual(asked.params.has('param_remote_0'), false);
        assert.strictEqual(asked.sql.includes('positionCaseInsensitive'), false);
        assert.strictEqual(asked.sql.includes('ResourceAttributes[\'remote\']'), false);
    }
});

// What the tab says when Logline does not give the lines: what ClickHouse answered, an answer
// that is not lines, or that nothing answered
test('Logline\'s refusal, an answer that is not lines, and no answer', async function (t) {
    const failing = await clickhouse_start(t, function () {
        return {status: 500, text: 'Code: 60. DB::Exception: Table default.otel_logs does not exist. (UNKNOWN_TABLE)'};
    });
    await assert.rejects(service_lines(failing.app, {name: 'notes', remotes: []}, ASK_ALL), {message: 'Logline answered 500: Table default.otel_logs does not exist. (UNKNOWN_TABLE)'});
    const page = await clickhouse_start(t, function () {
        return {status: 200, text: '<!doctype html><title>Sign in</title>'};
    });
    await assert.rejects(service_lines(page.app, {name: 'notes', remotes: []}, ASK_ALL), /answered something that is not lines: <!doctype html><title>Sign in<\/title>$/);
    const gone = await clickhouse_start(t, function () {
        return {status: 200, text: ''};
    });
    await gone.clickhouse_stop();
    await assert.rejects(service_lines(gone.app, {name: 'notes', remotes: []}, ASK_ALL), /^Error: ClickHouse does not answer on server: nothing listens on 127\.0\.0\.1:\d+ there/);
});

// GET /api/v1/services/<name>/lines: the owner's alone, as every route no right names
test('the route: a service\'s lines, 404 for no service, 409 with Logline not set, 502 when Logline fails', async function (t) {
    let fail = false;
    const viewer = await clickhouse_start(t, function (asked) {
        if (fail) {
            return {status: 500, text: 'Code: 60. DB::Exception: Table default.otel_logs does not exist.'};
        }
        if (asked.sql.includes('count()')) {
            return {status: 200, text: '{"total":"1"}\n'};
        }
        return {status: 200, text: JSON.stringify(row_of({at: '2026-11-20 14:02:17.930000000', time_ms: '1700000000000', line: `found ${asked.params.get('param_find')}`, stream: 'stdout'})) + '\n'};
    });
    const control = viewer.port;
    const found = await fetch_host({port: control, path: '/api/v1/services/notes/lines?find=error'});
    assert.strictEqual(found.status, 200, found.body);
    assert.deepStrictEqual(JSON.parse(found.body), {total: 1, label_sets: [{remote: 'vps1', service: 'notes', stream: 'stdout'}], lines: [{time_ms: 1700000000000, line: 'found error', stream: 'stdout', label_set: 0}]});
    assert.strictEqual(viewer.asked[viewer.asked.length - 1].params.get('param_remote_0'), 'server', 'from the machine notes runs on');
    const narrowed = await fetch_host({port: control, path: `/api/v1/services/notes/lines?label=${encodeURIComponent('stream:std:out')}&label=remote:vps1&around=1700000000000`});
    assert.strictEqual(narrowed.status, 200, narrowed.body);
    const narrowed_asked = viewer.asked[viewer.asked.length - 1].params;
    assert.deepStrictEqual([narrowed_asked.get('param_label_0'), narrowed_asked.get('param_label_1'), narrowed_asked.get('param_around')], ['std:out', 'vps1', '1700000000000'], 'a value holds a colon; the name ends at the first');
    for (const [query, said] of [['label=no%20colon', 'a label is <name>:<value>'], ['label=a%20b:c', 'a label is <name>:<value>'], ['label=:x', 'a label is <name>:<value>'], ['around=-5', 'around is a line\'s time in milliseconds'], ['around=12.5', 'around is a line\'s time in milliseconds'], ['around=', 'around is a line\'s time in milliseconds']]) {
        const refused = await fetch_host({port: control, path: `/api/v1/services/notes/lines?${query}`});
        assert.strictEqual(refused.status, 400, query);
        assert.ok(JSON.parse(refused.body).error.startsWith(said), refused.body);
    }
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

    const bare = await clickhouse_start(t, () => ({status: 200, text: ''}), null);
    const unset = await fetch_host({port: bare.port, path: '/api/v1/services/notes/lines'});
    assert.deepStrictEqual([unset.status, JSON.parse(unset.body)], [409, {error: 'Where Logline is is not set: the Logline page has the form for it'}]);
    assert.strictEqual(bare.asked.length, 0);
});

// A line as the tab draws it: its time, its words without a terminal's colours, a red edge for
// "error" and an amber one for "warn" as words of their own, pink when it came on stderr
test('a line as the Logs tab draws it: time, words, its edge, its stream', async function () {
    const line_row = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'line_row.js'))).default;
    const at = new Date(2026, 10, 20, 23, 42, 16, 7);
    function row(line, stream) {
        return line_row({time_ms: at.getTime(), line, stream, label_set: 0}, [{}]);
    }
    assert.deepStrictEqual(row('\x1b[32msrv  load_model:\x1b[0m loading model', 'stdout'), {key: `${at.getTime()}\n\x1b[32msrv  load_model:\x1b[0m loading model`, time: '23:42:16.007', day: '20 November', when: at.toString(), text: 'srv  load_model: loading model', kind: '', stderr: false, time_ms: at.getTime(), severity: '', subject: '', group: '', parent: '', labels: {}});
    const opened = line_row({time_ms: at.getTime(), line: '[c7t0xb1m][send_error] too long', stream: 'stderr', label_set: 1, severity: 'ERROR', subject: 'send_error', group: 'c7t0xb1m', parent: 'c1a0root'}, [{remote: 'vps2'}, {remote: 'vps1', stream: 'stderr'}]);
    assert.deepStrictEqual([opened.severity, opened.subject, opened.group, opened.parent, opened.labels], ['ERROR', 'send_error', 'c7t0xb1m', 'c1a0root', {remote: 'vps1', stream: 'stderr'}], 'its detail: its fields, its label set');
    assert.deepStrictEqual(['ERROR', 'fatal', 'CRITICAL', 'Warning', 'INFO'].map(v => line_row({time_ms: 0, line: 'quiet', label_set: 0, severity: v}, []).kind), ['line-error', 'line-error', 'line-error', 'line-warn', ''], 'an edge for a severity that says so');
    assert.deepStrictEqual(['send_error: task 2251, error: too long', 'ERROR something', 'Error:'].map(v => row(v).kind), ['line-error', 'line-error', 'line-error']);
    assert.deepStrictEqual(['warning: context 61% full', 'WARN slow', '[warn]'].map(v => row(v).kind), ['line-warn', 'line-warn', 'line-warn']);
    assert.deepStrictEqual(['0 errors', 'error_count=0', 'stderr', 'warnings: none', 'forewarned'].map(v => row(v).kind), ['', '', '', '', ''], 'only the word itself');
    assert.strictEqual(row('an error and a warning').kind, 'line-error', 'error over warn');
    assert.strictEqual(row('llama_model_loader: loaded', 'stderr').stderr, true);
    assert.strictEqual(row('', 'stdout').text, '', 'an empty line stays a row');
});

// Every line of the last day, as the tab first asks
const ASK_ALL = {find: '', labels: [], around_ms: null};

// A row as ClickHouse answers the lines' query: `given` over a line with no fields, from vps1
function row_of(given)
{
    return Object.assign({severity: '', subject: '', group_uid: '', parent_group_uid: '', service: 'notes', resource: {remote: 'vps1'}}, given);
}

// serviceman with Logline on its machine, and a stand-in for ClickHouse there (logline_rig):
// each request kept as {method, path, params, headers, sql}, answered as `answer` says.
// `logline` is the config's, set unless given.
async function clickhouse_start(t, answer, logline)
{
    return await logline_rig(t, {
        logline: (logline === undefined) ? {endpoint: 'http://127.0.0.1:9/lines', admin: 'logline'} : logline,
        clickhouse: function (item, res) {
            const given = answer(item);
            res.writeHead(given.status, {'content-type': 'text/plain'});
            res.end(given.text);
        },
    });
}
