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
const EDITED = 'browse_edit_test';

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

    // A pipeline: a page of what it makes, with whether a next page is there
    const grouped = await adapter.aggregate({collection: 'items', pipeline: '[{$match: {n: {$lt: 100}}}, {$group: {_id: \'$even\', n: {$sum: 1}}}, {$sort: {_id: 1}}]', skip: 0, limit: 50});
    assert.deepStrictEqual([grouped.items, grouped.count, grouped.more], [[{_id: false, n: 50}, {_id: true, n: 50}], null, false]);
    const paged = await adapter.aggregate({collection: 'items', pipeline: '[{$sort: {n: 1}}, {$project: {_id: 0, n: 1}}]', skip: 10, limit: 3});
    assert.deepStrictEqual([paged.items.map(v => v.n), paged.more], [[10, 11, 12], true]);
    const last = await adapter.aggregate({collection: 'items', pipeline: '[{$sort: {n: 1}}, {$project: {_id: 0, n: 1}}]', skip: 119, limit: 3});
    assert.deepStrictEqual([last.items.map(v => v.n), last.more], [[119, 1000], false]);
    await assert.rejects(adapter.aggregate({collection: 'items', pipeline: '[{$foo: {}}]', skip: 0, limit: 50}), {status: 400, message: /Unrecognized pipeline stage name: '\$foo'/});

    // A document added, put in place of another, and deleted, each by its _id
    const added = await adapter.insert({collection: 'items', document: '{n: 2000, name: \'added\', at: ISODate(\'2026-11-26\')}'});
    assert.strictEqual(typeof added.id.$oid, 'string');
    const again = await adapter.documents({collection: 'items', filter: `{_id: ObjectId('${added.id.$oid}')}`, sort: '', fields: '{_id: 0}', skip: 0, limit: 50});
    assert.deepStrictEqual(again.items, [{n: 2000, name: 'added', at: {$date: '2026-11-26T00:00:00Z'}}]);
    await adapter.replace({collection: 'items', id: added.id, document: '{n: 2001, name: \'changed\'}'});
    const changed = await adapter.documents({collection: 'items', filter: `{_id: ObjectId('${added.id.$oid}')}`, sort: '', fields: '{_id: 0}', skip: 0, limit: 50});
    assert.deepStrictEqual(changed.items, [{n: 2001, name: 'changed'}]);
    await assert.rejects(adapter.replace({collection: 'items', id: added.id, document: '{_id: 7, n: 1}'}), {status: 400, message: /_id/});
    const own = await adapter.insert({collection: 'items', document: '{_id: NumberLong(\'9007199254740993\'), n: 3000}'});
    assert.deepStrictEqual(own.id, {$numberLong: '9007199254740993'});
    await adapter.remove({collection: 'items', id: own.id});
    await adapter.remove({collection: 'items', id: added.id});
    await assert.rejects(adapter.remove({collection: 'items', id: added.id}), {status: 400, message: 'it is not there any more: deleted since the page was read'});
    await assert.rejects(adapter.insert({collection: 'evens', document: '{n: 1}'}), {status: 400, message: /view/});
    await assert.rejects(adapter.insert({collection: 'items', document: '[1]'}), {status: 400, message: 'the document is a document in braces, {…}'});
    assert.strictEqual((await adapter.collections()).find(v => v.name === 'items').count, 121, 'as many as before');

    await assert.rejects(adapter.documents({collection: 'items', filter: '{n: {$foo: 1}}', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: 'unknown operator: $foo'});
    await assert.rejects(adapter.documents({collection: 'nothing', filter: '', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: `no collection called nothing in ${DATABASE}`});
    // Its own user sees its database alone
    await assert.rejects(adapter.documents({collection: 'system.users', filter: '', sort: '', fields: '', skip: 0, limit: 50}), {status: 400});
});

