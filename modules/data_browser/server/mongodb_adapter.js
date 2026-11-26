const ejson_from_text = require('./ejson_from_text');

// How long a page of documents may take to be found, and to be counted, before MongoDB stops it
const FIND_MS = 20000;
const COUNT_MS = 5000;
// What a page of documents carries at most: the rest of the page is left out, and it says so
const PAGE_BYTES = 4*1024*1024;
// The line of mongosh's output that is the answer: what else it prints (a warning) is not
const ANSWER = 'serviceman-answer ';

// What the script begins with: the ask as data, and how an answer is printed. A document's
// values go out as relaxed Extended JSON, a 64-bit number past what a double holds whole as
// {$numberLong} with its digits, which relaxed JSON would round.
const PRELUDE = [
    'function exact(value) {',
    '    if ((value === null) || (typeof value !== \'object\') || (value instanceof Date) || (value instanceof RegExp)) {',
    '        return value;',
    '    }',
    '    if (value._bsontype === \'Long\') {',
    '        const number = value.toNumber();',
    '        return Number.isSafeInteger(number) ? number : {$numberLong: value.toString()};',
    '    }',
    '    if (value._bsontype !== undefined) {',
    '        return value;',
    '    }',
    '    if (Array.isArray(value)) {',
    '        return value.map(exact);',
    '    }',
    '    const out = {};',
    '    for (const key of Object.keys(value)) {',
    '        out[key] = exact(value[key]);',
    '    }',
    '    return out;',
    '}',
    'function answer_print(work) {',
    '    let out;',
    '    try {',
    '        out = {ok: work()};',
    '    }',
    '    catch (error) {',
    '        out = {error: String(error.message || error), code: error.codeName || null};',
    '    }',
    `    print(${JSON.stringify(ANSWER)} + EJSON.stringify(out, {relaxed: true}));`,
    '}',
    'function collection_of(name) {',
    '    if (db.getCollectionNames().includes(name) === false) {',
    '        throw new Error(`no collection called ${name} in ${db.getName()}`);',
    '    }',
    '    return db.getCollection(name);',
    '}',
];

// The database's collections, its views and time series among them, each with its count, its
// size and its indexes as MongoDB keeps them; system.* left out
const COLLECTIONS = [
    'answer_print(function () {',
    '    const infos = db.getCollectionInfos({}, {nameOnly: false, authorizedCollections: true});',
    '    return infos.filter(v => v.name.startsWith(\'system.\') === false).map(function (info) {',
    '        const out = {name: info.name, type: info.type, count: null, bytes: null, storage_bytes: null, index_bytes: null, indexes: null};',
    '        if (info.type === \'view\') {',
    '            return out;',
    '        }',
    '        try {',
    '            const stats = db.getCollection(info.name).aggregate([{$collStats: {storageStats: {}}}]).toArray()[0].storageStats;',
    '            Object.assign(out, {count: stats.count, bytes: stats.size, storage_bytes: stats.storageSize, index_bytes: stats.totalIndexSize, indexes: stats.nindexes});',
    '        }',
    '        catch {',
    '            out.count = db.getCollection(info.name).estimatedDocumentCount();',
    '        }',
    '        return out;',
    '    }).sort((a, b) => (a.name < b.name) ? -1 : 1);',
    '});',
];

