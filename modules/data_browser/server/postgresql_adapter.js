const changed_said_of = require('./changed_said_of');
const ejson_from_json = require('./ejson_from_json');
const items_from_rows = require('./items_from_rows');
const json_from_ejson = require('./json_from_ejson');
const sql_change_from_ask = require('./sql_change_from_ask');
const sql_part_from_text = require('./sql_part_from_text');

// How long a page of rows may take to be found, and to be counted, before PostgreSQL stops it
const FIND_MS = 20000;
const COUNT_MS = 5000;
// How long a change waits for a row another transaction holds (an app's) before it gives up
const LOCK_MS = 5000;
// A table is counted row by row up to this size, while counting them all has taken less than
// COUNT_MS; past either, the rows PostgreSQL estimates it holds are said, as an estimate
const COUNT_BYTES = 64*1024*1024;
// What a page of rows carries at most: the rest of the page is left out, and it says so
const PAGE_BYTES = 4*1024*1024;
// The lines of psql's output that are the answer and the count
const ANSWER = 'serviceman-answer ';
const COUNTED = 'serviceman-count ';
// The relations listed: tables (a partitioned one and its partitions), views, materialized views
// and foreign tables, in every schema but PostgreSQL's own, a session's temporary ones left out.
// database_list counts the same for the database's head. One is named schema.table, the table
// alone in public.
const LISTED = 'c.relkind IN (\'r\', \'p\', \'v\', \'m\', \'f\') AND c.relpersistence <> \'t\' AND n.nspname NOT IN (\'pg_catalog\', \'information_schema\')';
const NAME = 'CASE WHEN n.nspname = \'public\' THEN c.relname ELSE n.nspname || \'.\' || c.relname END';
// The columns a row of the relation c is named by, a JSON list, null for none: its primary key,
// else its first unique key, by name, whose columns are all NOT NULL, of no expression and with
// no WHERE, which names one row as a primary key does. A unique key of a column that may be NULL
// does not: NULL is no value two rows are kept apart by.
const KEY = [
    '(SELECT (SELECT json_agg(a.attname ORDER BY e.n) FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS e(attnum, n) JOIN pg_attribute AS a ON (a.attrelid = i.indrelid) AND (a.attnum = e.attnum) WHERE e.n <= i.indnkeyatts)',
    ' FROM pg_index AS i',
    ' WHERE (i.indrelid = c.oid) AND i.indisvalid AND (i.indisprimary OR (i.indisunique AND (i.indpred IS NULL) AND (i.indexprs IS NULL) AND NOT EXISTS (',
    'SELECT FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS e(attnum, n) JOIN pg_attribute AS a ON (a.attrelid = i.indrelid) AND (a.attnum = e.attnum) WHERE (e.n <= i.indnkeyatts) AND (NOT a.attnotnull)',
    ')))',
    ' ORDER BY i.indisprimary DESC, i.indexrelid::regclass::text LIMIT 1)',
].join('');

// Where a DO block reads the ask from, and how it says its answer: what it found, or what
// PostgreSQL refused, with its hint
const ASK = '    ask json := convert_from(decode(current_setting(\'serviceman.ask\'), \'hex\'), \'UTF8\')::json;';
const REFUSED = [
    'EXCEPTION',
    '    WHEN query_canceled THEN',
    '        PERFORM set_config(\'serviceman.answer\', json_build_object(\'error\', SQLERRM, \'code\', SQLSTATE)::text, true);',
    '    WHEN OTHERS THEN',
    '        GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT, detail = PG_EXCEPTION_DETAIL;',
    '        PERFORM set_config(\'serviceman.answer\', json_build_object(\'error\', SQLERRM, \'code\', SQLSTATE, \'hint\', hint, \'detail\', detail)::text, true);',
    'END',
    '$serviceman$;',
];

