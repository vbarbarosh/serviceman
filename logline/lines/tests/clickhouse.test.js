const assert = require('assert');
const clickhouse_query = require('../src/clickhouse_query');
const crypto = require('crypto');
const fs = require('fs');
const lines_serve = require('../src/lines_serve');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Against a real ClickHouse: CLICKHOUSE=http://127.0.0.1:8123, as a user that may create and
// drop a table of its own. Without it there is nothing real to test against, and this is skipped.
const CLICKHOUSE = process.env.CLICKHOUSE;
const ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');

test('lines go in once however often they are sent, only with a token from its own address', {skip: ((CLICKHOUSE === undefined) ? 'CLICKHOUSE is not set' : false)}, async function (t) {
    const table = `default.lines_test_${crypto.randomBytes(4).toString('hex')}`;
    const ddl = fs.readFileSync(path.join(__dirname, 'otel_logs.sql'), 'utf8').replace('{table}', table);
    await clickhouse_query(CLICKHOUSE, ddl);
    t.after(() => clickhouse_query(CLICKHOUSE, `DROP TABLE IF EXISTS ${table}`));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-'));
    const running = await serve(t, {clickhouse: CLICKHOUSE, table, tokens_file: path.join(dir, 'tokens.json')});

    // serviceman asks for a token; a caller without the admin token, or from elsewhere, may not
    const refused = await call(running, 'POST', '/tokens', 'wrong', {name: 'vps1', ips: ['127.0.0.1']});
    assert.strictEqual(refused.status, 401);
    const issued = await call(running, 'POST', '/tokens', ADMIN_TOKEN, {name: 'vps1', ips: ['127.0.0.1']});
    assert.strictEqual(issued.status, 200);
    assert.match(issued.body.token, /^[0-9a-f]{64}$/);
    assert.strictEqual(fs.statSync(path.join(dir, 'tokens.json')).mode & 0o777, 0o600);
    const elsewhere = await call(running, 'POST', '/tokens', ADMIN_TOKEN, {name: 'vps2', ips: ['10.1.2.3']});

    const batch = [
        {time: '2026-09-25T18:17:09.979123456Z', labels: {host: 'server.example.com', service: 'ffmpeg', stream: 'stderr', remote: 'not-me'}, line: '[c7t0xb1m][mp4gif_worker_begin]'},
        {time: '2026-09-25T22:17:10.863401202+03:00', labels: {host: 'server.example.com', service: 'ffmpeg'}, line: '[c7t0xb1m][mp4gif_worker_end_error] 0.884s ffmpeg exit=1'},
    ];
    const first = await call(running, 'POST', '/lines', issued.body.token, batch);
    assert.deepStrictEqual([first.status, first.body], [200, {stored: 2}]);
    // The answer was lost on the way back, say, and the agent sends the same bytes again
    const again = await call(running, 'POST', '/lines', issued.body.token, batch);
    assert.deepStrictEqual([again.status, again.body], [200, {stored: 2}]);
    const rows = JSON.parse(`[${(await clickhouse_query(CLICKHOUSE, `SELECT toString(Timestamp) AS t, ServiceName, Body, ResourceAttributes, LogAttributes FROM ${table} ORDER BY Timestamp FORMAT JSONEachRow`, undefined, {date_time_output_format: 'iso'})).trim().split('\n').join(',')}]`);
    assert.strictEqual(rows.length, 2, 'the same batch twice is stored once');
    assert.strictEqual(rows[0].t, '2026-09-25 18:17:09.979123456', 'to the nanosecond, in UTC');
    assert.strictEqual(rows[1].t, '2026-09-25 19:17:10.863401202', 'another zone is the same instant in UTC');
    assert.strictEqual(rows[0].ServiceName, 'ffmpeg');
    assert.strictEqual(rows[0].Body, '[c7t0xb1m][mp4gif_worker_begin]');
    assert.deepStrictEqual(rows[0].ResourceAttributes, {'host.name': 'server.example.com', 'remote': 'vps1'}, 'remote is the token\'s, not what the machine said');
    assert.deepStrictEqual(rows[0].LogAttributes, {'group_uid': 'c7t0xb1m', 'log.index': '0', 'log.iostream': 'stderr', 'sender': 'mp4gif_worker_begin'});
    assert.strictEqual(rows[1].LogAttributes.details, '0.884s ffmpeg exit=1');

    // A token from an address it was not issued for, a token nobody issued, a batch that is wrong
    assert.strictEqual((await call(running, 'POST', '/lines', elsewhere.body.token, batch)).status, 401);
    assert.strictEqual((await call(running, 'POST', '/lines', 'f'.repeat(64), batch)).status, 401);
    const wrong = await call(running, 'POST', '/lines', issued.body.token, [{time: 'now', labels: {}, line: 'x'}]);
    assert.strictEqual(wrong.status, 400);
    assert.match(wrong.body.error, /^\[0\]\.time/);

    // A ClickHouse that is not there: the batch is not taken, so the agent keeps it
    const cut_off = await serve(t, {clickhouse: 'http://127.0.0.1:9', table, tokens_file: path.join(dir, 'tokens.json')});
    const lost = await call(cut_off, 'POST', '/lines', issued.body.token, [{time: '2026-09-25T18:20:00Z', labels: {}, line: 'kept by the agent'}]);
    assert.strictEqual(lost.status, 502);

    // Revoked, the token lets nothing in; the file says so to the next process as well
    assert.deepStrictEqual((await call(running, 'DELETE', '/tokens/vps1', ADMIN_TOKEN)).body, {removed: true});
    assert.strictEqual((await call(running, 'POST', '/lines', issued.body.token, batch)).status, 401);
    const later = await serve(t, {clickhouse: CLICKHOUSE, table, tokens_file: path.join(dir, 'tokens.json')});
    assert.strictEqual((await call(later, 'POST', '/lines', elsewhere.body.token, batch)).status, 401, 'vps2 is still bound to 10.1.2.3');
    assert.deepStrictEqual((await clickhouse_query(CLICKHOUSE, `SELECT count() FROM ${table}`)).trim(), '2');
});

async function serve(t, options)
{
    const server = lines_serve(Object.assign({admin_token: ADMIN_TOKEN, admin_ips: ['127.0.0.1'], uid: 'ctest0000000'}, options));
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    return {port: server.address().port};
}

async function call(running, method, pathname, token, body)
{
    const answer = await fetch(`http://127.0.0.1:${running.port}${pathname}`, {
        method,
        headers: {authorization: `Bearer ${token}`},
        body: ((body === undefined) ? undefined : JSON.stringify(body)),
    });
    return {status: answer.status, body: await answer.json()};
}
