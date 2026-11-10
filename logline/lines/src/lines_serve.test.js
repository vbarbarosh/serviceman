const assert = require('assert');
const fs = require('fs');
const http = require('http');
const lines_serve = require('./lines_serve');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('without an admin token the endpoint runs, and says why it issues nothing', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-'));
    const server = lines_serve({admin_token: null, admin_off: 'ADMIN_TOKEN is not set', admin_ips: [], clickhouse: 'http://127.0.0.1:9', table: 'default.otel_logs', tokens_file: path.join(dir, 'tokens.json'), uid: 'ctest0000000'});
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    const answer = await fetch(`http://127.0.0.1:${server.address().port}/tokens`, {method: 'POST', headers: {authorization: 'Bearer anything'}, body: JSON.stringify({name: 'vps1', ips: ['127.0.0.1']})});
    assert.strictEqual(answer.status, 503);
    assert.deepStrictEqual(await answer.json(), {error: 'no token is issued here: ADMIN_TOKEN is not set'});
    assert.strictEqual(fs.existsSync(path.join(dir, 'tokens.json')), false);
});

test('what ClickHouse refuses about the lines themselves is a 422; a store that is away, full or not right stays a 502', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-'));
    const store = await clickhouse_fake(t);
    const admin_token = 'a'.repeat(64);
    const server = lines_serve({admin_token, admin_ips: ['127.0.0.1'], clickhouse: `http://127.0.0.1:${store.port}`, table: 'default.otel_logs', tokens_file: path.join(dir, 'tokens.json'), uid: 'ctest0000000'});
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    const address = `http://127.0.0.1:${server.address().port}`;
    const issued = await fetch(`${address}/tokens`, {method: 'POST', headers: {authorization: `Bearer ${admin_token}`}, body: JSON.stringify({name: 'vps1', ips: ['127.0.0.1']})}).then(v => v.json());
    async function lines_post(to = address) {
        const answer = await fetch(`${to}/lines`, {method: 'POST', headers: {authorization: `Bearer ${issued.token}`}, body: JSON.stringify([{time: '2026-09-25T18:17:09Z', labels: {}, line: 'a line'}])});
        return [answer.status, (await answer.json()).error];
    }
    const partitions = 'Code: 252. DB::Exception: Too many partitions for single INSERT block (more than 100). The limit is controlled by \'max_partitions_per_insert_block\' setting. (TOO_MANY_PARTS)';
    const overflow = 'Code: 407. DB::Exception: Decimal math overflow: (while reading the value of key Timestamp): (at row 1)\n: While executing ParallelParsingBlockInputFormat. (DECIMAL_OVERFLOW)';
    // About the lines: the same batch gets the same answer however often it comes. The numbers
    // and the words are the ones ClickHouse's source has for these refusals
    store.answers = {status: 500, code: '252', text: partitions};
    assert.deepStrictEqual(await lines_post(), [422, `clickhouse 500: ${partitions}`], 'more days than one insert may span');
    store.answers = {status: 500, code: null, text: partitions};
    assert.strictEqual((await lines_post())[0], 422, 'with no header for it, the number is read from what ClickHouse says');
    store.answers = {status: 500, code: '407', text: overflow};
    assert.deepStrictEqual(await lines_post(), [422, 'clickhouse 500: Code: 407. DB::Exception: Decimal math overflow: (while reading the value of key Timestamp): (at row 1)'], 'a time past what the table holds');
    // About the store: the sender keeps the batch and sends it again
    const away = [
        {status: 500, code: '252', text: 'Code: 252. DB::Exception: Too many parts (300 with average size of 1.00 MiB) in table \'default.otel_logs\'. Merges are processing significantly slower than inserts. (TOO_MANY_PARTS)'},
        {status: 500, code: '243', text: 'Code: 243. DB::Exception: Cannot reserve 1.00 MiB, not enough space. (NOT_ENOUGH_SPACE)'},
        {status: 500, code: '241', text: 'Code: 241. DB::Exception: Memory limit (total) exceeded. (MEMORY_LIMIT_EXCEEDED)'},
        {status: 404, code: '60', text: 'Code: 60. DB::Exception: Table default.otel_logs does not exist. (UNKNOWN_TABLE)'},
        {status: 400, code: '16', text: 'Code: 16. DB::Exception: No such column LogAttributes in table default.otel_logs. (NO_SUCH_COLUMN_IN_TABLE)'},
        {status: 400, code: '27', text: 'Code: 27. DB::Exception: Cannot parse input: expected \'"\' before: \'{"remote":"vps1"}\'. (CANNOT_PARSE_INPUT_ASSERTION_FAILED)'},
        {status: 403, code: '516', text: 'Code: 516. DB::Exception: lines: Authentication failed. (AUTHENTICATION_FAILED)'},
        {status: 503, code: null, text: 'Service Unavailable'},
        {status: 500, code: null, text: ''},
    ];
    for (const answers of away) {
        store.answers = answers;
        assert.strictEqual((await lines_post())[0], 502, `${answers.status} ${answers.text}`);
    }
    // No ClickHouse at its address at all, asked by an endpoint with the same tokens
    const cut_off = lines_serve({admin_token, admin_ips: ['127.0.0.1'], clickhouse: 'http://127.0.0.1:9', table: 'default.otel_logs', tokens_file: path.join(dir, 'tokens.json'), uid: 'ctest0000000'});
    await new Promise(v => cut_off.listen(0, '127.0.0.1', v));
    t.after(function () {
        cut_off.closeAllConnections();
        cut_off.close();
    });
    assert.deepStrictEqual(await lines_post(`http://127.0.0.1:${cut_off.address().port}`), [502, 'fetch failed']);
    store.answers = null;
    assert.deepStrictEqual(await lines_post(), [200, undefined], 'and once the store takes lines again, they go in');
});

// ClickHouse as far as the endpoint asks it: it takes whatever comes, or refuses an INSERT with
// what `answers` says, {status, code, text}: {port, answers}
async function clickhouse_fake(t)
{
    const out = {port: null, answers: null};
    const server = http.createServer(function (req, res) {
        req.resume();
        req.on('end', function () {
            const refused = new URL(req.url, 'http://clickhouse').searchParams.get('query').startsWith('INSERT') ? out.answers : null;
            if (refused === null) {
                res.end('');
                return;
            }
            res.writeHead(refused.status, (refused.code === null) ? {} : {'x-clickhouse-exception-code': refused.code});
            res.end(`${refused.text}\n`);
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    out.port = server.address().port;
    return out;
}