// The database's tables and views, public's first, then each schema's, by name; each with its
// rows, its size and its indexes: the rows counted where that is quick, else as PostgreSQL
// estimates them; a view has no numbers but a materialized one's
const COLLECTIONS = [
    'DO $serviceman$',
    'DECLARE',
    ASK,
    '    time0 timestamptz := clock_timestamp();',
    '    relation record;',
    '    counted bigint;',
    '    estimated boolean;',
    '    items json[] := \'{}\';',
    '    hint text;',
    '    detail text;',
    'BEGIN',
    '    FOR relation IN',
    `        SELECT c.relkind, n.nspname, c.relname, ${NAME} AS name,`,
    '            (SELECT count(*) FROM pg_index AS i WHERE i.indrelid = c.oid) AS indexes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(pg_table_size(t.relid)) FROM pg_partition_tree(c.oid) AS t) ELSE pg_table_size(c.oid) END AS bytes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(pg_total_relation_size(t.relid)) FROM pg_partition_tree(c.oid) AS t) ELSE pg_total_relation_size(c.oid) END AS storage_bytes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(pg_indexes_size(t.relid)) FROM pg_partition_tree(c.oid) AS t) ELSE pg_indexes_size(c.oid) END AS index_bytes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(r.reltuples) FROM pg_partition_tree(c.oid) AS t JOIN pg_class AS r ON r.oid = t.relid WHERE r.reltuples >= 0) WHEN c.reltuples >= 0 THEN c.reltuples END AS estimate,',
    `            ${KEY} AS key`,
    '        FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace',
    `        WHERE ${LISTED}`,
    '        ORDER BY n.nspname <> \'public\', n.nspname, lower(c.relname), c.relname',
    '    LOOP',
    '        counted := NULL;',
    '        estimated := false;',
    '        IF relation.relkind IN (\'r\', \'p\', \'m\') THEN',
    '            IF (relation.bytes <= (ask->>\'count_bytes\')::bigint) AND ((clock_timestamp() - time0) < ((ask->>\'count_ms\')::int * INTERVAL \'1 millisecond\')) THEN',
    '                BEGIN',
    '                    EXECUTE format(\'SELECT count(*) FROM %I.%I\', relation.nspname, relation.relname) INTO counted;',
    '                EXCEPTION WHEN OTHERS THEN',
    '                    counted := NULL;',
    '                END;',
    '            END IF;',
    '            IF (counted IS NULL) AND (relation.estimate IS NOT NULL) THEN',
    '                counted := round(relation.estimate);',
    '                estimated := true;',
    '            END IF;',
    '        END IF;',
    '        items := items || json_build_object(',
    '            \'name\', relation.name,',
    '            \'type\', CASE WHEN relation.relkind IN (\'v\', \'m\') THEN \'view\' ELSE \'table\' END,',
    '            \'count\', counted,',
    '            \'estimated\', estimated,',
    '            \'bytes\', CASE WHEN relation.relkind IN (\'r\', \'p\', \'m\') THEN relation.bytes END,',
    '            \'storage_bytes\', CASE WHEN relation.relkind IN (\'r\', \'p\', \'m\') THEN relation.storage_bytes END,',
    '            \'index_bytes\', CASE WHEN relation.relkind IN (\'r\', \'p\', \'m\') THEN relation.index_bytes END,',
    '            \'indexes\', CASE WHEN relation.relkind IN (\'r\', \'p\', \'m\') THEN relation.indexes END,',
    '            \'key\', CASE WHEN relation.relkind IN (\'r\', \'p\') THEN relation.key END',
    '        );',
    '    END LOOP;',
    '    PERFORM set_config(\'serviceman.answer\', json_build_object(\'ok\', array_to_json(items))::text, true);',
].concat(REFUSED);

