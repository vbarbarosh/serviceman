const assert = require('assert');
const data_browser_serve = require('../server/data_browser_serve');
const http = require('http');
const mongodb_adapter = require('../server/mongodb_adapter');
const test = require('node:test');

// The API over MongoDB's adapter, its scripts answered by a fake run that reads the ask they
// carry: what the page asks reaches the script as data, and every answer and refusal comes back
// as the page reads it
test('collections and a page of documents are read, the ask going in as data', async function (t) {
    const scripts = [];
    const running = await serve(t, function (script) {
        scripts.push(script);
        const ask = JSON.parse(/^const ask = (.*);$/m.exec(script)[1]);
        if (script.includes('getCollectionInfos')) {
            return answer({ok: [{name: 'items', type: 'collection', count: 2, bytes: 191, storage_bytes: 4096, index_bytes: 4096, indexes: 1}]});
        }
        if (ask.collection === 'gone') {
            return answer({error: 'no collection called gone in orders', code: null});
        }
        if (ask.collection === 'slow') {
            return answer({error: 'operation exceeded time limit', code: 'MaxTimeMSExpired'});
        }
        return answer({ok: {items: [{_id: {$oid: '6b08111da665b663b25ba166'}, n: 5}], count: 1, took_ms: 3, cut: false, ask}});
    });

    const about = await call(running, '/browse');
    assert.deepStrictEqual([about.status, about.body], [200, {engine: 'mongodb', database: 'orders', server: 'mongodb-1'}]);
    const collections = await call(running, '/browse/collections');
    assert.deepStrictEqual(collections.body.items.map(v => `${v.name} ${v.count}`), ['items 2']);

    const found = await call(running, '/browse/documents?' + new URLSearchParams({collection: 'it"ems', filter: '{_id: ObjectId(\'6b08111da665b663b25ba166\'), name: "x\\");db.dropDatabase();//"}', sort: '{n: -1}', skip: '50', limit: '20'}));
    assert.strictEqual(found.status, 200);
    assert.deepStrictEqual([found.body.skip, found.body.limit, found.body.count, found.body.items.length], [50, 20, 1, 1]);
    // The name, the filter and the sort are strings of the ask, the filter as Extended JSON
    const ask = found.body.ask;
    assert.deepStrictEqual([ask.collection, JSON.parse(ask.filter), JSON.parse(ask.sort), JSON.parse(ask.fields), ask.skip, ask.limit], ['it"ems', {_id: {$oid: '6b08111da665b663b25ba166'}, name: 'x");db.dropDatabase();//'}, {n: -1}, {}, 50, 20]);
    assert.deepStrictEqual(scripts[scripts.length - 1].split('\n').filter(v => v.includes('dropDatabase')).map(v => v.slice(0, 12)), ['const ask = '], 'what is typed is in the ask\'s string alone');

    const defaults = await call(running, '/browse/documents?collection=items');
    assert.deepStrictEqual([defaults.body.skip, defaults.body.limit, defaults.body.ask.filter], [0, 50, '{}']);

    const refusals = [
        ['/browse/documents', 400, /^\?collection names the collection/],
        ['/browse/documents?collection=items&limit=500', 400, /^\?limit is a whole number from 1 to 200$/],
        ['/browse/documents?collection=items&skip=-1', 400, /^\?skip is a whole number from 0/],
        ['/browse/documents?collection=items&skip=1.5', 400, /^\?skip is a whole number/],
        ['/browse/documents?collection=items&filter=' + encodeURIComponent('{a: db.x()}'), 400, /^the filter: "db\.x" is not a value/],
        ['/browse/documents?collection=items&sort=' + encodeURIComponent('{a: 1'), 400, /^the sort: a comma or } was expected/],
        ['/browse/documents?collection=items&fields=' + encodeURIComponent('[1]'), 400, /^the fields is a document in braces/],
        ['/browse/documents?collection=items&filter=' + encodeURIComponent('"x"'), 400, /^the filter is a document in braces/],
        ['/browse/documents?collection=gone', 400, /^no collection called gone in orders$/],
        ['/browse/documents?collection=slow', 400, /^it took longer than 20 s, and MongoDB stopped it: an index/],
        ['/browse/nothing', 404, /^no such door: \/nothing$/],
    ];
    for (const [path, status, said] of refusals) {
        const refused = await call(running, path);
        assert.strictEqual(refused.status, status, path);
        assert.match(refused.body.error, said, path);
    }
    // A pipeline: its stages go in as data, none that writes
    const piped = await call(running, '/browse/aggregate?' + new URLSearchParams({collection: 'items', pipeline: '[{$match: {n: {$gt: 1}}}, {$group: {_id: \'$city\', n: {$sum: 1}}},]', limit: '10'}));
    assert.deepStrictEqual([piped.status, JSON.parse(piped.body.ask.pipeline), piped.body.ask.skip, piped.body.ask.limit], [200, [{$match: {n: {$gt: 1}}}, {$group: {_id: '$city', n: {$sum: 1}}}], 0, 10]);
    const pipes = [
        ['', 200, null],
        ['{$match: {}}', 400, /^the pipeline is a list of stages in brackets/],
        ['[{$match: {}, $limit: 2}]', 400, /^the pipeline's stage 1 is a document of one stage/],
        ['[{$match: {}}, 7]', 400, /^the pipeline's stage 2 is a document of one stage/],
        ['[{$out: \'copy\'}]', 400, /^the pipeline's \$out writes into the database/],
        ['[{$merge: {into: \'copy\'}}]', 400, /^the pipeline's \$merge writes into the database/],
        ['[{$match: {a: db.x()}}]', 400, /^the pipeline: "db\.x" is not a value/],
    ];
    for (const [pipeline, status, said] of pipes) {
        const answer = await call(running, '/browse/aggregate?' + new URLSearchParams({collection: 'items', pipeline}));
        assert.strictEqual(answer.status, status, pipeline);
        if (said !== null) {
            assert.match(answer.body.error, said, pipeline);
        }
    }
    const long = await call(running, '/browse/documents?collection=items&filter=' + 'x'.repeat(9000));
    assert.match(long.body.error, /^the filter is longer than 8 KB$/);
    const changed = await call(running, '/browse/collections', 'POST');
    assert.strictEqual(changed.status, 405);
    assert.strictEqual(scripts.length, 7, 'a refused ask runs nothing');
});

test('a database not reached, or a client that printed no answer, is 502', async function (t) {
    const said = await serve(t, () => 'MongoServerError: Authentication failed.\n');
    const refused = await call(said, '/browse/collections');
    assert.deepStrictEqual([refused.status, refused.body.error], [502, 'mongosh printed no answer: MongoServerError: Authentication failed.']);
    const thrown = await serve(t, function () {
        throw new Error('vps1 is not connected');
    });
    const away = await call(thrown, '/browse/collections');
    assert.deepStrictEqual([away.status, away.body.error], [502, 'vps1 is not connected']);
});

function answer(value)
{
    return `Warning: something mongosh says first\nserviceman-answer ${JSON.stringify(value)}\n`;
}

async function serve(t, run)
{
    const server = http.createServer(function (req, res) {
        const url = new URL(req.url, 'http://test.invalid');
        data_browser_serve(req, res, {adapter: mongodb_adapter(async v => run(v)), about: {database: 'orders', server: 'mongodb-1'}, tail: url.pathname.slice('/browse'.length), query: url.searchParams});
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => new Promise(v => server.close(v)));
    return {port: server.address().port};
}

async function call(running, path, method)
{
    const answered = await fetch(`http://127.0.0.1:${running.port}${path}`, {method: method || 'GET'});
    return {status: answered.status, body: await answered.json()};
}
