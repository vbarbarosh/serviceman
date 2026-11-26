# data_browser

One database's data, for a web page: its collections down the left, and the open one's
documents as a table or as JSON, fifty a page (20 to 200), a column for each key found in them.
**Find** finds them by a filter, typed as the MongoDB shell types it, `{status: 'active', at:
{$gt: ISODate('2026-01-01')}}`; a sort and the fields shown go under it, and a click on a header
sorts by that key, up, down, then as found. **Aggregate** makes them by a pipeline of stages,
`[{$match: {…}}, {$group: {…}}]`, Ctrl+Enter running it. A click on a row shows the document
whole, as the shell writes it, with Copy: what the filter takes back, so a value copied from it
finds it. The last queries of each collection that ran are kept in the browser, under
**Recent**, to run again.

It changes documents too: **+ Document** adds one, typed as the shell types it; a document
shown whole has **Edit**, which reads it again whole by its `_id` (a page may show some of its
fields alone, and saving those would drop the rest), and **Delete**, asked before it is done.
A view's documents and a pipeline's results are read alone. MongoDB is its first engine;
PostgreSQL, MySQL and SQLite files come to the same page, their tables as its collections and
their rows as its documents.

It has two halves and knows nothing of where the database is. The page half is a Vue component
that talks to an HTTP API under one base URL. The server half is that API, as one request
handler given an **adapter**, which says the engine's words and has the host **run** them in
the database. The host gives the way to run a script there, mounts the handler at the base,
and decides who may ask.

serviceman is the first host: a database's page has Browse, which opens this component on it,
and the scripts run inside its server's container, in that database, signed in as the user
serviceman made for it, never root. The owner alone may: the manifest names no right a token
may be given.

## Layout

    server/data_browser_serve.js     the HTTP API, given an adapter
    server/data_browser_manifest.js  its kinds of items
    server/mongodb_adapter.js        MongoDB's: each ask a mongosh script, given run(script)
    server/ejson_from_text.js        a query as typed, read as data, into Extended JSON
    ui/data_browser.js               the component
    ui/data_browser.css              the component's rules
    ui/mongo_text_of.js              a value as the shell writes it, for the document's window
    ui/mongo_cell_of.js              a value on one line, for a cell
    ui/mongo_type_of.js              which of the shell's types a value is
    tests/                           the API over a fake adapter, the reading and writing of
                                     queries; MONGO_URL runs the adapter on a real MongoDB

## A query is data

What a person types is never run. `ejson_from_text` reads the filter, the sort and the fields
as data: JSON, or the shell's way of writing it (keys without quotes, single quotes, a comma
before a closing brace, comments), with the shell's types, `ObjectId('…')`, `ISODate('…')`,
`new Date('…')`, `NumberLong('…')`, `NumberInt(…)`, `NumberDecimal('…')`, `UUID('…')` and a
`/regex/i`. Any other name is refused with where it stands: `{a: db.dropDatabase()}` is not a
value. What it reads goes into the script as a string, parsed there by `EJSON.parse`.

So the database's own rights are all it has: its user's, on its database. MongoDB itself still
runs what a query asks of it, a `$where` included, inside that database.

## The API

What it holds is written down in `server/data_browser_manifest.js`, in
[the shape every module has](../../README.md#modules). Under the base the host mounts it at —
serviceman's is `/api/v1/databases/<server>/<database>/browse`:

| Door | What it answers |
|---|---|
| `GET <base>` | `{engine, database, …}`: the engine, and what the host heads it with |
| `GET <base>/collections` | `{items: [{name, type, count, bytes, storage_bytes, index_bytes, indexes}]}`, `system.*` left out; a view has no numbers |
| `GET <base>/documents?collection=&filter=&sort=&fields=&skip=&limit=` | `{items, count, skip, limit, took_ms, cut}` |
| `GET <base>/aggregate?collection=&pipeline=&skip=&limit=` | `{items, count: null, more, skip, limit, took_ms, cut}` |
| `POST <base>/documents` `{collection, document}` | `{id}`, 201: the document added, its `_id` MongoDB's own when it had none |
| `POST <base>/documents/replace` `{collection, id, document}` | `{id}`: put in place of the one of that `_id`, which stays |
| `POST <base>/documents/delete` `{collection, id}` | `{id}`: deleted |

A page of documents is 50 unless `limit` says otherwise, 200 at most. Each comes as relaxed
Extended JSON: `{$oid}`, `{$date}`, a 64-bit number past what a double holds whole as
`{$numberLong}` with its digits. `count` is how many the filter finds in all, `null` when
counting them takes longer than 5 s; finding them may take 20 s, after which MongoDB stops it
and the answer says an index makes it quick. A page carries 4 MB at most: `cut` says the rest
of it was left for the next page.

A pipeline's page is its stages, then the page's `$skip` and one past its `$limit`: `more` says
whether a next page is there, and its results are not counted, which would run it whole again.
A stage that writes, `$out` or `$merge`, is refused: it is read here.

A document is its text, typed as a filter is; `id` is the `_id` as a page answered it, in
relaxed Extended JSON. One deleted since the page was read is said so, and a document that
names another `_id` MongoDB refuses: an `_id` is for good. A body is 4 MB at most.

A query that is wrong is answered 400 with what is wrong and where (`the filter: a comma or }
was expected, at 14`), and so is one MongoDB refuses (`unknown operator: $foo`). A database not
reached is 502, a machine away 409.