// What a page reads: a table's rows, its columns as asked, those its condition finds, in its
// order; their count is a statement of its own, run after it. The table is found by its name in
// the list and named in the statement quoted, never as given.
const DOCUMENTS = [
    '    target := (',
    '        SELECT format(\'%I.%I\', n.nspname, c.relname) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace',
    `        WHERE ${LISTED} AND (${NAME}) = ask->>'collection' ORDER BY n.nspname <> 'public' LIMIT 1`,
    '    );',
    '    IF target IS NULL THEN',
    '        RAISE EXCEPTION \'no table called % in %\', ask->>\'collection\', current_database();',
    '    END IF;',
    '    filtered := CASE WHEN ask->>\'filter\' = \'\' THEN \'\' ELSE format(E\' WHERE (\\n%s\\n)\', ask->>\'filter\') END;',
    '    statement := format(E\'SELECT %s FROM %s%s%s LIMIT %s OFFSET %s\',',
    '        CASE WHEN ask->>\'fields\' = \'\' THEN \'*\' ELSE format(E\'\\n%s\\n\', ask->>\'fields\') END, target, filtered,',
    '        CASE WHEN ask->>\'sort\' = \'\' THEN \'\' ELSE format(E\' ORDER BY\\n%s\\n\', ask->>\'sort\') END, page_limit + 1, ask->>\'skip\');',
    '    PERFORM set_config(\'serviceman.count\', format(\'SELECT count(*) FROM %s%s\', target, filtered), true);',
];
// What the query box reads: its statement as typed, whole, from the page's first row on; none
// typed, the open table's rows
const QUERY = [
    '    statement := ask->>\'query\';',
    '    moves := (ask->>\'skip\')::bigint;',
    '    IF statement = \'\' THEN',
    '        target := (',
    '            SELECT format(\'%I.%I\', n.nspname, c.relname) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace',
    `            WHERE ${LISTED} AND (${NAME}) = ask->>'collection' ORDER BY n.nspname <> 'public' LIMIT 1`,
    '        );',
    '        statement := format(\'SELECT * FROM %s\', coalesce(target, quote_ident(ask->>\'collection\')));',
    '    END IF;',
];

// The page itself, its rows read from a cursor one past the page, which says whether a next
// page is there: each row an array of its values as PostgreSQL gives them in JSON, the column
// names once; a name two columns have (a join's) is kept twice
function page_lines(statement_lines)
{
    return [
        'DO $serviceman$',
        'DECLARE',
        ASK,
        '    page_limit int := (ask->>\'limit\')::int;',
        '    page_cursor refcursor;',
        '    statement text;',
        '    target text;',
        '    filtered text;',
        '    moves bigint := 0;',
        '    fetched record;',
        '    line json;',
        '    names json;',
        '    rows json[] := \'{}\';',
        '    bytes bigint := 0;',
        '    more boolean := false;',
        '    cut boolean := false;',
        '    time0 timestamptz;',
        '    hint text;',
        '    detail text;',
        'BEGIN',
    ].concat(statement_lines, [
        '    time0 := clock_timestamp();',
        '    OPEN page_cursor NO SCROLL FOR EXECUTE statement;',
        '    IF moves > 0 THEN',
        '        MOVE FORWARD moves FROM page_cursor;',
        '    END IF;',
        '    LOOP',
        '        FETCH page_cursor INTO fetched;',
        '        EXIT WHEN NOT FOUND;',
        '        IF cardinality(rows) = page_limit THEN',
        '            more := true;',
        '            EXIT;',
        '        END IF;',
        '        line := to_json(fetched);',
        '        IF names IS NULL THEN',
        '            names := (SELECT coalesce(json_agg(e.key ORDER BY e.n), \'[]\') FROM json_each(line) WITH ORDINALITY AS e(key, value, n));',
        '        END IF;',
        '        line := (SELECT coalesce(json_agg(e.value ORDER BY e.n), \'[]\') FROM json_each(line) WITH ORDINALITY AS e(key, value, n));',
        '        bytes := bytes + octet_length(line::text);',
        '        IF (bytes > (ask->>\'page_bytes\')::bigint) AND (cardinality(rows) > 0) THEN',
        '            more := true;',
        '            cut := true;',
        '            EXIT;',
        '        END IF;',
        '        rows := rows || line;',
        '    END LOOP;',
        '    CLOSE page_cursor;',
        '    PERFORM set_config(\'serviceman.answer\', json_build_object(\'ok\', json_build_object(',
        '        \'names\', coalesce(names, \'[]\'), \'rows\', array_to_json(rows), \'more\', more, \'cut\', cut,',
        '        \'took_ms\', round(extract(epoch FROM clock_timestamp() - time0) * 1000)',
        '    ))::text, true);',
    ], REFUSED);
}

