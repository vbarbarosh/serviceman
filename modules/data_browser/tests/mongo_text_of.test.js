const assert = require('assert');
const ejson_from_text = require('../server/ejson_from_text');
const test = require('node:test');

// A document as the page writes it, from what the server answers, and its cells
test('a document is written as the shell writes it, and read back as it was', async function () {
    const mongo_text_of = (await import('../ui/mongo_text_of.js')).default;
    const mongo_cell_of = (await import('../ui/mongo_cell_of.js')).default;
    const document = {
        _id: {$oid: '6b08111da665b663b25ba166'},
        name: 'a "quoted" name',
        at: {$date: '2026-11-26T10:59:41.480Z'},
        n: 5,
        big: {$numberLong: '9007199254740993'},
        price: {$numberDecimal: '1.10'},
        u: {$binary: {base64: 'bSFt0NHPQ3a4xOX2kwjERQ==', subType: '04'}},
        re: {$regularExpression: {pattern: 'a/b', options: 'i'}},
        ts: {$timestamp: {t: 1, i: 2}},
        tags: ['x', 'y'],
        'two words': {city: 'Kyiv', zip: null, deep: {a: [1, 2, {b: true}]}},
        empty: {},
        long: 'x'.repeat(100),
    };
    assert.strictEqual(mongo_text_of(document, true), [
        '{',
        '    _id: ObjectId(\'6b08111da665b663b25ba166\'),',
        '    name: "a \\"quoted\\" name",',
        '    at: ISODate(\'2026-11-26T10:59:41.480Z\'),',
        '    n: 5,',
        '    big: NumberLong(\'9007199254740993\'),',
        '    price: NumberDecimal(\'1.10\'),',
        '    u: UUID(\'6d216dd0-d1cf-4376-b8c4-e5f69308c445\'),',
        '    re: /a\\/b/i,',
        '    ts: {$timestamp: {t: 1, i: 2}},',
        '    tags: ["x", "y"],',
        '    "two words": {city: "Kyiv", zip: null, deep: {a: [1, 2, {b: true}]}},',
        '    empty: {},',
        `    long: "${'x'.repeat(100)}"`,
        '}',
    ].join('\n'));
    // What the filter reads back is the same document, but for the Timestamp, which it takes as
    // the Extended JSON it is
    const back = ejson_from_text(mongo_text_of(document, true));
    assert.deepStrictEqual(back, Object.assign({}, document, {u: {$uuid: '6d216dd0-d1cf-4376-b8c4-e5f69308c445'}, re: {$regularExpression: {pattern: 'a\\/b', options: 'i'}}}));

    assert.deepStrictEqual([document._id, document.at, document.big, document.n, document.tags, document['two words'], null, '', true, undefined, document.ts].map(v => mongo_cell_of(v)), [
        {text: '6b08111da665b663b25ba166', kind: 'id', title: 'ObjectId(\'6b08111da665b663b25ba166\')'},
        {text: '2026-11-26T10:59:41.480Z', kind: 'date', title: 'a date, UTC'},
        {text: '9007199254740993', kind: 'number', title: 'NumberLong(\'9007199254740993\')'},
        {text: '5', kind: 'number', title: ''},
        {text: '["x", "y"]', kind: 'array', title: '2 items'},
        {text: '{city: "Kyiv", zip: null, deep: {a: [1, 2, {b: true}]}}', kind: 'object', title: '3 keys'},
        {text: 'null', kind: 'null', title: ''},
        {text: '""', kind: 'null', title: ''},
        {text: 'true', kind: 'bool', title: ''},
        {text: '', kind: 'none', title: 'not in this document'},
        {text: '{$timestamp: {t: 1, i: 2}}', kind: 'other', title: ''},
    ]);
    // A value too long for a line is written over many, and a cell keeps it on one
    const wide = {list: Array.from({length: 30}, (v, i) => `item-${i}`)};
    assert.strictEqual(mongo_text_of(wide, true).split('\n').length, 34);
    assert.strictEqual(mongo_cell_of(wide.list).text.includes('\n'), false);
});

// A document nested deep, as a banner's config is (scenes, layers, their animations, keyframes),
// is written at once: each value once, never once for each way it could be laid out, which wrote
// one 30 deep 2³⁰ times and froze the page; its cell is one line, cut long past what it shows
test('a document nested 30 deep is written at once, and its cell cut', async function () {
    const mongo_text_of = (await import('../ui/mongo_text_of.js')).default;
    const mongo_cell_of = (await import('../ui/mongo_cell_of.js')).default;
    let deep = {id: 'layer-0', type: 'text', x: 10, y: 20};
    for (let i = 1; i < 30; ++i) {
        deep = {id: `layer-${i}`, type: 'group', x: 10, y: 20, children: [deep]};
    }
    const at = performance.now();
    const text = mongo_text_of({config: [deep]}, true);
    const cell = mongo_cell_of([deep]);
    assert.ok((performance.now() - at) < 1000);
    assert.strictEqual(text.split('\n').length, 242);
    assert.ok(text.includes('id: "layer-0",'));
    assert.deepStrictEqual([cell.text.length, cell.text.includes('\n'), cell.text.slice(0, 40), cell.kind], [500, false, '[ { id: "layer-29", type: "group", x: 10', 'array']);
    assert.strictEqual(mongo_cell_of('x'.repeat(3000)).text.length, 500);
});
