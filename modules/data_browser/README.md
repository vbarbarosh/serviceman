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

It changes documents too: **+ Document** adds one, typed as the shell types it; a document shown
whole has **Edit**, which reads it again whole by its `_id` (a page may show some of its fields
alone) and saves the fields changed alone, never over another hand's change to them ([Changing a
row](#changing-a-row)), and **Delete**, asked before it is done. A view's documents and a
pipeline's results are read alone.

PostgreSQL, MySQL and a SQLite file come to the same page in their own words: their tables are
its collections, their rows its documents ([A SQL database](#a-sql-database), [A SQLite
file](#a-sqlite-file)). **Find** finds rows by a condition typed after `WHERE`, with **Order
by** and **Columns** under it, and **Query**, where Aggregate is, runs a `SELECT` typed whole. A
row shown whole is its JSON, with Copy. A PostgreSQL's or a MySQL's row is changed as a document
is, **+ Row**, **Edit** and **Delete**, named by its table's key ([Changing a
row](#changing-a-row)); a view, a table no key names a row of, and a SQLite file are read alone,
and the table's head says which: `read only: a view`, `read only: no primary key`, `read only:
an app's file`.

It has two halves and knows nothing of where the database is. The page half is a Vue component
that talks to an HTTP API under one base URL. The server half is that API, as one request
handler given an **adapter**, which says the engine's words and has the host **run** them in
the database. The host gives the way to run a script there, mounts the handler at the base,
and decides who may ask.

serviceman is the first host: a database's page has Browse, which opens this component on it,
and the scripts run inside its server's container, in that database, signed in as the user
serviceman made for it, never root. A SQLite file has Browse in its machine's Files, and the
machine's agent reads it itself. The owner alone may: the manifest names no right a token may be
given. module-host has it too, on a SQLite file of its own computer, opened from its Files.

## Layout

    server/data_browser_serve.js     the HTTP API, given an adapter
    server/data_browser_manifest.js  its kinds of items
    server/mongodb_adapter.js        MongoDB's: each ask a mongosh script, given run(script)
    server/ejson_from_text.js        a query as typed, read as data, into Extended JSON
    server/postgresql_adapter.js     PostgreSQL's: each ask a psql script, given run(script)
    server/mysql_adapter.js          MySQL's: each ask a mysql script, given run(script)
    server/sqlite_adapter.js         SQLite's: each ask the statements a file's reader runs, given run(ask)
    server/sql_part_from_text.js     a condition, an order, columns or a query as typed
    server/ejson_from_json.js        a SQL engine's JSON, its numbers kept whole
    server/json_from_ejson.js        and back: JSON for a SQL engine, a number by its digits
    server/ejson_number_from_text.js a number as an engine wrote it, kept whole
    server/items_from_rows.js        rows as objects keyed by column, a name met twice kept
    server/sql_change_from_ask.js    a row's change as asked: its key, the columns to set
    server/sql_row_from_text.js      a row as typed, a JSON object of its columns
    server/row_changes_of.js         the columns of a row edited that differ from it as read
    server/changed_said_of.js        why an edit was not saved: another hand's change, said
    ui/data_browser.js               the component
    ui/data_browser.css              the component's rules
    ui/mongo_text_of.js              a value as the shell writes it, for the document's window
    ui/mongo_cell_of.js              a value on one line, for a cell
    ui/mongo_type_of.js              which of the shell's types a value is
    ui/sql_text_of.js                a SQL row as JSON, its numbers with their digits
    ui/sql_cell_of.js                a SQL value on one line, for a cell
    ui/sqlite_file_act.js            Browse, for a host to give the File Manager on a SQLite file
    tests/                           the API over fake adapters, the reading and writing of
                                     queries; DATA_BROWSER_MONGO, DATA_BROWSER_POSTGRES and
                                     DATA_BROWSER_MYSQL run the adapters on a real database;
                                     SQLite's runs on files the test makes, read by
                                     serviceman's agent's reader

## A query is data

What a person types is never run. `ejson_from_text` reads the filter, the sort and the fields
as data: JSON, or the shell's way of writing it (keys without quotes, single quotes, a comma
before a closing brace, comments), with the shell's types, `ObjectId('…')`, `ISODate('…')`,
`new Date('…')`, `NumberLong('…')`, `NumberInt(…)`, `NumberDecimal('…')`, `UUID('…')` and a
`/regex/i`. Any other name is refused with where it stands: `{a: db.dropDatabase()}` is not a
value. What it reads goes into the script as a string, parsed there by `EJSON.parse`.

So the database's own rights are all it has: its user's, on its database. MongoDB itself still
runs what a query asks of it, a `$where` included, inside that database.

## A SQL database

PostgreSQL's and MySQL's adapters answer as MongoDB's does, so the page needs no API of its own
for them. What is typed is SQL its database's own user runs in its own database, with that
user's rights alone, and nothing here reads it: the engine does.

- **Tables.** Its tables and views, each with its rows, its size and its indexes. PostgreSQL's
  are those of every schema but `pg_catalog` and `information_schema` (partitioned tables and
  their partitions, materialized views and foreign tables among them), named `schema.table`
  where the schema is not `public`, public's first. A table up to 64 MB is counted row by row,
  all of them within 5 s; past either, the rows its engine estimates it holds are said, with
  `estimated` (the page puts `~` before them, and "about" in the table's head). A view has no
  numbers, but a materialized one's. The database's head counts the same tables.
- **Rows.** `filter` is a condition, as typed after `WHERE` (`status = 'active' AND joined >
  '2025-06-01'`), `sort` an `ORDER BY` (`joined DESC`), `fields` the columns (`name, email`);
  a `WHERE` or an `ORDER BY` typed before them by habit, and a `;` after, are dropped. The
  table's name is found in its list and quoted the engine's way, never pasted. A click on a
  header orders by it, quoted: `"joined" ASC`, then `DESC`.
- **Query.** The pipeline's place takes a `SELECT` typed whole (or `WITH`, `TABLE`, `VALUES`,
  PostgreSQL's `EXPLAIN`); one left empty reads the open table. Its page is read one row past
  itself, which says whether a next page is there; it is not counted.
- **Values.** A row is an object keyed by its columns, and `columns` names them in order. Each
  value is what its engine gives in JSON: a number, `null`, `true`, a date as its text, a JSON
  column as its value. A number JavaScript would round keeps its digits, as MongoDB's do: a
  64-bit integer past 2^53 as `{$numberLong: '…'}`, a decimal whose digits a double would lose,
  trailing zeros included (`2.50`), as `{$numberDecimal: '…'}`; the page writes both as the
  digits. A join's two columns of one name are both kept, the second as `id (2)`. MySQL has no
  boolean: its `BOOLEAN` is 0 or 1, as in its own JSON; binary data is `0x…`.
- **Nothing written by a read.** Every read is one `READ ONLY` transaction, rolled back at its
  end, and MySQL's session is read only too: a `DELETE`, a `DROP`, `nextval()`, `FOR UPDATE` or
  a function that writes, typed into a condition or the query box, is refused by the engine
  itself, and said so (`it writes, and what is typed here is only read, a row being changed by
  its own buttons`): only the change doors write ([Changing a row](#changing-a-row)). What is typed reaches the script as hex, never as text a client would
  read (psql's `\!` runs a shell); PostgreSQL runs it with `EXECUTE` inside a `DO` block, where
  a `COMMIT` is refused, as a cursor, which refuses two statements; MySQL prepares it as one
  statement, the query box's inside `( … ) LIMIT`, so it can only be a query. A statement may
  take 20 s, its count 5 s.

**MySQL's output.** psql gives a page as JSON (`json_each` over each row's `to_json`, which
keeps two columns of one name apart). MySQL's client has no JSON of its own for a `SELECT`, and
`JSON_OBJECT` over the columns needs them in a derived table, which refuses a join's two columns
of one name, and writes a `FLOAT` as its double (`1.100000023841858`). So the client runs each
script twice: first with `--column-type-info`, the page's statement under `LIMIT 0`, which MySQL
answers at once with the result's columns and their types and no row; then with `--xml`, which
tells `NULL` from the text `NULL`, for the rows, each value read by its column's type.

## Changing a row

A PostgreSQL's or a MySQL's row is added, edited and deleted by the change doors alone, as a
MongoDB's document is, each asked of it as the database's own user, in a transaction of its own,
committed when it is done.

- **Its key.** A row is named by its table's primary key; else by its first unique key, by name,
  whose columns are all `NOT NULL`, whole (no prefix, no expression) and with no `WHERE`, which
  names one row as a primary key does. A unique key of a column that may be `NULL` names none
  (two rows may both hold `NULL` there), and a table with neither, a view, a materialized view
  and a foreign table are read alone: their change is refused (405), and the page says why in
  the table's head. Each table's key is in its list, `key: ['order_id', 'line_no']`, `null` for
  none; a row's key, as the page read it, is its `id`, `{"order_id": 1, "line_no": 2}`.
- **+ Row** is a JSON object of the columns to set; the columns the database fills itself, a
  default, a serial, an identity, `AUTO_INCREMENT` or a generated one, are left out of the
  text it starts with, the rest `null`, and their defaults fill what is left out. The row is
  read back as it was added: PostgreSQL's `RETURNING`; MySQL by its key as given, else its
  `AUTO_INCREMENT` (`LAST_INSERT_ID()`), else its default when that is a value, and a key MySQL
  works out (`DEFAULT (UUID())`) is not read back.
- **Edit** reads the row again whole by its key (`GET <base>/document`), each value as a page
  reads it, numbers kept whole, and saves the columns changed alone: `UPDATE … SET <changed>
  WHERE <key> = …`. A column left out of the text is left as it is; `null` is `NULL`. A key
  changed is the row's new name.
- **Another hand.** An edit is saved against the row as it was read (`was`): the row is locked
  by its key, and each column it changes compared with what it held then (PostgreSQL as JSON,
  `jsonb`, by value; MySQL by the column's type, text byte by byte, so a change of case alone
  counts). One another hand changed meanwhile is refused (409) with which, `changed`, and the
  row as it is now, `item`; nothing is saved over it, and the page says so, with **Read it as
  it is now**. A change to another column is kept, and the edit saved beside it. Saving over is
  not offered: what it would lose is what the person did not see. An edit without `was` saves
  every column given.
- **Delete** by its key, asked first; a row gone since it was read is said so (400).
- **A MongoDB's document** is edited the same way, by its `_id`. Edit reads it again whole, and
  the save changes the top-level fields the edit changes alone: those it sets or adds
  (`$setField`) and those left out of its text (`$unsetField`: the text is the document whole,
  so a field taken out of it goes). Each is held to what it held when read: compared as the page
  reads a value, relaxed Extended JSON (`NumberDecimal('10.50')` is not `10.5`, while a double
  the page showed as `10` is that `10`), and held in the update's filter to what it holds then,
  by value and by type, so a change in the instant between is caught too. A top-level field is
  one unit: a change anywhere inside `dims: {w: 1, h: [2, 3]}` saves `dims` whole, and another
  hand's change anywhere inside it refuses the edit. Another hand's change to one of them is
  refused (409) as a row's is, with which and the document as it is now; a change to another
  field is kept; a document gone is said so (400); its `_id` is for good, and MongoDB refuses a
  change of it. A name with a dot or a `$` is a field, and a value `'$x'` a text. Without `was`,
  the document is put in place whole, as before.
- **Values** go in as data, never as SQL. PostgreSQL's change is a `DO` block given the row as
  JSON in the ask's hex, each column found by name in `pg_attribute` and quoted (`%I`), each
  value read by its column's own type by `json_populate_record`: a date, a timestamp with its
  zone, an array, `jsonb` and `json` as their JSON, binary data as its text (`"\\x00ff"`), a
  number by its digits. MySQL's table is described first (`information_schema`), so each column
  is found by name and quoted, then each value is a hex literal of its own in a statement that
  goes in as hex and is prepared: MySQL reads it by its column's type, binary data from its
  `0x…`, bits as their number, JSON from its text, `true` as 1; the session is strict
  (`STRICT_ALL_TABLES`), so a value a type does not take is refused, never cut with a warning.
  The client's first run, for the column types, writes nothing.
- **Refusals** are the engine's words: a `NOT NULL`, a `CHECK`, a foreign key, a duplicate key,
  a type, a generated column given a value, PostgreSQL's with its detail (`Key
  (order_id)=(999) is not present in table "orders"`). A deferred foreign key is checked before
  the change is committed (`SET CONSTRAINTS ALL IMMEDIATE`), so it is refused in the same words.
  A row another transaction holds is waited for 5 s, then said so (409), nothing changed.

## A SQLite file

A SQLite file of a machine, `.sqlite`, `.sqlite3`, `.db` or any file whose first bytes are
SQLite's own, is a database of its own: Browse in the File Manager opens it here. Nothing runs it
on the machine but the machine's agent, with its Node's own `node:sqlite`: nothing is installed
there, and a machine whose Node is older than 22.16 says so (501), its Browse greyed.

`run(ask)` gives the agent the statements of one ask, `{ms, steps: [{sql, params, skip, limit,
bytes, ms}]}`, and the agent answers each with what it found (`{names, rows, more, cut,
took_ms}`, the rows as JSON whose integers are their digits) or SQLite's refusal and its result
code. The adapter writes the statements and reads the answers, as the others write a script and
read what it printed.

- **Its reader.** The agent reads the file in a node process of its own, started for each ask,
  never in its own: a statement holds the thread it runs in until it ends, and nothing stops it
  before then, not even a worker thread's `terminate`. The process is killed instead. Inside
  it, a thread of its own runs SQLite, and the process's own thread kills it the moment the
  agent's end of its stdin closes, or an answer cannot be written to the agent: an agent that
  is stopped or restarted takes its reader with it, whatever its statement is doing. (Ended as
  a process ends, it would wait for that thread, and so for its statement.) Eight files are read at once on a machine at most (503
  past them).
- **Tables.** Its tables and views by name, SQLite's own (`sqlite_*`) left out, each with its
  rows, its size (its pages, as `dbstat` counts them) and its indexes. A table up to 64 MB is
  counted, all of them within 5 s; past either, the rows `sqlite_stat1` keeps for it are said,
  as an estimate, where an `ANALYZE` made one, and none where none did. A table of a module
  (FTS5, R*Tree) is not counted.
- **Rows and Query** as a SQL database's: a condition, an order, the columns; a query typed
  whole (`SELECT`, `WITH`, `VALUES`, `PRAGMA table_info(…)`, `EXPLAIN QUERY PLAN …`). A query's
  page is read one row past itself, and its rows from the first are passed over to its page.
- **Values.** An integer as SQLite keeps it, whole past 2^53 (`{$numberLong: '…'}`), a real as
  a number (one past a double, `1e999`, as the text `Infinity`), text as it is, a blob as `0x`
  and its hex, as MySQL's binary data, `NULL` as null. A date is the text or the number it was
  written as. A view's two columns of one name are named apart by SQLite itself, `id:1`; a
  query's are kept as the other engines' are, `id (2)`.
- **Nothing written.** The file is opened read only, and `query_only` refuses every write
  besides: a `DELETE … RETURNING` or a write in a condition is refused by SQLite (`it writes,
  and an app's file is read alone here`). Its rows are not changed as a database's are: the
  file is its app's own data, written by its app, and writing into it under the app is another
  question. The change doors answer 405, saying so, and the table's head says `read only: an
  app's file`. A statement that gives no rows, a `DELETE`, a `DROP`,
  an `ATTACH`, a `VACUUM INTO`, is not run at all, nor a second statement after the first. A
  database in WAL mode keeps a `-wal` and a `-shm` file beside it while it is open; read while
  its app is stopped, they stay there after, empty, as any reader of it leaves them, and its
  app's next open takes them over.
- **Time and size.** A statement may take 20 s, a count 5 s; a page carries 4 MB, and a reader
  stops past 24 MB of answer (a row alone that large). A file another program holds locked while
  it writes is waited for 2 s, then said so (409). A file that is gone (404), a folder or a file
  that is no SQLite (400) are said by the reader before anything else is asked of it.

## The API

What it holds is written down in `server/data_browser_manifest.js`, in
[the shape every module has](../../README.md#modules). Under the base the host mounts it at —
serviceman's is `/api/v1/databases/<server>/<database>/browse`, and a SQLite file's
`/api/v1/remotes/<name>/sqlite/<file>/browse`, `<file>` its path as one word, its slashes
encoded too (`%2F`, as `encodeURIComponent` writes it); module-host's is
`/api/data_browser/<file>/browse`:

| Door | What it answers |
|---|---|
| `GET <base>` | `{engine, database, …}`: the engine, and what the host heads it with; a SQLite file's `{engine: 'sqlite', database, remote, path, label, size, mtime_ms}`, once it opened as SQLite |
| `GET <base>/collections` | `{items: [{name, type, count, bytes, storage_bytes, index_bytes, indexes}]}`, `system.*` left out; a view has no numbers; a SQL table's with `estimated` |
| `GET <base>/documents?collection=&filter=&sort=&fields=&skip=&limit=` | `{items, count, skip, limit, took_ms, cut}`; a SQL page with `columns` and `more` |
| `GET <base>/aggregate?collection=&pipeline=&skip=&limit=` | `{items, count: null, more, skip, limit, took_ms, cut}`; a SQL page with `columns` |
| `GET <base>/document?collection=&id=` | `{item, columns, key, filled}`: a SQL row read whole by its key, `id` its JSON; without `id`, `item` null, the table's columns and those it fills itself, for + Row |
| `POST <base>/documents` `{collection, document}` | `{id}`, 201: the document added, its `_id` MongoDB's own when it had none; a SQL row's `{id, item, saved}`, its key, the row read back and the columns given |
| `POST <base>/documents/replace` `{collection, id, document, was}` | with `was`, a document's `{id, saved}`, the fields changed since `was` saved alone; without it `{id}`, put in place of the one of that `_id`, which stays; a SQL row's `{id, item, saved}`, the columns changed since `was` saved alone; 409 `{error, changed, item}` when another hand changed them |
| `POST <base>/documents/delete` `{collection, id}` | `{id}`: deleted; a SQL row's `{id, item, saved: []}`, by its key |

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
names another `_id` MongoDB refuses: an `_id` is for good. A SQL row is its JSON text, `id` its
key as a page answered it, and `was` the row's text as `GET <base>/document` gave it
([Changing a row](#changing-a-row)). A document, and a row's `was`, are 4 MB each at most.

A query that is wrong is answered 400 with what is wrong and where (`the filter: a comma or }
was expected, at 14`), and so is one MongoDB refuses (`unknown operator: $foo`), PostgreSQL
(`column "nam" does not exist`) or MySQL. A change of a view's rows, of a table no key names a
row of, or of a SQLite file's is 405, saying why. A database not reached is 502, a machine away
409.