// A page of a collection's documents: those its filter finds, in its sort, with its fields,
// past `skip`; then how many the filter finds in all, null when counting them takes too long
const DOCUMENTS = [
    'answer_print(function () {',
    '    const collection = collection_of(ask.collection);',
    '    const filter = EJSON.parse(ask.filter, {relaxed: false});',
    '    const began = Date.now();',
    '    const cursor = collection.find(filter, EJSON.parse(ask.fields, {relaxed: false}), {promoteLongs: false}).sort(EJSON.parse(ask.sort, {relaxed: false})).skip(ask.skip).limit(ask.limit).maxTimeMS(ask.find_ms);',
    '    const items = [];',
    '    let bytes = 0;',
    '    let cut = false;',
    '    while (cursor.hasNext()) {',
    '        const item = exact(cursor.next());',
    '        bytes += EJSON.stringify(item, {relaxed: true}).length;',
    '        if ((bytes > ask.page_bytes) && (items.length > 0)) {',
    '            cut = true;',
    '            break;',
    '        }',
    '        items.push(item);',
    '    }',
    '    const took_ms = Date.now() - began;',
    '    let count = null;',
    '    try {',
    '        count = (Object.keys(filter).length === 0) ? collection.estimatedDocumentCount() : collection.countDocuments(filter, {maxTimeMS: ask.count_ms});',
    '    }',
    '    catch {',
    '        count = null;',
    '    }',
    '    return {items, count, took_ms, cut};',
    '});',
];

// MongoDB, for the data browser: each ask a mongosh script that `run(script)` runs in the
// database, signed in as its own user, and answers with what it printed. The ask goes in as
// data: a filter, a sort and the fields are read by ejson_from_text and parsed by EJSON.parse
// there, so what a person types is never run as code.
//
//     adapter = mongodb_adapter(v => database_script(connect, server, 'orders', v))
//     await adapter.collections()   // [{name, type, count, bytes, storage_bytes, index_bytes, indexes}]
//     await adapter.documents({collection: 'items', filter: "{status: 'active'}", sort: '', fields: '', skip: 0, limit: 50})
//                                   // {items, count, took_ms, cut}
function mongodb_adapter(run)
{
    return {
        engine: 'mongodb',
        collections: function () {
            return answer_read(run, COLLECTIONS, {});
        },
        documents: function (ask) {
            const json = {
                collection: ask.collection,
                filter: JSON.stringify(text_read(ask.filter, 'filter')),
                sort: JSON.stringify(text_read(ask.sort, 'sort')),
                fields: JSON.stringify(text_read(ask.fields, 'fields')),
                skip: ask.skip,
                limit: ask.limit,
                find_ms: FIND_MS,
                count_ms: COUNT_MS,
                page_bytes: PAGE_BYTES,
            };
            return answer_read(run, DOCUMENTS, json);
        },
    };
}

// The script run, and its answer: what it found, or what MongoDB refused, as a refusal of the
// ask (400); a script that printed no answer did not reach the database (502)
async function answer_read(run, lines, ask)
{
    const script = [`const ask = ${JSON.stringify(ask)};`].concat(PRELUDE, lines, ['']).join('\n');
    const printed = await run(script);
    const line = printed.split('\n').find(v => v.startsWith(ANSWER));
    if (line === undefined) {
        throw Object.assign(new Error(`mongosh printed no answer: ${printed.trim().slice(0, 300) || 'nothing'}`), {status: 502});
    }
    const answer = JSON.parse(line.slice(ANSWER.length));
    if (answer.error !== undefined) {
        throw Object.assign(new Error(said_of(answer)), {status: 400});
    }
    return answer.ok;
}

// What MongoDB said, in words for the page
function said_of(answer)
{
    if (answer.code === 'MaxTimeMSExpired') {
        return `it took longer than ${FIND_MS/1000} s, and MongoDB stopped it: an index on what it filters or sorts by makes it quick`;
    }
    return answer.error;
}

// A filter, a sort or the fields as typed, read as data; what is wrong with it says which
function text_read(text, what)
{
    let out;
    try {
        out = ejson_from_text(text);
    }
    catch (error) {
        throw Object.assign(new Error(`the ${what}: ${error.message}`), {status: 400});
    }
    if ((out === null) || (typeof out !== 'object') || Array.isArray(out)) {
        throw Object.assign(new Error(`the ${what} is a document in braces, {…}`), {status: 400});
    }
    return out;
}

module.exports = mongodb_adapter;
