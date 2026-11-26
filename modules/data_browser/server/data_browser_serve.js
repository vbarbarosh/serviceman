// A page of documents is this many unless asked otherwise, and never more than the most
const LIMIT = 50;
const LIMIT_MOST = 200;
const SKIP_MOST = 1e9;
// A collection's name as MongoDB takes one, and a query's text, which an address carries
const NAME_MOST = 255;
const TEXT_MOST = 8*1024;
// A document sent to be added or put in place: MongoDB's own most is 16 MB. A SQL row edited
// comes with the row as it was read, as long again; its key and the rest of the body fit in
// ID_MOST.
const DOCUMENT_MOST = 4*1024*1024;
const ID_MOST = 64*1024;
const BODY_MOST = 2*DOCUMENT_MOST + ID_MOST;

// One database's data, under whatever base the host mounts it at: its collections, a page of
// one's documents as a filter or a pipeline finds them, and a document added, put in place of
// another or deleted. The host gives `adapter`, which says the engine's words and runs them in
// the database as its own user ({engine, collections(), documents(ask), aggregate(ask), insert,
// replace, remove}: mongodb_adapter; postgresql_adapter and mysql_adapter, whose tables are the
// collections and rows the documents, read a SELECT as the pipeline, and read one row by its
// key, document(ask); sqlite_adapter, which changes nothing and says why, read_only), and
// `about`, what the page heads it with ({engine, database, server, remote}). Nothing is kept
// here: each read asks the database.
//
//     options = {adapter, about, tail, query, log}
//
//     GET <base>                 {engine, database, …about}
//     GET <base>/collections     {items: [{name, type, count, bytes, storage_bytes, index_bytes, indexes}]}, a SQL table's with key
//     GET <base>/documents?collection=&filter=&sort=&fields=&skip=&limit=
//                                {items, count, skip, limit, took_ms, cut}, a SQL page with columns and more
//     GET <base>/aggregate?collection=&pipeline=&skip=&limit=
//                                {items, count: null, more, skip, limit, took_ms, cut}, a SQL page with columns
//     GET <base>/document?collection=&id=
//                                {item, columns, key, filled}: a SQL row read whole by its key, null without id
//     POST <base>/documents          {collection, document}            {id}: the document added
//     POST <base>/documents/replace  {collection, id, document, was}   {id}: put in place of id's
//     POST <base>/documents/delete   {collection, id}                  {id}: deleted
//
// A document is its text, typed as the shell types it; an id is the _id as a page answered it.
// A SQL row is its JSON, its id its key as the page read it, {"id": 7}, and `was` the row as it
// was read, so an edit saves the columns changed alone, and not over another hand's (409, with
// `changed` and the row as it is now, `item`); a SQL change answers {id, item, saved}.
async function data_browser_serve(req, res, options)
{
    const tail = options.tail;
    const log = (options.log === undefined) ? function () {} : options.log;
    try {
        if (req.method === 'POST') {
            await change_serve(req, res, options, log);
            return;
        }
        // GET <base>
        if ((tail === '') || (tail === '/')) {
            send_json(res, 200, Object.assign({engine: options.adapter.engine}, options.about));
            return;
        }
        // GET <base>/collections
        if (tail === '/collections') {
            send_json(res, 200, {items: await options.adapter.collections()});
            return;
        }
        // GET <base>/documents (query)
        if (tail === '/documents') {
            const ask = ask_from_query(options.query, ['filter', 'sort', 'fields']);
            const found = await options.adapter.documents(ask);
            log('data_browser_read', {collection: ask.collection, filtered: ask.filter.trim() !== '', count: found.items.length, took_ms: found.took_ms});
            send_json(res, 200, Object.assign({skip: ask.skip, limit: ask.limit}, found));
            return;
        }
        // GET <base>/document (query)
        if ((tail === '/document') && (typeof options.adapter.document === 'function')) {
            const collection = String(options.query.get('collection') || '');
            if ((collection === '') || (collection.length > NAME_MOST)) {
                throw Object.assign(new Error('?collection names the table its row is read from'), {status: 400});
            }
            send_json(res, 200, await options.adapter.document({collection, id: id_read(options.query.get('id'))}));
            return;
        }
        // GET <base>/aggregate (query)
        if (tail === '/aggregate') {
            const ask = ask_from_query(options.query, ['pipeline']);
            const found = await options.adapter.aggregate(ask);
            log('data_browser_aggregate', {collection: ask.collection, stages: ask.pipeline.trim() !== '', count: found.items.length, took_ms: found.took_ms});
            send_json(res, 200, Object.assign({skip: ask.skip, limit: ask.limit}, found));
            return;
        }
        send_json(res, 404, {error: `no such door: ${tail}`});
    }
    catch (error) {
        // A row another hand changed since it was read: which columns, and the row as it is now
        const conflict = (error.changed === undefined) ? {} : {changed: error.changed, item: error.item};
        send_json(res, (error.status === undefined) ? 502 : error.status, Object.assign({error: error.message}, conflict));
    }
}

