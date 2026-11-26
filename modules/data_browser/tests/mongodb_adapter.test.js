const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const mongodb_adapter = require('../server/mongodb_adapter');
const os = require('os');
const path = require('path');
const test = require('node:test');

// MongoDB's adapter on a real MongoDB, its scripts run by mongosh in its container as a
// database's own user, the way serviceman runs them. DATA_BROWSER_MONGO names the container,
// its root's password in DATA_BROWSER_MONGO_ROOT; DATA_BROWSER_DOCKER the command, docker or
// podman. Skipped without them:
//
//     docker run -d --name mongo-test -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=pw mongo:8.0
//     DATA_BROWSER_MONGO=mongo-test DATA_BROWSER_MONGO_ROOT=pw node --test modules/data_browser/tests
const CONTAINER = process.env.DATA_BROWSER_MONGO;
const DOCKER = process.env.DATA_BROWSER_DOCKER || 'docker';
const DATABASE = 'browse_test';

test('a real MongoDB: its collections, a page of documents, a filter, a sort, the fields', {skip: (CONTAINER === undefined) && 'DATA_BROWSER_MONGO names no container'}, async function () {
    mongosh(`mongodb://root:${process.env.DATA_BROWSER_MONGO_ROOT}@127.0.0.1:27017/admin`, [
        `const d = db.getSiblingDB('${DATABASE}');`,
        'd.dropDatabase();',
        'd.dropAllUsers();',
        `d.createUser({user: '${DATABASE}', pwd: 'pw', roles: [{role: 'dbOwner', db: '${DATABASE}'}]});`,
        'd.items.insertMany(Array.from({length: 120}, (v, i) => ({n: i, name: `item ${i}`, even: (i % 2) === 0, at: new Date(Date.UTC(2026, 0, 1 + (i % 28))), big: NumberLong(\'9007199254740993\')})));',
        'd.items.insertOne({n: 1000, nested: {a: [1, {b: 2}]}, u: UUID(\'6d216dd0-d1cf-4376-b8c4-e5f69308c445\')});',
        'd.items.createIndex({name: 1});',
        'd.createCollection(\'empty\');',
        'd.createView(\'evens\', \'items\', [{$match: {even: true}}]);',
    ].join('\n'));
    const adapter = mongodb_adapter(v => mongosh(`mongodb://${DATABASE}:pw@127.0.0.1:27017/${DATABASE}`, v));

    const collections = await adapter.collections();
    assert.deepStrictEqual(collections.map(v => `${v.name} ${v.type} ${v.count} ${v.indexes}`), ['empty collection 0 1', 'evens view null null', 'items collection 121 2']);
    assert.strictEqual(collections[2].bytes > 0, true);

    const first = await adapter.documents({collection: 'items', filter: '', sort: '{n: 1}', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([first.items.length, first.count, first.cut, first.items[0].n, first.items[49].n], [50, 121, false, 0, 49]);
    assert.deepStrictEqual(Object.keys(first.items[0]), ['_id', 'n', 'name', 'even', 'at', 'big']);
    assert.deepStrictEqual([first.items[0].big, first.items[0].at, typeof first.items[0]._id.$oid], [{$numberLong: '9007199254740993'}, {$date: '2026-01-01T00:00:00Z'}, 'string']);

    const found = await adapter.documents({collection: 'items', filter: '{even: true, n: {$gte: 100}, at: {$gte: ISODate(\'2026-01-03\')}}', sort: '{n: -1}', fields: '{_id: 0, n: 1}', skip: 2, limit: 3});
    assert.deepStrictEqual([found.items, found.count], [[{n: 114}, {n: 110}, {n: 108}], 9]);
    const nested = await adapter.documents({collection: 'items', filter: '{u: UUID(\'6d216dd0-d1cf-4376-b8c4-e5f69308c445\')}', sort: '', fields: '{_id: 0}', skip: 0, limit: 50});
    assert.deepStrictEqual(nested.items, [{n: 1000, nested: {a: [1, {b: 2}]}, u: {$binary: {base64: 'bSFt0NHPQ3a4xOX2kwjERQ==', subType: '04'}}}]);
    const view = await adapter.documents({collection: 'evens', filter: '{name: /^item 1\\d$/}', sort: '{n: 1}', fields: '{_id: 0, n: 1}', skip: 0, limit: 50});
    assert.deepStrictEqual(view.items.map(v => v.n), [10, 12, 14, 16, 18]);

    await assert.rejects(adapter.documents({collection: 'items', filter: '{n: {$foo: 1}}', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: 'unknown operator: $foo'});
    await assert.rejects(adapter.documents({collection: 'nothing', filter: '', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: `no collection called nothing in ${DATABASE}`});
    // Its own user sees its database alone
    await assert.rejects(adapter.documents({collection: 'system.users', filter: '', sort: '', fields: '', skip: 0, limit: 50}), {status: 400});
});

// A script run by mongosh in the container, signed in by the URL: copied in as a file, as
// serviceman puts it there
function mongosh(url, script)
{
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'data-browser-')), 'script.js');
    fs.writeFileSync(file, script);
    const inside = `/tmp/data-browser-${path.basename(path.dirname(file))}.js`;
    child_process.execFileSync(DOCKER, ['cp', file, `${CONTAINER}:${inside}`]);
    try {
        return child_process.execFileSync(DOCKER, ['exec', CONTAINER, 'mongosh', '--quiet', '--norc', url, inside], {encoding: 'utf8'});
    }
    finally {
        child_process.execFileSync(DOCKER, ['exec', CONTAINER, 'rm', '-f', inside]);
    }
}