// How many rows the page's condition finds in all: a statement of its own, under a limit of its
// own; past it, or refused, none is said
const COUNT = [
    'DO $serviceman$',
    'DECLARE',
    '    statement text := current_setting(\'serviceman.count\', true);',
    '    counted bigint;',
    'BEGIN',
    '    IF coalesce(statement, \'\') = \'\' THEN',
    '        RETURN;',
    '    END IF;',
    '    EXECUTE statement INTO counted;',
    '    PERFORM set_config(\'serviceman.counted\', counted::text, true);',
    'EXCEPTION WHEN query_canceled OR OTHERS THEN',
    '    NULL;',
    'END',
    '$serviceman$;',
];

// What a block on one row declares, and how it finds its table: by its name in the list, as a
// page does, with the columns a row of it is named by (KEY)
const ROW_DECLARED = [
    'DO $serviceman$',
    'DECLARE',
    ASK,
    '    relation record;',
    '    matches text;',
    '    unknown text;',
    '    sets text;',
    '    named text;',
    '    picks text;',
    '    columns json;',
    '    filled json;',
    '    current json;',
    '    line json;',
    '    names json;',
    '    changed json := \'[]\';',
    '    hint text;',
    '    detail text;',
    'BEGIN',
    `    SELECT c.oid, c.relkind, format('%I.%I', n.nspname, c.relname) AS target, ${KEY} AS key INTO relation`,
    '    FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace',
    `    WHERE ${LISTED} AND (${NAME}) = ask->>'collection' ORDER BY n.nspname <> 'public' LIMIT 1;`,
    '    IF NOT FOUND THEN',
    '        RAISE EXCEPTION \'no table called % in %\', ask->>\'collection\', current_database();',
    '    END IF;',
];
// A table whose rows are changed: one named by a key, never a view; and the row asked, by the
// columns of that key, each given as the page read it and read by its column's type
// (json_populate_record), so a value is never SQL
const KEYED = [
    '    IF relation.relkind IN (\'v\', \'m\') THEN',
    '        RAISE EXCEPTION USING ERRCODE = \'SMRO1\', MESSAGE = format(\'%s is a view: its rows are changed in the tables it reads\', ask->>\'collection\');',
    '    END IF;',
    '    IF relation.key IS NULL THEN',
    '        RAISE EXCEPTION USING ERRCODE = \'SMRO1\', MESSAGE = format(\'%s has no primary key, nor a unique key of NOT NULL columns, to name one row by: its rows are read alone\', ask->>\'collection\');',
    '    END IF;',
];
const MATCHED = [
    '    IF (SELECT array_agg(k ORDER BY k) FROM json_object_keys(ask->\'id\') AS k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM json_array_elements_text(relation.key) AS k) THEN',
    '        RAISE EXCEPTION \'a row of % is named by its key: %\', ask->>\'collection\', (SELECT string_agg(k, \', \') FROM json_array_elements_text(relation.key) AS k);',
    '    END IF;',
    '    matches := (SELECT string_agg(format(\'serviceman_row.%I = serviceman_key.%I\', k, k), \' AND \') FROM json_array_elements_text(relation.key) AS k);',
];
// The columns to set, each one of the table's, by name
const KNOWN = [
    '    unknown := (SELECT k FROM json_object_keys(ask->\'set\') AS k WHERE NOT EXISTS (SELECT FROM pg_attribute AS a WHERE (a.attrelid = relation.oid) AND (a.attnum > 0) AND (NOT a.attisdropped) AND (a.attname = k)) LIMIT 1);',
    '    IF unknown IS NOT NULL THEN',
    '        RAISE EXCEPTION \'no column "%" in %\', unknown, ask->>\'collection\';',
    '    END IF;',
];
// The row a block ends with, as a page's: its column names once, its values in their order;
// with the key, and the columns another hand changed since it was read
const ROW_ANSWERED = [
    '    IF line IS NOT NULL THEN',
    '        names := (SELECT coalesce(json_agg(e.key ORDER BY e.n), \'[]\') FROM json_each(line) WITH ORDINALITY AS e(key, value, n));',
    '        line := (SELECT coalesce(json_agg(e.value ORDER BY e.n), \'[]\') FROM json_each(line) WITH ORDINALITY AS e(key, value, n));',
    '    END IF;',
    '    PERFORM set_config(\'serviceman.answer\', json_build_object(\'ok\', json_build_object(',
    '        \'names\', names, \'row\', line, \'key\', relation.key, \'changed\', changed, \'columns\', columns, \'filled\', filled',
    '    ))::text, true);',
];

