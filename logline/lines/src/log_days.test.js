const assert = require('assert');
const http = require('http');
const lines_serve = require('./lines_serve');
const os = require('os');
const path = require('path');
const test = require('node:test');

const ADMIN_TOKEN = 'a'.repeat(64);

// A ClickHouse that answers the queries /days asks as a table kept by day would, and drops what
// it is told to: three days, the middle one the biggest, and a part that is no day
async function clickhouse_fake(t, options)
{
    const out = {queries: [], parts: [
        {id: '20261015', rows: '1000', bytes: '2000000', raw: '9000000'},
        {id: '20261016', rows: '5000', bytes: '7000000', raw: '30000000'},
        {id: '20261024', rows: '300', bytes: '400000', raw: '1500000'},
        {id: 'all', rows: '7', bytes: '1000', raw: '2000'},
    ]};
    const server = http.createServer(function (req, res) {
        const sql = new URL(req.url, 'http://clickhouse').searchParams.get('query');
        out.queries.push(sql);
        const dropped = /DROP PARTITION ID '(\d+)'/.exec(sql);
        if (dropped !== null) {
            if (dropped[1] === options.fails) {
                res.writeHead(500);
                res.end('Code: 359. DB::Exception: Table or Partition in default.otel_logs was not dropped');
                return;
            }
            out.parts = out.parts.filter(v => v.id !== dropped[1]);
            res.end('');
            return;
        }
        if (sql.includes('system.parts')) {
            res.end(out.parts.map(v => JSON.stringify(v)).join('\n'));
            return;
        }
        res.end(`${JSON.stringify({today: '2026-10-24', engine: options.engine})}\n`);
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    out.address = `http://lines:@127.0.0.1:${server.address().port}`;
    return out;
}

async function serve(t, clickhouse)
{
    const server = lines_serve({admin_token: ADMIN_TOKEN, admin_ips: ['127.0.0.1'], clickhouse, table: 'default.otel_logs', tokens_file: path.join(os.tmpdir(), 'lines-days-none.json'), uid: 'ctest0000000'});
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    return async function (method, url, token, body) {
        const answer = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {method, headers: {authorization: `Bearer ${token}`}, body: (body === undefined) ? undefined : JSON.stringify(body)});
        return {status: answer.status, body: await answer.json()};
    };
}

// The sizes of each day, from what ClickHouse keeps of its parts; the table's own TTL said
test('the days of lines are told with their sizes, to the admin alone', async function (t) {
    const clickhouse = await clickhouse_fake(t, {engine: 'MergeTree PARTITION BY toDate(TimestampTime) ORDER BY (ServiceName, TimestampTime) TTL TimestampTime + toIntervalDay(30) SETTINGS index_granularity = 8192'});
    const call = await serve(t, clickhouse.address);

    assert.strictEqual((await call('GET', '/days', 'wrong')).status, 401);
    const days = await call('GET', '/days', ADMIN_TOKEN);
    assert.strictEqual(days.status, 200);
    assert.deepStrictEqual(days.body, {
        table: 'default.otel_logs',
        today: '2026-10-24',
        ttl: 'TimestampTime + toIntervalDay(30)',
        days: [
            {day: '2026-10-15', rows: 1000, bytes: 2000000, raw: 9000000},
            {day: '2026-10-16', rows: 5000, bytes: 7000000, raw: 30000000},
            {day: '2026-10-24', rows: 300, bytes: 400000, raw: 1500000},
        ],
        undated: {rows: 7, bytes: 1000, raw: 2000},
    });
    const reads = clickhouse.queries.filter(v => /^\s*SELECT/.test(v));
    assert.strictEqual(reads.length, 2);
    assert.ok(reads.every(v => (/otel_logs/.test(v) === false) && /\{table:String\}/.test(v)), 'the table is a parameter, never pasted into a read');
});

// Every day before the one asked is dropped whole, by its partition; today never is
test('the days before one are dropped, and nothing else', async function (t) {
    const clickhouse = await clickhouse_fake(t, {engine: 'MergeTree'});
    const call = await serve(t, clickhouse.address);

    assert.strictEqual((await call('POST', '/days/forget', 'wrong', {before: '2026-10-17'})).status, 401);
    for (const before of [undefined, '17.10.2026', '2026-02-30', '2026-13-01', '2026-10-17; DROP TABLE x']) {
        const refused = await call('POST', '/days/forget', ADMIN_TOKEN, {before});
        assert.strictEqual(refused.status, 400, String(before));
    }
    const ahead = await call('POST', '/days/forget', ADMIN_TOKEN, {before: '2026-10-25'});
    assert.strictEqual(ahead.status, 400);
    assert.match(ahead.body.error, /today's lines are never dropped/);
    assert.ok(clickhouse.queries.every(v => /DROP/.test(v) === false), 'nothing was dropped on a refusal');

    const done = await call('POST', '/days/forget', ADMIN_TOKEN, {before: '2026-10-17'});
    assert.strictEqual(done.status, 200);
    assert.deepStrictEqual(done.body, {before: '2026-10-17', dropped: [{day: '2026-10-15', rows: 1000, bytes: 2000000}, {day: '2026-10-16', rows: 5000, bytes: 7000000}], rows: 6000, bytes: 9000000});
    assert.deepStrictEqual(clickhouse.queries.filter(v => /DROP/.test(v)), ['ALTER TABLE default.otel_logs DROP PARTITION ID \'20261015\'', 'ALTER TABLE default.otel_logs DROP PARTITION ID \'20261016\'']);
    assert.deepStrictEqual(clickhouse.parts.map(v => v.id), ['20261024', 'all'], 'today and what is no day stay');
    assert.deepStrictEqual((await call('POST', '/days/forget', ADMIN_TOKEN, {before: '2026-10-24'})).body.dropped, [], 'nothing before today is left');
});

// A drop ClickHouse refuses stops the rest, and the answer says how far it got
test('a day ClickHouse will not drop stops the rest, and says how many went', async function (t) {
    const clickhouse = await clickhouse_fake(t, {engine: 'MergeTree', fails: '20261016'});
    const call = await serve(t, clickhouse.address);
    const failed = await call('POST', '/days/forget', ADMIN_TOKEN, {before: '2026-10-24'});
    assert.strictEqual(failed.status, 502);
    assert.match(failed.body.error, /^1 of 2 days dropped, then 2026-10-16: clickhouse 500: Code: 359/);
    assert.deepStrictEqual(clickhouse.parts.map(v => v.id), ['20261016', '20261024', 'all']);
});