// A document edited with the text the page showed (`was`): the fields it changes alone are saved,
// each held to what it held when read, as the page reads a value; another hand's change to one of
// them is refused with what it holds now, its change to another field kept
test('a real MongoDB: an edit saves the fields it changes alone, and never over another hand\'s change', {skip: (CONTAINER === undefined) && 'DATA_BROWSER_MONGO names no container'}, async function () {
    const mongo_text_of = (await import('../ui/mongo_text_of.js')).default;
    const root = `mongodb://root:${process.env.DATA_BROWSER_MONGO_ROOT}@127.0.0.1:27017/admin`;
    mongosh(root, [
        `const d = db.getSiblingDB('${EDITED}');`,
        'd.dropDatabase();',
        'd.dropAllUsers();',
        `d.createUser({user: '${EDITED}', pwd: 'pw', roles: [{role: 'dbOwner', db: '${EDITED}'}]});`,
        'd.orders.insertMany([1, 2, 3, 4, 5, 6].map(n => ({_id: n, status: \'new\', total: NumberDecimal(\'10.50\'), ratio: 10.0, score: NumberInt(7), big: NumberLong(\'9007199254740993\'), at: ISODate(\'2026-11-26T10:00:00Z\'), dims: {w: 1, h: [2, {d: 3}]}, \'a.b\': 1, note: \'x\'})));',
    ].join('\n'));
    const adapter = mongodb_adapter(v => mongosh(`mongodb://${EDITED}:pw@127.0.0.1:27017/${EDITED}`, v));
    // Another hand: a script run as root in the database edited
    function other(script) {
        return mongosh(root, `const d = db.getSiblingDB('${EDITED}'); ${script}`);
    }
    // The document as Edit shows it, and the same with its text changed
    async function text_read(id) {
        const found = await adapter.documents({collection: 'orders', filter: `{_id: ${id}}`, sort: '', fields: '', skip: 0, limit: 1});
        return mongo_text_of(found.items[0], true);
    }
    function text_changed(text, pairs) {
        let out = text;
        for (const [from, to] of pairs) {
            assert.ok(out.includes(from), `${from} in ${text}`);
            out = out.replace(from, to);
        }
        return out;
    }
    async function stored(id) {
        return (await adapter.documents({collection: 'orders', filter: `{_id: ${id}}`, sort: '', fields: '{_id: 0}', skip: 0, limit: 1})).items[0];
    }

    // Saved as it was read: nothing; a field changed, one left out, one added: those alone, each
    // value as typed, '$x' a text, a dotted name a field
    const one = await text_read(1);
    assert.deepStrictEqual(await adapter.replace({collection: 'orders', id: 1, document: one, was: one}), {id: 1, saved: []});
    const edited = text_changed(one, [['status: "new"', 'status: "paid"'], ['"a.b": 1', '"a.b": 2'], ['    note: "x"\n', '    added: "$x"\n'], ['h: [2, {d: 3}]', 'h: [2, {d: 4}]']]);
    assert.deepStrictEqual(await adapter.replace({collection: 'orders', id: 1, document: edited, was: one}), {id: 1, saved: ['status', 'dims', 'a.b', 'added', 'note']});
    assert.deepStrictEqual(await stored(1), {status: 'paid', total: {$numberDecimal: '10.50'}, ratio: 10, score: 7, big: {$numberLong: '9007199254740993'}, at: {$date: '2026-11-26T10:00:00Z'}, dims: {w: 1, h: [2, {d: 4}]}, 'a.b': 2, added: '$x'});

    // A double the page shows as 10, changed: held to what the page read, no refusal
    const two = await text_read(2);
    assert.deepStrictEqual((await adapter.replace({collection: 'orders', id: 2, document: text_changed(two, [['ratio: 10,', 'ratio: 12,']]), was: two})).saved, ['ratio']);

    // Another hand's change to a field this edit changes: refused with what it holds now, and
    // nothing saved; NumberDecimal('10.50') made the double 10.5 is a change
    const three = await text_read(3);
    other('d.orders.updateOne({_id: 3}, {$set: {status: \'shipped\', total: 10.5}});');
    await assert.rejects(adapter.replace({collection: 'orders', id: 3, document: text_changed(three, [['status: "new"', 'status: "paid"'], ['NumberDecimal(\'10.50\')', 'NumberDecimal(\'11.50\')'], ['score: 7', 'score: 8']]), was: three}), {status: 409, message: 'it changed since it was read, by another hand: status is "shipped" now, total is 10.5 now', changed: ['status', 'total']});
    assert.deepStrictEqual([(await stored(3)).status, (await stored(3)).score], ['shipped', 7], 'nothing saved');
    // To a field it leaves out, or adds: refused too; to another field: kept, the edit beside it
    const four = await text_read(4);
    other('d.orders.updateOne({_id: 4}, {$set: {note: \'theirs\', extra: 1}});');
    await assert.rejects(adapter.replace({collection: 'orders', id: 4, document: text_changed(four, [['    note: "x"\n', '']]), was: four}), {status: 409, changed: ['note']});
    await assert.rejects(adapter.replace({collection: 'orders', id: 4, document: text_changed(four, [['status: "new"', 'status: "new", extra: 2']]), was: four}), {status: 409, changed: ['extra']});
    assert.deepStrictEqual((await adapter.replace({collection: 'orders', id: 4, document: text_changed(four, [['status: "new"', 'status: "paid"']]), was: four})).saved, ['status']);
    assert.deepStrictEqual([(await stored(4)).status, (await stored(4)).note, (await stored(4)).extra], ['paid', 'theirs', 1]);

    // Gone meanwhile; an _id changed, which MongoDB refuses
    const five = await text_read(5);
    other('d.orders.deleteOne({_id: 5});');
    await assert.rejects(adapter.replace({collection: 'orders', id: 5, document: five, was: five}), {status: 400, message: 'it is not there any more: deleted since the page was read'});
    const six = await text_read(6);
    await assert.rejects(adapter.replace({collection: 'orders', id: 6, document: text_changed(six, [['_id: 6', '_id: 7']]), was: six}), {status: 400, message: /the \(immutable\) field '_id' was found to have been altered/});
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