// One row read whole by its key, for Edit, with the table's columns in their order and those
// its database fills itself, a default, an identity or a generated one, for + Row; no id, the
// columns alone
const DOCUMENT = ROW_DECLARED.concat([
    '    columns := (SELECT coalesce(json_agg(a.attname ORDER BY a.attnum), \'[]\') FROM pg_attribute AS a WHERE (a.attrelid = relation.oid) AND (a.attnum > 0) AND (NOT a.attisdropped));',
    '    filled := (SELECT coalesce(json_agg(a.attname ORDER BY a.attnum), \'[]\') FROM pg_attribute AS a WHERE (a.attrelid = relation.oid) AND (a.attnum > 0) AND (NOT a.attisdropped) AND (a.atthasdef OR (a.attidentity <> \'\') OR (a.attgenerated <> \'\')));',
    '    IF json_typeof(ask->\'id\') = \'object\' THEN',
], KEYED, MATCHED, [
    '        EXECUTE format(\'SELECT to_json(serviceman_row) FROM %s AS serviceman_row, json_populate_record(NULL::%s, $1) AS serviceman_key WHERE %s\', relation.target, relation.target, matches) INTO line USING ask->\'id\';',
    '    END IF;',
], ROW_ANSWERED, REFUSED);

// A row added: the columns given, each read by its type, their defaults filling the rest; read
// back as it was added, RETURNING it whole
const INSERT = ROW_DECLARED.concat(KEYED, KNOWN, [
    '    named := (SELECT string_agg(format(\'%I\', e.k), \', \' ORDER BY e.n) FROM json_object_keys(ask->\'set\') WITH ORDINALITY AS e(k, n));',
    '    picks := (SELECT string_agg(format(\'serviceman_set.%I\', e.k), \', \' ORDER BY e.n) FROM json_object_keys(ask->\'set\') WITH ORDINALITY AS e(k, n));',
    '    IF named IS NULL THEN',
    '        EXECUTE format(\'INSERT INTO %s AS serviceman_row DEFAULT VALUES RETURNING to_json(serviceman_row)\', relation.target) INTO line;',
    '    ELSE',
    '        EXECUTE format(\'INSERT INTO %s AS serviceman_row (%s) SELECT %s FROM json_populate_record(NULL::%s, $1) AS serviceman_set RETURNING to_json(serviceman_row)\', relation.target, named, picks, relation.target) INTO line USING ask->\'set\';',
    '    END IF;',
    '    SET CONSTRAINTS ALL IMMEDIATE;',
], ROW_ANSWERED, REFUSED);

