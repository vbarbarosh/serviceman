const assert = require('assert');
const data_browser_serve = require('../server/data_browser_serve');
const http = require('http');
const mongodb_adapter = require('../server/mongodb_adapter');
const mysql_adapter = require('../server/mysql_adapter');
const postgresql_adapter = require('../server/postgresql_adapter');
const sqlite_adapter = require('../server/sqlite_adapter');
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
    assert.strictEqual(changed.status, 404);
    assert.strictEqual(scripts.length, 7, 'a refused ask runs nothing');
});

// A document added, put in place of another and deleted: what is sent goes into the script as
// data, the id as the page answered it, and every refusal is said
test('a document is added, put in place of another and deleted, the document typed as the shell types it', async function (t) {
    const asks = [];
    const running = await serve(t, function (script) {
        const ask = JSON.parse(/^const ask = (.*);$/m.exec(script)[1]);
        asks.push(ask);
        if (ask.collection === 'gone') {
            return answer({error: 'it is not there any more: deleted since the page was read', code: null});
        }
        return answer({ok: {id: (ask.id === undefined) ? {$oid: '6b08111da665b663b25ba166'} : JSON.parse(ask.id)}});
    });
    const added = await call(running, '/browse/documents', 'POST', {collection: 'items', document: '{name: \'a\', at: ISODate(\'2026-11-26\')}'});
    assert.deepStrictEqual([added.status, added.body], [201, {id: {$oid: '6b08111da665b663b25ba166'}}]);
    assert.deepStrictEqual(JSON.parse(asks[0].document), {name: 'a', at: {$date: '2026-11-26T00:00:00.000Z'}});
    const replaced = await call(running, '/browse/documents/replace', 'POST', {collection: 'items', id: {$oid: '6b08111da665b663b25ba166'}, document: '{name: \'b\'}'});
    assert.deepStrictEqual([replaced.status, JSON.parse(asks[1].id), JSON.parse(asks[1].document)], [200, {$oid: '6b08111da665b663b25ba166'}, {name: 'b'}]);
    const removed = await call(running, '/browse/documents/delete', 'POST', {collection: 'items', id: 7});
    assert.deepStrictEqual([removed.status, removed.body, asks[2].document], [200, {id: 7}, undefined]);

    const refusals = [
        ['/browse/documents', {document: '{}'}, 400, /^collection names the collection asked of$/],
        ['/browse/documents', {collection: 'items', document: '[1]'}, 400, /^the document is a document in braces/],
        ['/browse/documents', {collection: 'items', document: '{a: db.x()}'}, 400, /^the document: "db\.x" is not a value/],
        ['/browse/documents/replace', {collection: 'items', document: '{}'}, 400, /^id is the _id of the document/],
        ['/browse/documents/delete', {collection: 'items'}, 400, /^id is the _id of the document/],
        ['/browse/documents/delete', {collection: 'gone', id: 1}, 400, /^it is not there any more/],
        ['/browse/documents/drop', {collection: 'items'}, 404, /^no such door: \/documents\/drop$/],
    ];
    for (const [path, body, status, said] of refusals) {
        const answered = await call(running, path, 'POST', body);
        assert.strictEqual(answered.status, status, path);
        assert.match(answered.body.error, said, path);
    }
    const big = await call(running, '/browse/documents', 'POST', {collection: 'items', document: `{a: '${'x'.repeat(5*1024*1024)}'}`});
    assert.deepStrictEqual([big.status, big.body.error], [413, 'a document is 4 MB at most here']);
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

// PostgreSQL's page: what is typed reaches the script as the hex of its ask alone, never as
// text psql would read (a backslash command, a second statement); the rows come back keyed by
// column, a number kept whole, two columns of one name both kept; what PostgreSQL refused is 400
test('a PostgreSQL\'s page: what is typed goes in as hex, and its rows come back keyed by column', async function (t) {
    const asks = [];
    const scripts = [];
    const running = await serve(t, function (script) {
        scripts.push(script);
        const ask = JSON.parse(Buffer.from(/^SET LOCAL serviceman\.ask = '([0-9a-f]+)';$/m.exec(script)[1], 'hex').toString('utf8'));
        asks.push(ask);
        if (ask.collection === 'gone') {
            return 'serviceman-answer {"error": "no table called gone in shop", "code": "P0001", "hint": ""}\nserviceman-count \n';
        }
        if (ask.collection === 'wrong') {
            return 'serviceman-answer {"error": "column \\"nam\\" does not exist", "code": "42703", "hint": "Perhaps you meant to reference the column \\"items.name\\"."}\nserviceman-count \n';
        }
        if (ask.collection === 'writes') {
            return 'serviceman-answer {"error": "cannot execute DELETE in a read-only transaction", "code": "25006", "hint": ""}\nserviceman-count \n';
        }
        return 'serviceman-answer {"ok": {"names": ["id", "price", "id"], "rows": [[1, 2.50, 7], [9007199254740993, null, 8]], "more": false, "cut": false, "took_ms": 2}}\nserviceman-count 2\n';
    }, postgresql_adapter);

    const typed = 'name = \'x\'; DROP TABLE items; --\n\\! rm -rf /';
    const found = await call(running, '/browse/documents?' + new URLSearchParams({collection: 'it"ems', filter: typed, sort: 'ORDER BY id DESC', fields: 'id, price'}));
    assert.strictEqual(found.status, 200, JSON.stringify(found.body));
    assert.deepStrictEqual(found.body, {skip: 0, limit: 50, items: [{'id': 1, 'price': {$numberDecimal: '2.50'}, 'id (2)': 7}, {'id': {$numberLong: '9007199254740993'}, 'price': null, 'id (2)': 8}], columns: ['id', 'price', 'id (2)'], count: 2, more: false, took_ms: 2, cut: false});
    assert.deepStrictEqual([asks[0].collection, asks[0].filter, asks[0].sort, asks[0].fields, asks[0].skip, asks[0].limit], ['it"ems', typed, 'id DESC', 'id, price', 0, 50]);
    assert.deepStrictEqual(scripts[0].split('\n').filter(v => v.includes('DROP TABLE') || v.includes('rm -rf') || v.includes('it"ems')), [], 'what is typed is in the ask\'s hex alone');
    assert.match(scripts[0], /^BEGIN TRANSACTION READ ONLY;$/m);

    const query = await call(running, '/browse/aggregate?' + new URLSearchParams({collection: 'items', pipeline: 'SELECT 1;'}));
    assert.deepStrictEqual([query.status, query.body.count, query.body.more, asks[1].query], [200, null, false, 'SELECT 1']);
    const refusals = [
        ['/browse/documents?collection=gone', 400, 'no table called gone in shop'],
        ['/browse/documents?collection=wrong', 400, 'column "nam" does not exist (Perhaps you meant to reference the column "items.name".)'],
        ['/browse/aggregate?collection=writes', 400, 'it writes, and what is typed here is only read, a row being changed by its own buttons: cannot execute DELETE in a read-only transaction'],
    ];
    for (const [path, status, said] of refusals) {
        const refused = await call(running, path);
        assert.deepStrictEqual([refused.status, refused.body.error], [status, said], path);
    }
    const silent = await serve(t, () => 'psql: error: connection to server at "127.0.0.1", port 5432 failed\n', postgresql_adapter);
    const away = await call(silent, '/browse/collections');
    assert.deepStrictEqual([away.status, away.body.error], [502, 'psql printed no answer: psql: error: connection to server at "127.0.0.1", port 5432 failed']);
});

// MySQL's page: what is typed reaches the script as hex alone, prepared as one statement; the
// client's column types read its XML's values, NULL apart from the word NULL; a count past its
// limit leaves the page without it; what MySQL refused is 400, what the client could not do 502
test('a MySQL\'s page: what is typed goes in as hex, and its values are read by their column\'s type', async function (t) {
    const scripts = [];
    const running = await serve(t, function (script) {
        scripts.push(script);
        const texts = Array.from(script.matchAll(/X'([0-9a-f]*)'/g), v => Buffer.from(v[1], 'hex').toString('utf8'));
        if (texts.some(v => v.includes('`syntax`'))) {
            throw new Error('ERROR 1064 (42000) at line 9: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near \'x\n) LIMIT 0\' at line 2');
        }
        if (texts.some(v => v.includes('`away`'))) {
            throw new Error('ERROR 2002 (HY000): Can\'t connect to MySQL server on \'127.0.0.1:3306\' (111)');
        }
        const printed = [
            'Field   1:  `id`', 'Type:       LONGLONG', '', 'Field   2:  `name`', 'Type:       VAR_STRING', '', 'Field   3:  `price`', 'Type:       NEWDECIMAL', '', 'Field   4:  `doc`', 'Type:       JSON', '',
            '<?xml version="1.0"?>',
            '<resultset statement="EXECUTE serviceman_page" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
            '  <row>', '\t<field name="id">9007199254740993</field>', '\t<field name="name">NULL</field>', '\t<field name="price">2.50</field>', '\t<field name="doc">{&quot;a&quot;: [1, 2]}</field>', '  </row>',
            '  <row>', '\t<field name="id">2</field>', '\t<field name="name" xsi:nil="true" />', '\t<field name="price">3.25</field>', '\t<field name="doc">&lt;b&gt; &amp;</field>', '  </row>',
            '</resultset>',
            '<?xml version="1.0"?>',
            '<resultset statement="EXECUTE serviceman_took" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
            '  <row>', '\t<field name="took_ms">4</field>', '  </row>',
            '</resultset>',
            '',
        ].join('\n');
        if (texts.some(v => v.includes('`slow`'))) {
            throw Object.assign(new Error('ERROR 3024 (HY000) at line 14: Query execution was interrupted, maximum statement execution time exceeded'), {stdout: printed});
        }
        return `${printed}<?xml version="1.0"?>\n<resultset statement="EXECUTE serviceman_count" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <row>\n\t<field name="n">2</field>\n  </row>\n</resultset>\n`;
    }, mysql_adapter);

    const typed = 'name = \'x\'; DROP TABLE items; -- \\! rm -rf /';
    const found = await call(running, '/browse/documents?' + new URLSearchParams({collection: 'it`ems', filter: typed}));
    assert.strictEqual(found.status, 200, JSON.stringify(found.body));
    assert.deepStrictEqual(found.body, {skip: 0, limit: 50, items: [{id: {$numberLong: '9007199254740993'}, name: 'NULL', price: {$numberDecimal: '2.50'}, doc: {a: [1, 2]}}, {id: 2, name: null, price: 3.25, doc: '<b> &'}], columns: ['id', 'name', 'price', 'doc'], count: 2, more: false, took_ms: 4, cut: false});
    assert.deepStrictEqual(scripts[0].split('\n').filter(v => v.includes('DROP TABLE') || v.includes('rm -rf') || v.includes('it`ems')), [], 'what is typed is in hex alone');
    const texts = Array.from(scripts[0].matchAll(/X'([0-9a-f]*)'/g), v => Buffer.from(v[1], 'hex').toString('utf8'));
    assert.deepStrictEqual(texts, [
        `SELECT * FROM \`it\`\`ems\` WHERE (\n${typed}\n) LIMIT 0`,
        `SELECT * FROM \`it\`\`ems\` WHERE (\n${typed}\n) LIMIT 0, 51`,
        `SELECT COUNT(*) AS n FROM \`it\`\`ems\` WHERE (\n${typed}\n)`,
    ]);
    assert.match(scripts[0], /^SET SESSION TRANSACTION READ ONLY;\nSTART TRANSACTION READ ONLY;$/m);

    const slow = await call(running, '/browse/documents?collection=slow');
    assert.deepStrictEqual([slow.status, slow.body.count, slow.body.items.length], [200, null, 2]);
    const refusals = [
        ['/browse/aggregate?collection=items&pipeline=' + encodeURIComponent('DELETE FROM `syntax`'), 400, 'only what one SELECT gives is read here, a row being changed by its own buttons: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near \'x ) LIMIT 0\' at line 2'],
        ['/browse/documents?collection=away', 502, 'ERROR 2002 (HY000): Can\'t connect to MySQL server on \'127.0.0.1:3306\' (111)'],
    ];
    for (const [path, status, said] of refusals) {
        const refused = await call(running, path);
        assert.deepStrictEqual([refused.status, refused.body.error], [status, said], path);
    }
});

// A PostgreSQL's row changed: a transaction of its own, its ask in hex alone, the row and its
// key JSON for the block to read by the columns' types; an edit sends the columns changed alone
// with what they held when read; another hand's change is 409, with the columns and the row now
test('a PostgreSQL\'s row is added, edited and deleted by its key, what is typed going in as hex', async function (t) {
    const scripts = [];
    const asks = [];
    const running = await serve(t, function (script) {
        scripts.push(script);
        const ask = JSON.parse(Buffer.from(/^SET LOCAL serviceman\.ask = '([0-9a-f]+)';$/m.exec(script)[1], 'hex').toString('utf8'));
        asks.push(ask);
        if (ask.collection === 'events') {
            return 'serviceman-answer {"error": "events has no primary key, nor a unique key of NOT NULL columns, to name one row by: its rows are read alone", "code": "SMRO1", "hint": null, "detail": null}\n';
        }
        if (ask.collection === 'lines') {
            return 'serviceman-answer {"error": "insert or update on table \\"lines\\" violates foreign key constraint \\"lines_order_id_fkey\\"", "code": "23503", "hint": null, "detail": "Key (order_id)=(999) is not present in table \\"orders\\"."}\n';
        }
        const changed = (ask.collection === 'conflict') ? ['status'] : [];
        return `serviceman-answer {"ok": {"names": ["id", "status", "big"], "row": [9007199254740993, "shipped", 12.50], "key": ["id"], "changed": ${JSON.stringify(changed)}, "columns": ["id", "status", "big"], "filled": ["id"]}}\n`;
    }, postgresql_adapter);

    const typed = '{"status": "x\'); DROP TABLE items; --\\n\\\\! rm -rf /", "big": 12345678901234567890}';
    const added = await call(running, '/browse/documents', 'POST', {collection: 'it"ems', document: typed});
    assert.deepStrictEqual([added.status, added.body], [201, {id: {id: {$numberLong: '9007199254740993'}}, item: {id: {$numberLong: '9007199254740993'}, status: 'shipped', big: {$numberDecimal: '12.50'}}, saved: ['status', 'big']}]);
    assert.match(scripts[0], /^BEGIN;\nSET LOCAL serviceman\.ask = '[0-9a-f]+';\n/);
    assert.match(scripts[0], /^COMMIT;$/m);
    assert.doesNotMatch(scripts[0], /READ ONLY/);
    assert.deepStrictEqual(scripts[0].split('\n').filter(v => v.includes('DROP TABLE') || v.includes('rm -rf') || v.includes('it"ems')), [], 'what is typed is in the ask\'s hex alone');
    assert.deepStrictEqual(asks[0], {collection: 'it"ems', id: null, set: {status: 'x\'); DROP TABLE items; --\n\\! rm -rf /', big: 12345678901234567890}, was: null});
    assert.match(Buffer.from(/^SET LOCAL serviceman\.ask = '([0-9a-f]+)';$/m.exec(scripts[0])[1], 'hex').toString('utf8'), /"big":12345678901234567890[,}]/, 'a number goes in by its digits');

    // An edit: the columns changed alone, with what they held when read
    const was = '{"id": 7, "status": "new", "big": 9007199254740993}';
    const saved = await call(running, '/browse/documents/replace', 'POST', {collection: 'items', id: {id: 7}, document: '{"id": 7, "status": "paid", "big": 9007199254740993}', was});
    assert.deepStrictEqual([saved.status, saved.body.saved, asks[1].id, asks[1].set, asks[1].was], [200, ['status'], {id: 7}, {status: 'paid'}, {status: 'new'}]);
    const conflict = await call(running, '/browse/documents/replace', 'POST', {collection: 'conflict', id: {id: 7}, document: '{"status": "paid"}', was});
    assert.deepStrictEqual([conflict.status, conflict.body.error, conflict.body.changed, conflict.body.item.status], [409, 'it changed since it was read, by another hand: status is "shipped" now', ['status'], 'shipped']);
    const removed = await call(running, '/browse/documents/delete', 'POST', {collection: 'items', id: {id: 7}});
    assert.deepStrictEqual([removed.status, asks[3].id, asks[3].set], [200, {id: 7}, null]);
    const read = await call(running, '/browse/document?' + new URLSearchParams({collection: 'items', id: JSON.stringify({id: {$numberLong: '9007199254740993'}})}));
    assert.deepStrictEqual([read.status, read.body.columns, read.body.filled], [200, ['id', 'status', 'big'], ['id']]);
    assert.match(scripts[4], /^BEGIN TRANSACTION READ ONLY;$/m, 'a row read for Edit is read in a READ ONLY transaction');
    assert.match(Buffer.from(/^SET LOCAL serviceman\.ask = '([0-9a-f]+)';$/m.exec(scripts[4])[1], 'hex').toString('utf8'), /"id":\{"id":9007199254740993\}/);

    const refusals = [
        ['POST', '/browse/documents', {collection: 'events', document: '{}'}, 405, /^events has no primary key/],
        ['POST', '/browse/documents', {collection: 'lines', document: '{"order_id": 999}'}, 400, 'insert or update on table "lines" violates foreign key constraint "lines_order_id_fkey": Key (order_id)=(999) is not present in table "orders".'],
        ['POST', '/browse/documents', {collection: 'items', document: '[1]'}, 400, /^the row is a JSON object of its columns/],
        ['POST', '/browse/documents', {collection: 'items', document: '{"n": 1e999}'}, 400, 'Infinity is no number JSON holds: write it as text, "Infinity"'],
        ['POST', '/browse/documents/replace', {collection: 'items', id: 7, document: '{}'}, 400, /^id names the row by its key/],
        ['POST', '/browse/documents/replace', {collection: 'items', id: {id: 7}, document: '{}', was: '{oops'}, 400, /^the row as it was read is no JSON/],
        ['GET', '/browse/document?collection=items&id=' + encodeURIComponent('{id'), null, 400, /^\?id is the row's key as JSON/],
        ['GET', '/browse/document?id=1', null, 400, /^\?collection names the table/],
    ];
    for (const [method, path, body, status, said] of refusals) {
        const refused = await call(running, path, method, (body === null) ? undefined : body);
        assert.strictEqual(refused.status, status, path);
        assert.match(refused.body.error, (typeof said === 'string') ? new RegExp(`^${said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : said, path);
    }
    assert.strictEqual(scripts.length, 7, 'a refused ask runs nothing');
});

// A MySQL's row changed: its table described first, then each value a hex literal of its own in
// a statement that goes in as hex, prepared; the client's first run writes nothing
test('a MySQL\'s row is added by its columns as described, what is typed going in as hex', async function (t) {
    const scripts = [];
    const described = [
        '<?xml version="1.0"?>',
        '<resultset statement="EXECUTE serviceman_database" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">', '  <row>', '\t<field name="name">shop</field>', '  </row>', '</resultset>',
        '<resultset statement="EXECUTE serviceman_table" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">', '  <row>', '\t<field name="type">BASE TABLE</field>', '  </row>', '</resultset>',
        '<resultset statement="EXECUTE serviceman_columns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
        '  <row>', '\t<field name="COLUMN_NAME">id</field>', '\t<field name="DATA_TYPE">bigint</field>', '\t<field name="COLUMN_TYPE">bigint unsigned</field>', '\t<field name="COLUMN_DEFAULT" xsi:nil="true" />', '\t<field name="EXTRA">auto_increment</field>', '\t<field name="NUMERIC_PRECISION">20</field>', '\t<field name="NUMERIC_SCALE">0</field>', '\t<field name="DATETIME_PRECISION" xsi:nil="true" />', '  </row>',
        '  <row>', '\t<field name="COLUMN_NAME">name</field>', '\t<field name="DATA_TYPE">varchar</field>', '\t<field name="COLUMN_TYPE">varchar(50)</field>', '\t<field name="COLUMN_DEFAULT" xsi:nil="true" />', '\t<field name="EXTRA"></field>', '\t<field name="NUMERIC_PRECISION" xsi:nil="true" />', '\t<field name="NUMERIC_SCALE" xsi:nil="true" />', '\t<field name="DATETIME_PRECISION" xsi:nil="true" />', '  </row>',
        '  <row>', '\t<field name="COLUMN_NAME">raw</field>', '\t<field name="DATA_TYPE">varbinary</field>', '\t<field name="COLUMN_TYPE">varbinary(4)</field>', '\t<field name="COLUMN_DEFAULT" xsi:nil="true" />', '\t<field name="EXTRA"></field>', '\t<field name="NUMERIC_PRECISION" xsi:nil="true" />', '\t<field name="NUMERIC_SCALE" xsi:nil="true" />', '\t<field name="DATETIME_PRECISION" xsi:nil="true" />', '  </row>',
        '</resultset>',
        '<resultset statement="EXECUTE serviceman_keys" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">', '  <row>', '\t<field name="name">items</field>', '\t<field name="key_name">PRIMARY</field>', '\t<field name="column_name">id</field>', '\t<field name="nullable"></field>', '\t<field name="part" xsi:nil="true" />', '  </row>', '</resultset>',
        '',
    ].join('\n');
    const added = [
        'Field   1:  `id`', 'Type:       LONGLONG', '', 'Field   2:  `name`', 'Type:       VAR_STRING', '', 'Field   3:  `raw`', 'Type:       VAR_STRING', '',
        '<?xml version="1.0"?>',
        '<resultset statement="EXECUTE serviceman_row" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">', '  <row>', '\t<field name="id">12</field>', '\t<field name="name">x\'); DROP TABLE items; --</field>', '\t<field name="raw">0x00FF</field>', '  </row>', '</resultset>',
        '',
    ].join('\n');
    const running = await serve(t, function (script) {
        scripts.push(script);
        const texts = Array.from(script.matchAll(/X'([0-9a-f]*)'/g), v => Buffer.from(v[1], 'hex').toString('utf8'));
        return texts.some(v => v.includes('information_schema.COLUMNS')) ? described : added;
    }, mysql_adapter);

    const done = await call(running, '/browse/documents', 'POST', {collection: 'items', document: '{"name": "x\'); DROP TABLE items; --", "raw": "0x00FF"}'});
    assert.deepStrictEqual([done.status, done.body], [201, {id: {id: 12}, item: {id: 12, name: 'x\'); DROP TABLE items; --', raw: '0x00FF'}, saved: ['name', 'raw']}]);
    assert.strictEqual(scripts.length, 2);
    assert.deepStrictEqual(scripts[1].split('\n').filter(v => v.includes('DROP TABLE')), [], 'what is typed is in hex alone');
    assert.match(scripts[1], /^SET SESSION sql_mode = IF\(@@SESSION\.sql_mode = '', 'STRICT_ALL_TABLES', CONCAT\(@@SESSION\.sql_mode, ',STRICT_ALL_TABLES'\)\);$/m);
    assert.match(scripts[1], /^START TRANSACTION;$/m);
    assert.match(scripts[1], /^COMMIT;$/m);
    const texts = Array.from(scripts[1].matchAll(/CONVERT\(X'([0-9a-f]*)' USING utf8mb4\)/g), v => Buffer.from(v[1], 'hex').toString('utf8'));
    assert.match(scripts[1], /^SET @serviceman_sql = IF\(@serviceman_types = 1, 'DO 0', CONVERT\(X'[0-9a-f]+' USING utf8mb4\)\);\nPREPARE serviceman_change FROM @serviceman_sql;$/m, 'the client\'s first run writes nothing');
    assert.deepStrictEqual(texts, [
        `INSERT INTO \`items\` (\`name\`, \`raw\`) VALUES (_utf8mb4 X'${Buffer.from('x\'); DROP TABLE items; --').toString('hex')}', X'00FF')`,
        'SELECT * FROM `items` LIMIT 0',
        'SELECT * FROM `items` WHERE `id` = LAST_INSERT_ID()',
    ]);
    const unknown = await call(running, '/browse/documents', 'POST', {collection: 'items', document: '{"nope": 1}'});
    assert.deepStrictEqual([unknown.status, unknown.body.error, scripts.length], [400, 'no column `nope` in items', 3], 'an unknown column is found before anything is changed');
});

// A SQLite file's rows are read alone, and its adapter says why, before anything is asked
test('a SQLite file\'s rows are not changed here, and the answer says why', async function (t) {
    const running = await serve(t, () => assert.fail('nothing is asked of the file'), sqlite_adapter);
    for (const [path, body] of [['/browse/documents', {collection: 'notes', document: '{}'}], ['/browse/documents/replace', {collection: 'notes', id: {id: 1}, document: '{}'}], ['/browse/documents/delete', {collection: 'notes', id: {id: 1}}]]) {
        const refused = await call(running, path, 'POST', body);
        assert.deepStrictEqual([refused.status, refused.body.error], [405, 'a SQLite file is its app\'s own data: it is read here alone, never written under its app'], path);
    }
    assert.strictEqual((await call(running, '/browse/document?collection=notes')).status, 404);
});

function answer(value)
{
    return `Warning: something mongosh says first\nserviceman-answer ${JSON.stringify(value)}\n`;
}

// The API over an adapter, MongoDB's unless named, its scripts run by `run`
async function serve(t, run, adapter_of)
{
    const adapter = (adapter_of || mongodb_adapter)(async v => run(v));
    const server = http.createServer(function (req, res) {
        const url = new URL(req.url, 'http://test.invalid');
        data_browser_serve(req, res, {adapter, about: {database: 'orders', server: 'mongodb-1'}, tail: url.pathname.slice('/browse'.length), query: url.searchParams});
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => new Promise(v => server.close(v)));
    return {port: server.address().port};
}

async function call(running, path, method, body)
{
    const answered = await fetch(`http://127.0.0.1:${running.port}${path}`, {method: method || 'GET', body: (body === undefined) ? undefined : JSON.stringify(body)});
    return {status: answered.status, body: await answered.json().catch(() => ({error: 'no JSON'}))};
}
