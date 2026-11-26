// A page of documents is this many unless asked otherwise, and never more than the most
const LIMIT = 50;
const LIMIT_MOST = 200;
const SKIP_MOST = 1e9;
// A collection's name as MongoDB takes one, and a query's text, which an address carries
const NAME_MOST = 255;
const TEXT_MOST = 8*1024;

// One database's data, under whatever base the host mounts it at: its collections, and a page
// of one's documents as a filter finds them. The host gives `adapter`, which says the engine's
// words and runs them in the database as its own user ({engine, collections(), documents(ask)},
// mongodb_adapter), and `about`, what the page heads it with ({engine, database, server,
// remote}). Nothing is kept here: each read asks the database.
//
//     options = {adapter, about, tail, query, log}
//
//     GET <base>                 {engine, database, …about}
//     GET <base>/collections     {items: [{name, type, count, bytes, storage_bytes, index_bytes, indexes}]}
//     GET <base>/documents?collection=&filter=&sort=&fields=&skip=&limit=
//                                {items, count, skip, limit, took_ms, cut}
async function data_browser_serve(req, res, options)
{
    const tail = options.tail;
    const log = (options.log === undefined) ? function () {} : options.log;
    try {
        if (req.method !== 'GET') {
            send_json(res, 405, {error: 'the data is read here, for now'});
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
            const ask = ask_from_query(options.query);
            const found = await options.adapter.documents(ask);
            log('data_browser_read', {collection: ask.collection, filtered: ask.filter.trim() !== '', count: found.items.length, took_ms: found.took_ms});
            send_json(res, 200, Object.assign({skip: ask.skip, limit: ask.limit}, found));
            return;
        }
        send_json(res, 404, {error: `no such door: ${tail}`});
    }
    catch (error) {
        send_json(res, (error.status === undefined) ? 502 : error.status, {error: error.message});
    }
}

// What a page of documents asks, from its query string: the collection, its filter, sort and
// fields as typed, where the page begins and how many are on it
function ask_from_query(query)
{
    const collection = String(query.get('collection') || '');
    if ((collection === '') || (collection.length > NAME_MOST)) {
        throw Object.assign(new Error('?collection names the collection its documents are read from'), {status: 400});
    }
    const out = {collection, filter: '', sort: '', fields: '', skip: 0, limit: LIMIT};
    for (const key of ['filter', 'sort', 'fields']) {
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