// A row edited: locked by its key, then each column to set compared with what it held when the
// page read it, as JSON (jsonb compares numbers by value, objects key by key); one another hand
// changed meanwhile is said, the row as it is now, and nothing is saved over it. Else the
// columns changed alone are set, and the row read back as it is saved.
const REPLACE = ROW_DECLARED.concat(KEYED, MATCHED, KNOWN, [
    '    EXECUTE format(\'SELECT to_json(serviceman_row) FROM %s AS serviceman_row, json_populate_record(NULL::%s, $1) AS serviceman_key WHERE %s FOR UPDATE OF serviceman_row\', relation.target, relation.target, matches) INTO current USING ask->\'id\';',
    '    IF current IS NULL THEN',
    '        RAISE EXCEPTION USING ERRCODE = \'SMGON\', MESSAGE = \'it is not there any more: deleted, or its key changed, since it was read\';',
    '    END IF;',
    '    changed := (SELECT coalesce(json_agg(k), \'[]\') FROM json_object_keys(ask->\'set\') AS k WHERE ((ask->\'was\'->k) IS NOT NULL) AND (((current::jsonb)->k) IS DISTINCT FROM (ask->\'was\'->k)::jsonb));',
    '    line := current;',
    '    sets := (SELECT string_agg(format(\'%I = serviceman_set.%I\', k, k), \', \') FROM json_object_keys(ask->\'set\') AS k);',
    '    IF (json_array_length(changed) = 0) AND (sets IS NOT NULL) THEN',
    '        EXECUTE format(\'UPDATE %s AS serviceman_row SET %s FROM json_populate_record(NULL::%s, $1) AS serviceman_set, json_populate_record(NULL::%s, $2) AS serviceman_key WHERE %s RETURNING to_json(serviceman_row)\', relation.target, sets, relation.target, relation.target, matches) INTO line USING ask->\'set\', ask->\'id\';',
    '        SET CONSTRAINTS ALL IMMEDIATE;',
    '    END IF;',
], ROW_ANSWERED, REFUSED);

// A row deleted by its key, answered with what it held
const REMOVE = ROW_DECLARED.concat(KEYED, MATCHED, [
    '    EXECUTE format(\'DELETE FROM %s AS serviceman_row USING json_populate_record(NULL::%s, $1) AS serviceman_key WHERE %s RETURNING to_json(serviceman_row)\', relation.target, relation.target, matches) INTO line USING ask->\'id\';',
    '    IF line IS NULL THEN',
    '        RAISE EXCEPTION USING ERRCODE = \'SMGON\', MESSAGE = \'it is not there any more: deleted, or its key changed, since it was read\';',
    '    END IF;',
    '    SET CONSTRAINTS ALL IMMEDIATE;',
], ROW_ANSWERED, REFUSED);
// The SQLSTATEs a block raises of its own, a table whose rows are read alone and a row gone, and
// a lock waited for past LOCK_MS
const STATUS_BY_CODE = {SMRO1: 405, SMGON: 400, '55P03': 409};