// POST <base>/documents (body)
// POST <base>/documents/replace (body)
// POST <base>/documents/delete (body)
// A document added, put in place of the one of its _id, or deleted; a SQL row added, edited by
// its key or deleted; what was typed is not written in the log. An engine whose adapter changes
// nothing, a SQLite file's, is read alone (405), its adapter saying why.
async function change_serve(req, res, options, log)
{
    const commands = {'/documents': 'insert', '/documents/replace': 'replace', '/documents/delete': 'remove'};
    const command = commands[options.tail];
    if (command === undefined) {
        send_json(res, 404, {error: `no such door: ${options.tail}`});
        return;
    }
    // Read to its end first, so the refusal reaches the page rather than a connection cut
    const body = await body_json(req);
    if (typeof options.adapter[command] !== 'function') {
        send_json(res, 405, {error: (typeof options.adapter.read_only === 'string') ? options.adapter.read_only : 'its data is read here alone'});
        return;
    }
    const ask = {collection: name_read(body.collection)};
    if (command !== 'insert') {
        if (body.id === undefined) {
            throw Object.assign(new Error('id is the _id of the document, as a page answered it'), {status: 400});
        }
        ask.id = body.id;
    }
    if (command !== 'remove') {
        ask.document = String((body.document === undefined) ? '' : body.document);
        if (ask.document.length > DOCUMENT_MOST) {
            throw Object.assign(new Error(`a document is ${DOCUMENT_MOST/1024/1024} MB at most here`), {status: 413});
        }
    }
    if ((command === 'replace') && (body.was !== undefined)) {
        ask.was = String(body.was);
        if (ask.was.length > DOCUMENT_MOST) {
            throw Object.assign(new Error(`a document is ${DOCUMENT_MOST/1024/1024} MB at most here`), {status: 413});
        }
    }
    const done = await options.adapter[command](ask);
    log(`data_browser_${command}`, {collection: ask.collection});
    send_json(res, (command === 'insert') ? 201 : 200, done);
}

// A collection's name as asked
function name_read(value)
{
    const out = String((value === undefined) ? '' : value);
    if ((out === '') || (out.length > NAME_MOST)) {
        throw Object.assign(new Error('collection names the collection asked of'), {status: 400});
    }
    return out;
}

// The body as JSON. One past the most is read to its end and not kept, so the refusal reaches
// the page rather than a connection cut in its face.
function body_json(req)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let bytes = 0;
        req.on('data', function (chunk) {
            bytes += chunk.length;
            if (bytes <= BODY_MOST) {
                chunks.push(chunk);
            }
        });
        req.on('end', function () {
            if (bytes > BODY_MOST) {
                reject(Object.assign(new Error(`a document is ${DOCUMENT_MOST/1024/1024} MB at most here`), {status: 413}));
                return;
            }
            try {
                // A body that is JSON and no object holds no field: it reads as an empty one
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                resolve(((parsed === null) || (typeof parsed !== 'object')) ? {} : parsed);
            }
            catch {
                reject(Object.assign(new Error('the body is not JSON'), {status: 400}));
            }
        });
        req.on('error', reject);
    });
}

// A SQL row's key as the address carries it, JSON: {"id": 7}; null for none
function id_read(text)
{
    if ((text === null) || (text === '')) {
        return null;
    }
    if (text.length > ID_MOST) {
        throw Object.assign(new Error(`the id is longer than ${ID_MOST/1024} KB`), {status: 400});
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw Object.assign(new Error('?id is the row\'s key as JSON, {"id": 7}'), {status: 400});
    }
}

// What a page of documents asks, from its query string: the collection, the texts typed (a
// find's filter, sort and fields, or a pipeline), where the page begins and how many are on it
function ask_from_query(query, texts)
{
    const collection = String(query.get('collection') || '');
    if ((collection === '') || (collection.length > NAME_MOST)) {
        throw Object.assign(new Error('?collection names the collection its documents are read from'), {status: 400});
    }
    const out = {collection, skip: 0, limit: LIMIT};
    for (const key of texts) {
        out[key] = String(query.get(key) || '');
        if (out[key].length > TEXT_MOST) {
            throw Object.assign(new Error(`the ${key} is longer than ${TEXT_MOST/1024} KB`), {status: 400});
        }
    }
    out.skip = whole_read(query, 'skip', 0, SKIP_MOST, 0);
    out.limit = whole_read(query, 'limit', 1, LIMIT_MOST, LIMIT);
    return out;
}

// A whole number of the query, between its least and its most; `none` when it is not there
function whole_read(query, key, least, most, none)
{
    const text = query.get(key);
    if ((text === null) || (text === '')) {
        return none;
    }
    const out = Number(text);
    if ((Number.isInteger(out) === false) || (out < least) || (out > most)) {
        throw Object.assign(new Error(`?${key} is a whole number from ${least} to ${most}`), {status: 400});
    }
    return out;
}

function send_json(res, status, value)
{
    if (res.headersSent) {
        return;
    }
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify(value, null, 4));
}

module.exports = data_browser_serve;
