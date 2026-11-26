const ejson_from_json = require('./ejson_from_json');
const items_from_rows = require('./items_from_rows');
const sql_part_from_text = require('./sql_part_from_text');

// How long a page of rows may take to be found, and to be counted, before PostgreSQL stops it
const FIND_MS = 20000;
const COUNT_MS = 5000;
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

// Where a DO block reads the ask from, and how it says its answer: what it found, or what
// PostgreSQL refused, with its hint
const ASK = '    ask json := convert_from(decode(current_setting(\'serviceman.ask\'), \'hex\'), \'UTF8\')::json;';
const REFUSED = [
    'EXCEPTION',
    '    WHEN query_canceled THEN',
    '        PERFORM set_config(\'serviceman.answer\', json_build_object(\'error\', SQLERRM, \'code\', SQLSTATE)::text, true);',
    '    WHEN OTHERS THEN',
    '        GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;',
    '        PERFORM set_config(\'serviceman.answer\', json_build_object(\'error\', SQLERRM, \'code\', SQLSTATE, \'hint\', hint)::text, true);',
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
    'BEGIN',
    '    FOR relation IN',
    `        SELECT c.relkind, n.nspname, c.relname, ${NAME} AS name,`,
    '            (SELECT count(*) FROM pg_index AS i WHERE i.indrelid = c.oid) AS indexes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(pg_table_size(t.relid)) FROM pg_partition_tree(c.oid) AS t) ELSE pg_table_size(c.oid) END AS bytes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(pg_total_relation_size(t.relid)) FROM pg_partition_tree(c.oid) AS t) ELSE pg_total_relation_size(c.oid) END AS storage_bytes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(pg_indexes_size(t.relid)) FROM pg_partition_tree(c.oid) AS t) ELSE pg_indexes_size(c.oid) END AS index_bytes,',
    '            CASE WHEN c.relkind = \'p\' THEN (SELECT sum(r.reltuples) FROM pg_partition_tree(c.oid) AS t JOIN pg_class AS r ON r.oid = t.relid WHERE r.reltuples >= 0) WHEN c.reltuples >= 0 THEN c.reltuples END AS estimate',
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
    '            \'indexes\', CASE WHEN relation.relkind IN (\'r\', \'p\', \'m\') THEN relation.indexes END',
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

// PostgreSQL, for the data browser: each ask a psql script that `run(script)` runs in the
// database as its own user, and answers with what it printed. Every script is one READ ONLY
// transaction, rolled back at its end: a write typed into a condition or the query box (a DELETE,
// a DROP, nextval()) is refused by PostgreSQL itself, and what is typed runs with the user's own
// rights alone. The ask goes into the script as hex, a GUC's value, which no client reads as
// SQL; a DO block reads it and runs what is typed with EXECUTE, where a COMMIT is refused too.
//
//     adapter = postgresql_adapter(v => database_script(connect, server, 'shop', v))
//     await adapter.collections()   // [{name, type, count, estimated, bytes, storage_bytes, index_bytes, indexes}]
//     await adapter.documents({collection: 'archive.orders', filter: "status = 'paid'", sort: 'placed DESC', fields: 'id, total', skip: 0, limit: 50})
//                                   // {items, columns, count, more, took_ms, cut}
//     await adapter.aggregate({collection: 'orders', pipeline: 'SELECT status, count(*) FROM orders GROUP BY status', skip: 0, limit: 50})
//                                   // {items, columns, count: null, more, took_ms, cut}
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
    };
}

// The script: the ask as hex in a GUC of the transaction, which is read only and rolled back,
// the lines, then the answer printed on one line of its own (JSON's own newlines are spaces in
// it) and the count on another
function script_of(lines, ask)
{
    const head = [
        'BEGIN TRANSACTION READ ONLY;',
        `SET LOCAL serviceman.ask = '${Buffer.from(JSON.stringify(ask), 'utf8').toString('hex')}';`,
    ];
    const foot = [
        `SELECT '${ANSWER}' || translate(current_setting('serviceman.answer', true), E'\\n\\r', '  ');`,
        `SELECT '${COUNTED}' || coalesce(current_setting('serviceman.counted', true), '');`,
        'ROLLBACK;',
        '',
    ];
    return head.concat(lines, foot).join('\n');
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
        throw Object.assign(new Error(said_of(answer)), {status: 400});
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
        return `it writes, and this page changes nothing for now: ${answer.error}`;
    }
    // What gives no rows, a DELETE or a DROP typed into the query box, or two statements, is no
    // cursor's
    if (answer.code === '42P11') {
        return `only what one SELECT gives is read here, and this page changes nothing for now: ${answer.error}`;
    }
    return ((answer.hint === null) || (answer.hint === undefined) || (answer.hint === '')) ? answer.error : `${answer.error} (${answer.hint})`;
}

module.exports = postgresql_adapter;