// PostgreSQL, for the data browser: each ask a psql script that `run(script)` runs in the
// database as its own user, and answers with what it printed. Every read is one READ ONLY
// transaction, rolled back at its end: a write typed into a condition or the query box (a DELETE,
// a DROP, nextval()) is refused by PostgreSQL itself, and what is typed runs with the user's own
// rights alone. The ask goes into the script as hex, a GUC's value, which no client reads as
// SQL; a DO block reads it and runs what is typed with EXECUTE, where a COMMIT is refused too.
//
// A row is added, edited or deleted by its table's key (KEY), each in a transaction of its own,
// committed when it is done: its values go in as JSON, each read by its column's type, never as
// SQL, and its table and columns are found by name and quoted (%I). An edit saves the columns
// changed alone, and not over a change another hand made to them since the page read the row.
//
//     adapter = postgresql_adapter(v => database_script(connect, server, 'shop', v))
//     await adapter.collections()   // [{name, type, count, estimated, bytes, storage_bytes, index_bytes, indexes, key}]
//     await adapter.documents({collection: 'archive.orders', filter: "status = 'paid'", sort: 'placed DESC', fields: 'id, total', skip: 0, limit: 50})
//                                   // {items, columns, count, more, took_ms, cut}
//     await adapter.aggregate({collection: 'orders', pipeline: 'SELECT status, count(*) FROM orders GROUP BY status', skip: 0, limit: 50})
//                                   // {items, columns, count: null, more, took_ms, cut}
//     await adapter.document({collection: 'orders', id: {id: 7}})                   // {item, columns, key, filled}
//     await adapter.insert({collection: 'orders', document: '{"customer": "ann"}'})   // {id: {id: 41}, item, saved}
//     await adapter.replace({collection: 'orders', id: {id: 7}, document: '{…}', was: '{…}'})
//                                   // {id, item, saved}; 409 when another hand changed what it changes
//     await adapter.remove({collection: 'orders', id: {id: 7}})                     // {id, item, saved: []}
function postgresql_adapter(run)
{
    return {
        engine: 'postgresql',
        collections: async function () {
            const printed = await run(script_of([`SET LOCAL statement_timeout = ${FIND_MS};`].concat(COLLECTIONS), {count_bytes: COUNT_BYTES, count_ms: COUNT_MS}));
            return answer_read(printed);
        },
        documents: async function (ask) {
            const json = {
                collection: ask.collection,
                fields: sql_part_from_text(ask.fields, ''),
                filter: sql_part_from_text(ask.filter, 'WHERE'),
                sort: sql_part_from_text(ask.sort, 'ORDER BY'),
                skip: ask.skip,
                limit: ask.limit,
                page_bytes: PAGE_BYTES,
            };
            const lines = [`SET LOCAL statement_timeout = ${FIND_MS};`].concat(page_lines(DOCUMENTS), [`SET LOCAL statement_timeout = ${COUNT_MS};`], COUNT);
            return page_read(await run(script_of(lines, json)));
        },
        aggregate: async function (ask) {
            const json = {collection: ask.collection, query: sql_part_from_text(ask.pipeline, ''), skip: ask.skip, limit: ask.limit, page_bytes: PAGE_BYTES};
            const page = page_read(await run(script_of([`SET LOCAL statement_timeout = ${FIND_MS};`].concat(page_lines(QUERY)), json)));
            return {items: page.items, columns: page.columns, count: null, more: page.more, took_ms: page.took_ms, cut: page.cut};
        },
        document: async function (ask) {
            const id = ((ask.id === undefined) || (ask.id === null)) ? null : sql_change_from_ask({collection: ask.collection, id: ask.id}).id;
            const json = {collection: ask.collection, id};
            const found = answer_read(await run(script_of([`SET LOCAL statement_timeout = ${FIND_MS};`].concat(DOCUMENT), json)));
            return {item: row_of(found).item, columns: found.columns, key: found.key, filled: found.filled};
        },
        insert: async function (ask) {
            const change = sql_change_from_ask(ask);
            return change_read(await run(change_script_of(INSERT, change)), change);
        },
        replace: async function (ask) {
            const change = sql_change_from_ask(ask);
            return change_read(await run(change_script_of(REPLACE, change)), change);
        },
        remove: async function (ask) {
            const change = sql_change_from_ask({collection: ask.collection, id: ask.id});
            return change_read(await run(change_script_of(REMOVE, change)), change);
        },
    };
}

// The script: the ask as hex in a GUC of the transaction, which is read only and rolled back,
// the lines, then the answer printed on one line of its own (JSON's own newlines are spaces in
// it) and the count on another
function script_of(lines, ask)
{
    const head = [
        'BEGIN TRANSACTION READ ONLY;',
        `SET LOCAL serviceman.ask = '${Buffer.from(json_from_ejson(ask), 'utf8').toString('hex')}';`,
    ];
    const foot = [
        `SELECT '${ANSWER}' || translate(current_setting('serviceman.answer', true), E'\\n\\r', '  ');`,
        `SELECT '${COUNTED}' || coalesce(current_setting('serviceman.counted', true), '');`,
        'ROLLBACK;',
        '',
    ];
    return head.concat(lines, foot).join('\n');
}

// A change's script: a transaction of its own, the database's default, READ WRITE unless it says
// otherwise; the ask as hex, its numbers by their digits; a row another transaction holds waited
// for LOCK_MS at most; the answer printed, then the change committed. The block catches what it
// is refused, its own work undone, and the transaction commits nothing; a COMMIT that fails ends
// psql with an error, so no answer it printed is taken for a change made.
function change_script_of(lines, ask)
{
    const head = [
        'BEGIN;',
        `SET LOCAL serviceman.ask = '${Buffer.from(json_from_ejson(ask), 'utf8').toString('hex')}';`,
        `SET LOCAL statement_timeout = ${FIND_MS};`,
        `SET LOCAL lock_timeout = ${LOCK_MS};`,
    ];
    const foot = [
        `SELECT '${ANSWER}' || translate(current_setting('serviceman.answer', true), E'\\n\\r', '  ');`,
        'COMMIT;',
        '',
    ];
    return head.concat(lines, foot).join('\n');
}

// What a change answered: the row as it is after it, its key, and the columns asked to be set; a
// row another hand changed since it was read is refused (409) with what it holds now
function change_read(printed, change)
{
    const found = answer_read(printed);
    const row = row_of(found);
    if (found.changed.length > 0) {
        throw Object.assign(new Error(changed_said_of(found.changed, row.item)), {status: 409, changed: found.changed, item: row.item});
    }
    const id = {};
    for (const name of found.key) {
        id[name] = row.item[name];
    }
    return {id, item: row.item, saved: (change.set === null) ? [] : Object.keys(change.set)};
}

// The row a block answered, as an object keyed by its columns, null for none
function row_of(found)
{
    if (found.row === null) {
        return {item: null};
    }
    return {item: items_from_rows(found.names, [found.row]).items[0]};
}

// What the script answered: what it found, or what PostgreSQL refused, as a refusal of the ask
// (400); a script that printed no answer did not reach the database (502)
function answer_read(printed)
{
    const line = printed.split('\n').find(v => v.startsWith(ANSWER) && (v.length > ANSWER.length));
    if (line === undefined) {
        throw Object.assign(new Error(`psql printed no answer: ${printed.trim().slice(0, 300) || 'nothing'}`), {status: 502});
    }
    const answer = ejson_from_json(line.slice(ANSWER.length));
    if (answer.error !== undefined) {
        throw Object.assign(new Error(said_of(answer)), {status: (STATUS_BY_CODE[answer.code] === undefined) ? 400 : STATUS_BY_CODE[answer.code]});
    }
    return answer.ok;
}

// A page as the browser answers it: its rows as objects keyed by column, the columns in order,
// and how many the condition finds in all, null when that was not counted in time
function page_read(printed)
{
    const page = answer_read(printed);
    const rows = items_from_rows(page.names, page.rows);
    const counted = printed.split('\n').find(v => v.startsWith(COUNTED));
    const count = ((counted === undefined) || (counted === COUNTED)) ? null : Number(counted.slice(COUNTED.length));
    return {items: rows.items, columns: rows.columns, count, more: page.more, took_ms: page.took_ms, cut: page.cut};
}

// What PostgreSQL said, in words for the page
function said_of(answer)
{
    if (answer.code === '57014') {
        return `it took longer than ${FIND_MS/1000} s, and PostgreSQL stopped it: an index on what it filters or sorts by makes it quick`;
    }
    if (answer.code === '25006') {
        return `it writes, and what is typed here is only read, a row being changed by its own buttons: ${answer.error}`;
    }
    // What gives no rows, a DELETE or a DROP typed into the query box, or two statements, is no
    // cursor's
    if (answer.code === '42P11') {
        return `only what one SELECT gives is read here, a row being changed by its own buttons: ${answer.error}`;
    }
    if (answer.code === '55P03') {
        return `another transaction holds the row, an app's or a page's, and it was waited for ${LOCK_MS/1000} s: nothing was changed, try again in a moment`;
    }
    const detail = ((answer.detail === null) || (answer.detail === undefined) || (answer.detail === '')) ? '' : `: ${answer.detail}`;
    const hint = ((answer.hint === null) || (answer.hint === undefined) || (answer.hint === '')) ? '' : ` (${answer.hint})`;
    return `${answer.error}${detail}${hint}`;
}

module.exports = postgresql_adapter;
