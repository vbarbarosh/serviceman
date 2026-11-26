const changed_said_of = require('./changed_said_of');
const ejson_from_json = require('./ejson_from_json');
const ejson_number_from_text = require('./ejson_number_from_text');
const items_from_rows = require('./items_from_rows');
const json_from_ejson = require('./json_from_ejson');
const sql_change_from_ask = require('./sql_change_from_ask');
const sql_part_at = require('./sql_part_at');
const sql_part_from_text = require('./sql_part_from_text');
const sql_statement_built = require('./sql_statement_built');

// How long a page of rows may take to be found, and to be counted, before MySQL stops it
const FIND_MS = 20000;
const COUNT_MS = 5000;
// How long a change waits for a row another transaction holds (an app's) before it gives up, in
// seconds, MySQL's unit for it
const LOCK_S = 5;
// A table is counted row by row up to this size, all of them together within COUNT_MS; past
// either, the rows MySQL estimates it holds are said, as an estimate
const COUNT_BYTES = 64*1024*1024;
// What a page of rows carries at most: the rest of the page is left out, and it says so
const PAGE_BYTES = 4*1024*1024;
// Where the client's XML begins, a line of its own after the column types of its first run
const RE_XML_HEAD = /^<\?xml version="1\.0"\?>$/m;
// The types the client names, by what their values are read as; any other is text
const INTEGERS = ['TINY', 'SHORT', 'LONG', 'INT24', 'LONGLONG', 'YEAR'];
const DECIMALS = ['DECIMAL', 'NEWDECIMAL'];
const FLOATS = ['FLOAT', 'DOUBLE'];
// The client's own errors (it could not connect, the server went away): no refusal of the ask
const CLIENT_ERRORS = {least: 2000, most: 2999};
// A lock waited for past LOCK_S
const LOCK_WAIT_TIMEOUT = 1205;
// The column types, as information_schema names them, by how a change writes their values and
// matches them: binary data (and geometry, which MySQL keeps as bytes) from its hex, numbers and
// times read by MySQL from their text, JSON from its own; any other is text
const COLUMN_BINARIES = ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geomcollection', 'geometrycollection'];
const COLUMN_INTEGERS = ['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'year'];
const COLUMN_TEXTS = ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set'];
const COLUMN_CASTS = {float: 'FLOAT', double: 'DOUBLE', date: 'DATE'};
const RE_WHOLE = /^-?\d+$/;
const RE_DECIMAL = /^-?\d+(\.\d+)?$/;
const RE_FLOAT = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const RE_HEX = /^0x([0-9a-f]{2})*$/i;
// Where MySQL's syntax error says it stopped: the statement's text from there, cut at 80
// characters, and the line of the statement it is on
const RE_NEAR = /near '([\s\S]*)' at line (\d+)$/;
const SYNTAX_ERROR = 1064;
// Every script is one READ ONLY transaction, and the session's too
const HEAD = [
    'SET SESSION TRANSACTION READ ONLY;',
    'START TRANSACTION READ ONLY;',
    `SET SESSION max_execution_time = ${FIND_MS};`,
];

// The database's tables and views, each with its rows, its size and its indexes as MySQL keeps
// them; then the rows of each table small enough, counted, within a limit of their own; and the
// unique keys of each, the primary first, which a row is named by (key_of)
const TABLES = [
    'SELECT t.TABLE_NAME AS name, t.TABLE_TYPE AS type, t.TABLE_ROWS AS estimate, t.DATA_LENGTH AS bytes, t.INDEX_LENGTH AS index_bytes,',
    '    (SELECT COUNT(DISTINCT s.INDEX_NAME) FROM information_schema.STATISTICS AS s WHERE (s.TABLE_SCHEMA = t.TABLE_SCHEMA) AND (s.TABLE_NAME = t.TABLE_NAME)) AS indexes',
    'FROM information_schema.TABLES AS t WHERE t.TABLE_SCHEMA = DATABASE()',
].join('\n');
const COUNTS = [
    'SELECT GROUP_CONCAT(CONCAT(\'SELECT \', QUOTE(TABLE_NAME), \' AS name, COUNT(*) AS n FROM `\', REPLACE(TABLE_NAME, \'`\', \'``\'), \'`\') SEPARATOR \' UNION ALL \') INTO @serviceman_counts',
    `FROM information_schema.TABLES WHERE (TABLE_SCHEMA = DATABASE()) AND (TABLE_TYPE = 'BASE TABLE') AND (DATA_LENGTH <= ${COUNT_BYTES});`,
];
const KEYS = 'SELECT TABLE_NAME AS name, INDEX_NAME AS key_name, COLUMN_NAME AS column_name, NULLABLE AS nullable, SUB_PART AS part FROM information_schema.STATISTICS WHERE (TABLE_SCHEMA = DATABASE()) AND (NON_UNIQUE = 0)';
const KEYS_ORDER = 'ORDER BY TABLE_NAME, INDEX_NAME <> \'PRIMARY\', INDEX_NAME, SEQ_IN_INDEX';
// One table as a change needs it: whether it is one and of which kind, its columns, each with
// its type and whether its database fills it itself (a default, AUTO_INCREMENT, a generated
// one), and its unique keys; the database's name, for the words when it is none of its tables
const COLUMNS = 'SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, COLUMN_DEFAULT, EXTRA, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION FROM information_schema.COLUMNS WHERE (TABLE_SCHEMA = DATABASE())';
// A change's own session: what a type refuses is refused, never cut to fit with a warning (a
// server may keep a mode that is not strict); a row another transaction holds is waited for
// LOCK_S; a transaction of its own, the database's default, READ WRITE unless it says otherwise
const CHANGE_HEAD = [
    'SET SESSION sql_mode = IF(@@SESSION.sql_mode = \'\', \'STRICT_ALL_TABLES\', CONCAT(@@SESSION.sql_mode, \',STRICT_ALL_TABLES\'));',
    `SET SESSION innodb_lock_wait_timeout = ${LOCK_S};`,
    `SET SESSION max_execution_time = ${FIND_MS};`,
    'START TRANSACTION;',
];

// MySQL, for the data browser: each ask a script that `run(script)` runs in the database as its
// own user, and answers with what the client printed. The client runs it twice: first in a
// table, with --column-type-info and @serviceman_types set, where the page's statement runs
// under LIMIT 0, which MySQL answers at once with its result's columns and their types and no
// row; then as XML, which tells NULL from the word NULL, for its rows. The client has no JSON of
// its own for a SELECT, and JSON_OBJECT would need a derived table, which refuses a join's two
// columns of one name. Every script is one READ ONLY transaction, rolled back: a write typed
// into a condition or the query box is refused by MySQL itself, and what is typed runs with the
// user's own rights alone. What is typed goes into the script as hex, prepared as one statement:
// the client never reads it as SQL, and a second statement in it is refused.
//
// A row is added, edited or deleted by its table's key (key_of), each in a transaction of its
// own, committed when it is done: the table is described first, so each column is found by name
// and quoted, and each value written in a hex literal of its own, read by MySQL by its column's
// type, never as SQL. An edit saves the columns changed alone, and not over a change another hand
// made to them since the page read the row. The client's first run of a change writes nothing.
//
//     adapter = mysql_adapter(v => database_script(connect, server, 'shop', v))
//     await adapter.collections()   // [{name, type, count, estimated, bytes, storage_bytes, index_bytes, indexes, key}]
//     await adapter.documents({collection: 'orders', filter: "status = 'paid'", sort: 'placed DESC', fields: 'id, total', skip: 0, limit: 50})
//                                   // {items, columns, count, more, took_ms, cut}
//     await adapter.aggregate({collection: 'orders', pipeline: 'SELECT status, COUNT(*) FROM orders GROUP BY status', skip: 0, limit: 50})
//                                   // {items, columns, count: null, more, took_ms, cut}
//     await adapter.document({collection: 'orders', id: {id: 7}})                   // {item, columns, key, filled}
//     await adapter.insert({collection: 'orders', document: '{"customer": "ann"}'})   // {id: {id: 41}, item, saved}
//     await adapter.replace({collection: 'orders', id: {id: 7}, document: '{…}', was: '{…}'})
//                                   // {id, item, saved}; 409 when another hand changed what it changes
//     await adapter.remove({collection: 'orders', id: {id: 7}})                     // {id, item, saved: []}
function mysql_adapter(run)
{
    return {
        engine: 'mysql',
        collections: async function () {
            const lines = [
                'SET SESSION information_schema_stats_expiry = 0;',
                'SET SESSION group_concat_max_len = 16777216;',
            ].concat(HEAD, rows_lines('serviceman_tables', TABLES), rows_lines('serviceman_keys', `${KEYS}\n${KEYS_ORDER}`), COUNTS, [
                `SET SESSION max_execution_time = ${COUNT_MS};`,
                'SET @serviceman_sql = IF((@serviceman_types = 1) OR (@serviceman_counts IS NULL), \'DO 0\', @serviceman_counts);',
                'PREPARE serviceman_counts FROM @serviceman_sql;',
                'EXECUTE serviceman_counts;',
                'ROLLBACK;',
                '',
            ]);
            return tables_read(await printed_read(run, lines.join('\n'), ''));
        },
        documents: async function (ask) {
            const target = name_quoted(ask.collection);
            const fields = sql_part_from_text(ask.fields, '');
            const filter = sql_part_from_text(ask.filter, 'WHERE');
            const sort = sql_part_from_text(ask.sort, 'ORDER BY');
            const where = (filter === '') ? '' : ` WHERE (\n${filter}\n)`;
            const built = sql_statement_built(['SELECT '].concat(
                (fields === '') ? ['*'] : ['\n', {word: 'columns', text: fields}, '\n'],
                [` FROM ${target}`],
                (filter === '') ? [] : [' WHERE (\n', {word: 'condition', text: filter}, '\n)'],
                (sort === '') ? [] : [' ORDER BY\n', {word: 'ORDER BY', text: sort}, '\n'],
            ));
            const lines = page_lines(built.statement, ask).concat([`SET SESSION max_execution_time = ${COUNT_MS};`], rows_lines('serviceman_count', `SELECT COUNT(*) AS n FROM ${target}${where}`), ['ROLLBACK;', '']);
            return page_read(await printed_read(run, lines.join('\n'), '', layout_of(built, ask)), ask.limit);
        },
        aggregate: async function (ask) {
            const query = sql_part_from_text(ask.pipeline, '');
            const built = sql_statement_built(['(\n', (query === '') ? `SELECT * FROM ${name_quoted(ask.collection)}` : {word: 'query', text: query}, '\n)']);
            const lines = page_lines(built.statement, ask).concat(['ROLLBACK;', '']);
            const found = page_read(await printed_read(run, lines.join('\n'), query, layout_of(built, ask)), ask.limit);
            return {items: found.items, columns: found.columns, count: null, more: found.more, took_ms: found.took_ms, cut: found.cut};
        },
        document: async function (ask) {
            const table = table_known_of(await table_read(run, ask.collection));
            const columns = table.columns.map(v => v.name);
            const filled = table.columns.filter(v => (v.default !== null) || /auto_increment|GENERATED/i.test(v.extra)).map(v => v.name);
            if ((ask.id === undefined) || (ask.id === null)) {
                return {item: null, columns, key: table.key, filled};
            }
            const change = sql_change_from_ask({collection: ask.collection, id: ask.id});
            const where = where_of(changed_table_of(table, change), change.id);
            const target = name_quoted(ask.collection);
            const lines = HEAD.concat(prepared_lines('serviceman_row', `IF(@serviceman_types = 1, ${hex_text(`SELECT * FROM ${target} LIMIT 0`)}, ${hex_text(`SELECT * FROM ${target} WHERE ${where}`)})`), ['ROLLBACK;', '']);
            return {item: row_read(await printed_read(run, lines.join('\n'), '')), columns, key: table.key, filled};
        },
        insert: async function (ask) {
            const change = sql_change_from_ask(ask);
            const table = changed_table_of(await table_read(run, ask.collection), change);
            const target = name_quoted(ask.collection);
            const names = Object.keys(change.set);
            const values = names.map(v => value_sql_of(table.column_by_name[v], change.set[v]));
            const insert = `INSERT INTO ${target} (${names.map(name_quoted).join(', ')}) VALUES (${values.join(', ')})`;
            const back = inserted_where_of(table, change.set);
            const lines = CHANGE_HEAD.concat(prepared_lines('serviceman_change', `IF(@serviceman_types = 1, 'DO 0', ${hex_text(insert)})`));
            if (back !== null) {
                lines.push(...prepared_lines('serviceman_row', `IF(@serviceman_types = 1, ${hex_text(`SELECT * FROM ${target} LIMIT 0`)}, ${hex_text(`SELECT * FROM ${target} WHERE ${back}`)})`));
            }
            const item = row_read(await change_printed_read(run, lines.concat(['COMMIT;', '']).join('\n')));
            return {id: (item === null) ? null : key_values_of(table.key, item), item, saved: names};
        },
        replace: async function (ask) {
            const change = sql_change_from_ask(ask);
            const table = changed_table_of(await table_read(run, ask.collection), change);
            const target = name_quoted(ask.collection);
            const names = Object.keys(change.set);
            const where = where_of(table, change.id);
            // The row as saved is read back by its key as set; a key column set to NULL is
            // refused by MySQL before it is read
            const id_after = Object.assign({}, change.id);
            for (const name of table.key.filter(v => Object.hasOwn(change.set, v) && (change.set[v] !== null))) {
                id_after[name] = change.set[name];
            }
            // Each column to set that the page read, compared with what it held then: those that
            // differ now, by their place among the names, '' for none, NULL for no row
            const checks = names.filter(v => (change.was !== null) && Object.hasOwn(change.was, v)).map(v => `IF(${same_sql_of(table.column_by_name[v], change.was[v])}, NULL, '${names.indexOf(v)}')`);
            const lock = `SELECT ${(checks.length === 0) ? '\'\'' : `CONCAT_WS(',', ${checks.join(', ')})`} FROM ${target} WHERE ${where} FOR UPDATE INTO @serviceman_changed`;
            const update = `UPDATE ${target} SET ${names.map(v => `${name_quoted(v)} = ${value_sql_of(table.column_by_name[v], change.set[v])}`).join(', ')} WHERE ${where}`;
            const read_back = `IF(@serviceman_changed = '', ${hex_text(`SELECT * FROM ${target} WHERE ${where_of(table, id_after)}`)}, ${hex_text(`SELECT * FROM ${target} WHERE ${where}`)})`;
            const lines = CHANGE_HEAD.concat(
                ['SET @serviceman_changed = NULL;'],
                prepared_lines('serviceman_lock', `IF(@serviceman_types = 1, 'DO 0', ${hex_text(lock)})`),
                (names.length === 0) ? [] : prepared_lines('serviceman_change', `IF((@serviceman_types = 1) OR (@serviceman_changed IS NULL) OR (@serviceman_changed <> ''), 'DO 0', ${hex_text(update)})`),
                prepared_lines('serviceman_row', `IF(@serviceman_types = 1, ${hex_text(`SELECT * FROM ${target} LIMIT 0`)}, ${read_back})`),
                rows_lines('serviceman_state', 'SELECT @serviceman_changed AS changed'),
                ['COMMIT;', ''],
            );
            const printed = await change_printed_read(run, lines.join('\n'));
            const state = state_read(printed);
            const item = row_read(printed);
            if ((state === null) || (item === null)) {
                throw Object.assign(new Error('it is not there any more: deleted, or its key changed, since it was read'), {status: 400});
            }
            if (state !== '') {
                const changed = state.split(',').map(v => names[Number(v)]);
                throw Object.assign(new Error(changed_said_of(changed, item)), {status: 409, changed, item});
            }
            return {id: key_values_of(table.key, item), item, saved: names};
        },
        remove: async function (ask) {
            const change = sql_change_from_ask({collection: ask.collection, id: ask.id});
            const table = changed_table_of(await table_read(run, ask.collection), change);
            const target = name_quoted(ask.collection);
            const where = where_of(table, change.id);
            const lines = CHANGE_HEAD.concat(
                ['SET @serviceman_found = NULL;'],
                prepared_lines('serviceman_lock', `IF(@serviceman_types = 1, 'DO 0', ${hex_text(`SELECT COUNT(*) FROM ${target} WHERE ${where} FOR UPDATE INTO @serviceman_found`)})`),
                prepared_lines('serviceman_row', `IF(@serviceman_types = 1, ${hex_text(`SELECT * FROM ${target} LIMIT 0`)}, ${hex_text(`SELECT * FROM ${target} WHERE ${where}`)})`),
                prepared_lines('serviceman_change', `IF((@serviceman_types = 1) OR (@serviceman_found <> 1), 'DO 0', ${hex_text(`DELETE FROM ${target} WHERE ${where}`)})`),
                rows_lines('serviceman_state', 'SELECT @serviceman_found AS found'),
                ['COMMIT;', ''],
            );
            const printed = await change_printed_read(run, lines.join('\n'));
            const item = row_read(printed);
            if ((state_read(printed) !== '1') || (item === null)) {
                throw Object.assign(new Error('it is not there any more: deleted, or its key changed, since it was read'), {status: 400});
            }
            return {id: key_values_of(table.key, item), item, saved: []};
        },
    };
}

// What a page's client runs, as page_lines writes it, and where the parts typed stand in it: for
// a syntax error in it, said of the part typed (syntax_said_of)
function layout_of(built, ask)
{
    return {texts: [`${built.statement} LIMIT 0`, `${built.statement} LIMIT ${ask.skip}, ${ask.limit + 1}`], parts: built.parts};
}

// The page's statement: under LIMIT 0 in the client's first run, for its column types, and one
// past the page from `skip` in the second, for its rows; then how long it took
function page_lines(statement, ask)
{
    return HEAD.concat([
        `SET @serviceman_sql = IF(@serviceman_types = 1, ${hex_text(`${statement} LIMIT 0`)}, ${hex_text(`${statement} LIMIT ${ask.skip}, ${ask.limit + 1}`)});`,
        'PREPARE serviceman_page FROM @serviceman_sql;',
        'SET @serviceman_time0 = NOW(6);',
        'EXECUTE serviceman_page;',
        'SET @serviceman_sql = IF(@serviceman_types = 1, \'DO 0\', \'SELECT TIMESTAMPDIFF(MICROSECOND, @serviceman_time0, NOW(6)) DIV 1000 AS took_ms\');',
        'PREPARE serviceman_took FROM @serviceman_sql;',
        'EXECUTE serviceman_took;',
    ]);
}

// A statement run in the client's second run alone, its rows printed as XML
function rows_lines(name, sql)
{
    return [
        `SET @serviceman_sql = IF(@serviceman_types = 1, 'DO 0', ${hex_text(sql)});`,
        `PREPARE ${name} FROM @serviceman_sql;`,
        `EXECUTE ${name};`,
    ];
}

// A statement prepared from what `choice` gives, an expression of the script's variables, and
// run: the statement whole in the client's second run, 'DO 0' or the statement under LIMIT 0 for
// its column types in its first
function prepared_lines(name, choice)
{
    return [
        `SET @serviceman_sql = ${choice};`,
        `PREPARE ${name} FROM @serviceman_sql;`,
        `EXECUTE ${name};`,
    ];
}

// Text as MySQL reads it from hex: no client or server reads anything in it as SQL
function hex_text(text)
{
    return `CONVERT(X'${Buffer.from(text, 'utf8').toString('hex')}' USING utf8mb4)`;
}

// A value for a statement, as a hex literal of utf8mb4 text: data alone, which MySQL converts
// to its column's charset, and whose collation gives way to the column's, so a key's index serves
function text_literal(text)
{
    return `_utf8mb4 X'${Buffer.from(text, 'utf8').toString('hex')}'`;
}

// A name as MySQL quotes it
function name_quoted(name)
{
    return `\`${String(name).replace(/`/g, '``')}\``;
}

// What the client printed. One that ended with an error throws what MySQL refused (400), unless
// the page was printed before it: then what failed was the count, past its limit, and the page
// is answered without it. An error of the client itself did not reach the database (502).
// `query` is what was typed into the query box, '' for none; `layout` where the parts typed stand
// in a page's statement (layout_of), for a syntax error in them.
async function printed_read(run, script, query, layout)
{
    try {
        return await run(script);
    }
    catch (error) {
        const printed = (typeof error.stdout === 'string') ? error.stdout : '';
        if (printed.includes('statement="EXECUTE serviceman_took"') || printed.includes('statement="EXECUTE serviceman_tables"')) {
            return printed;
        }
        const said = /ERROR (\d+) \(\w+\)(?: at line \d+)?: ([\s\S]*)/.exec(error.message);
        if ((said === null) || ((Number(said[1]) >= CLIENT_ERRORS.least) && (Number(said[1]) <= CLIENT_ERRORS.most))) {
            throw error;
        }
        const words = ((Number(said[1]) === SYNTAX_ERROR) && (layout !== undefined)) ? syntax_said_of(said[2].trim(), layout) : said[2].trim();
        throw Object.assign(new Error(said_of(Number(said[1]), words.replace(/\s+/g, ' '), query)), {status: 400});
    }
}

// MySQL's words for a syntax error, said of the part typed it is in or after, never quoting the
// statement around it. MySQL quotes the statement from where it stopped, and says its line: that
// place found in what the client ran, one past a part's end is at the end of the condition (or
// the ORDER BY, the columns, the query), and one in it quotes the part alone, its line counted
// from the part's first; a place not found leaves MySQL's words as they are.
//
//     syntax_said_of("…to use near ') LIMIT 0' at line 3", layout)   // '…to use at the end of the condition'
function syntax_said_of(said, layout)
{
    const near = RE_NEAR.exec(said);
    if (near === null) {
        return said;
    }
    for (const text of layout.texts) {
        const at = quoted_at(text, near[1], Number(near[2]));
        if (at === null) {
            continue;
        }
        const part = sql_part_at(layout.parts, at);
        if (part === null) {
            return said;
        }
        if (part.past) {
            return `${said.slice(0, near.index)}at the end of the ${part.word}`;
        }
        const rest = text.slice(at, part.to);
        const quote = ((near[1].length > as_said(rest).length) && near[1].startsWith(as_said(rest))) ? rest : near[1];
        return `${said.slice(0, near.index)}near '${quote}' at line ${line_of(text, at) - line_of(text, part.from) + 1}`;
    }
    return said;
}

// Where in `text` MySQL's quote of it begins, on the line it says: the place the rest of the text
// is the quote, else the first the quote begins at (one cut at 80 characters); null for none.
// The quote is the text as MySQL says it (as_said).
function quoted_at(text, quote, line)
{
    const said = as_said(text);
    // Where each character of the text as said begins in the text
    const places = [];
    for (let at = 0; at < text.length; at += (text.codePointAt(at) > 0xffff) ? 2 : 1) {
        places.push(at);
    }
    places.push(text.length);
    let first = null;
    // An empty quote is found at every place, the end too: past it, none
    for (let at = said.indexOf(quote); at >= 0; at = (at < said.length) ? said.indexOf(quote, at + 1) : -1) {
        if (line_of(text, places[at]) !== line) {
            continue;
        }
        if (said.length - at === quote.length) {
            return places[at];
        }
        first = (first === null) ? places[at] : first;
    }
    return first;
}

// Text as MySQL's words quote it: a character past the first 65536 (an emoji), which they cannot
// hold, said as ?
function as_said(text)
{
    return Array.from(text, v => ((v.codePointAt(0) > 0xffff) ? '?' : v)).join('');
}

// The line of `text` a place of it is on, from 1
function line_of(text, at)
{
    return text.slice(0, at).split('\n').length;
}

// What MySQL said, in words for the page
function said_of(code, said, query)
{
    if (code === 3024) {
        return `it took longer than ${FIND_MS/1000} s, and MySQL stopped it: an index on what it filters or sorts by makes it quick`;
    }
    if (code === 1792) {
        return `it writes, and what is typed here is only read, a row being changed by its own buttons: ${said}`;
    }
    // A DELETE or a DROP typed into the query box is no query the page can be read from
    if ((code === 1064) && (query !== '') && (/^[(\s]*(SELECT|WITH|TABLE|VALUES)\b/i.test(query) === false)) {
        return `only what one SELECT gives is read here, a row being changed by its own buttons: ${said}`;
    }
    return said;
}

// What a change's script printed. One that ended with an error throws what MySQL refused, in
// its words (400): the client stops at the error, and the transaction it ends with is rolled
// back; a lock waited for past LOCK_S is said so (409). An error of the client itself did not
// reach the database (502).
async function change_printed_read(run, script)
{
    try {
        return await run(script);
    }
    catch (error) {
        const said = /ERROR (\d+) \(\w+\)(?: at line \d+)?: ([\s\S]*)/.exec(error.message);
        if ((said === null) || ((Number(said[1]) >= CLIENT_ERRORS.least) && (Number(said[1]) <= CLIENT_ERRORS.most))) {
            throw error;
        }
        if (Number(said[1]) === LOCK_WAIT_TIMEOUT) {
            throw Object.assign(new Error(`another transaction holds the row, an app's or a page's, and it was waited for ${LOCK_S} s: nothing was changed, try again in a moment`), {status: 409});
        }
        throw Object.assign(new Error(said[2].trim().replace(/\s+/g, ' ')), {status: 400});
    }
}

// One table as a change needs it: {database, type, columns, column_by_name, key}, type null
// when it is none of the database's, each column {name, type, column_type, default, extra,
// precision, scale, fsp}, type as information_schema names it
async function table_read(run, name)
{
    const literal = text_literal(name);
    const lines = HEAD.concat(
        rows_lines('serviceman_database', 'SELECT DATABASE() AS name'),
        rows_lines('serviceman_table', `SELECT TABLE_TYPE AS type FROM information_schema.TABLES WHERE (TABLE_SCHEMA = DATABASE()) AND (TABLE_NAME = ${literal})`),
        rows_lines('serviceman_columns', `${COLUMNS} AND (TABLE_NAME = ${literal}) ORDER BY ORDINAL_POSITION`),
        rows_lines('serviceman_keys', `${KEYS} AND (TABLE_NAME = ${literal})\n${KEYS_ORDER}`),
        ['ROLLBACK;', ''],
    );
    const sets = resultsets_of(await printed_read(run, lines.join('\n'), ''));
    const columns = [];
    const column_by_name = {};
    for (const row of sets.serviceman_columns || []) {
        const [column_name, type, column_type, value, extra, precision, scale, fsp] = row.map(v => v.text);
        const column = {name: column_name, type, column_type, default: value, extra, precision: number_or_null(precision), scale: number_or_null(scale), fsp: number_or_null(fsp)};
        columns.push(column);
        column_by_name[column_name] = column;
    }
    const tables = sets.serviceman_table || [];
    return {
        database: (sets.serviceman_database === undefined) ? '' : sets.serviceman_database[0][0].text,
        name,
        type: (tables.length === 0) ? null : tables[0][0].text,
        columns,
        column_by_name,
        key: key_of(sets.serviceman_keys || []),
    };
}

// The table asked of, as described: one of the database's
function table_known_of(table)
{
    if (table.type === null) {
        throw Object.assign(new Error(`no table called ${table.name} in ${table.database}`), {status: 400});
    }
    return table;
}

// The table a change is asked of, as described: one of the database's, a table and not a view,
// with a key a row is named by, and the columns to set each one of its own
function changed_table_of(table, change)
{
    table_known_of(table);
    if (table.type !== 'BASE TABLE') {
        throw Object.assign(new Error(`${table.name} is a view: its rows are changed in the tables it reads`), {status: 405});
    }
    if (table.key === null) {
        throw Object.assign(new Error(`${table.name} has no primary key, nor a unique key of NOT NULL columns, to name one row by: its rows are read alone`), {status: 405});
    }
    const unknown = Object.keys((change.set === null) ? {} : change.set).find(v => table.column_by_name[v] === undefined);
    if (unknown !== undefined) {
        throw Object.assign(new Error(`no column \`${unknown}\` in ${table.name}`), {status: 400});
    }
    return table;
}

// The condition a row is found by: each column of its key equal to its value as the page read
// it, read by its column's type
function where_of(table, id)
{
    const asked = Object.keys(id).sort();
    const key = table.key.slice().sort();
    if ((asked.join('\n') !== key.join('\n')) || table.key.some(v => (id[v] === null) || (id[v] === undefined))) {
        throw Object.assign(new Error(`a row of ${table.name} is named by its key: ${table.key.join(', ')}`), {status: 400});
    }
    return table.key.map(v => `${name_quoted(v)} = ${match_sql_of(table.column_by_name[v], id[v])}`).join(' AND ');
}

// The condition a row just added is read back by: each column of its key as given, else the
// AUTO_INCREMENT MySQL gave it, else its default when that is a value; null when one of them is
// known to none of these (a default MySQL works out, UUID()), and the row is not read back
function inserted_where_of(table, set)
{
    const matches = [];
    for (const name of table.key) {
        const column = table.column_by_name[name];
        if (Object.hasOwn(set, name) && (set[name] !== null)) {
            matches.push(`${name_quoted(name)} = ${match_sql_of(column, set[name])}`);
        }
        else if (/auto_increment/i.test(column.extra)) {
            matches.push(`${name_quoted(name)} = LAST_INSERT_ID()`);
        }
        else if ((column.default !== null) && (/DEFAULT_GENERATED/i.test(column.extra) === false)) {
            matches.push(`${name_quoted(name)} = ${match_sql_of(column, column.default)}`);
        }
        else {
            return null;
        }
    }
    return matches.join(' AND ');
}

// A value to store in a column, as MySQL is given it: NULL; binary data as the bytes of its hex
// (0x…); bits as their number; JSON as its text; any other as its text, which MySQL reads by the
// column's type, refusing what it does not take (the session is strict)
function value_sql_of(column, value)
{
    if (value === null) {
        return 'NULL';
    }
    if (COLUMN_BINARIES.includes(column.type)) {
        return bytes_sql_of(column, value);
    }
    if (column.type === 'bit') {
        return `CAST(${text_literal(number_text_of(column, value, RE_WHOLE))} AS UNSIGNED)`;
    }
    return text_literal((column.type === 'json') ? json_from_ejson(value) : text_of(value));
}

// A value to compare a column with, of the column's own type: a number cast to it from its
// digits, kept whole, a date or a time to its kind, JSON to JSON, binary data as its bytes, text
// as it is; a number that is none is refused, never cast to 0
function match_sql_of(column, value)
{
    if (COLUMN_BINARIES.includes(column.type)) {
        return bytes_sql_of(column, value);
    }
    if (COLUMN_INTEGERS.includes(column.type) || (column.type === 'bit')) {
        const unsigned = (column.type === 'bit') || / unsigned\b/i.test(column.column_type);
        return `CAST(${text_literal(number_text_of(column, value, RE_WHOLE))} AS ${unsigned ? 'UNSIGNED' : 'SIGNED'})`;
    }
    if (column.type === 'decimal') {
        return `CAST(${text_literal(number_text_of(column, value, RE_DECIMAL))} AS DECIMAL(${column.precision}, ${column.scale}))`;
    }
    if (['float', 'double'].includes(column.type)) {
        return `CAST(${text_literal(number_text_of(column, value, RE_FLOAT))} AS ${COLUMN_CASTS[column.type]})`;
    }
    if (column.type === 'date') {
        return `CAST(${text_literal(text_of(value))} AS DATE)`;
    }
    if (['datetime', 'timestamp'].includes(column.type)) {
        return `CAST(${text_literal(text_of(value))} AS DATETIME(${column.fsp || 0}))`;
    }
    if (column.type === 'time') {
        return `CAST(${text_literal(text_of(value))} AS TIME(${column.fsp || 0}))`;
    }
    if (column.type === 'json') {
        return `CAST(${text_literal(json_from_ejson(value))} AS JSON)`;
    }
    return text_literal(text_of(value));
}

// Whether a column holds what the page read from it: text compared byte by byte, case, accents
// and trailing spaces all, whatever the column's own collation; any other value by its type
function same_sql_of(column, value)
{
    const quoted = name_quoted(column.name);
    if (value === null) {
        return `(${quoted} IS NULL)`;
    }
    if (COLUMN_TEXTS.includes(column.type)) {
        return `(CONVERT(${quoted} USING utf8mb4) COLLATE utf8mb4_0900_bin <=> ${text_literal(text_of(value))} COLLATE utf8mb4_0900_bin)`;
    }
    return `(${quoted} <=> ${match_sql_of(column, value)})`;
}

// Binary data as MySQL is given it: written as the page reads it, 0x and its hex, its bytes;
// any other text, its own bytes
function bytes_sql_of(column, value)
{
    const text = text_of(value);
    if (/^0x/i.test(text) && (RE_HEX.test(text) === false)) {
        throw Object.assign(new Error(`${column.name} is binary data, written 0x and two hex digits a byte: 0x00ff`), {status: 400});
    }
    return `X'${RE_HEX.test(text) ? text.slice(2) : Buffer.from(text, 'utf8').toString('hex')}'`;
}

// A number's text, refused when it is none of the kind its column holds
function number_text_of(column, value, re)
{
    const text = text_of(value);
    if (re.test(text) === false) {
        throw Object.assign(new Error(`${column.name} is a number column (${column.column_type}): ${JSON.stringify(text)} is none it holds`), {status: 400});
    }
    return text;
}

// A value as text for MySQL to read by its column's type: a number by its digits, true and false
// as 1 and 0 (MySQL's BOOLEAN is a number), an object or a list as its JSON
function text_of(value)
{
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    return json_from_ejson(value);
}

// The key of a row, each of its columns with its value as read
function key_values_of(key, item)
{
    const out = {};
    for (const name of key) {
        out[name] = item[name];
    }
    return out;
}

// The one row a script printed as serviceman_row, read by its column types as a page's are;
// null for none
function row_read(printed)
{
    const at = printed.search(RE_XML_HEAD);
    const types = types_of((at < 0) ? printed : printed.slice(0, at));
    const sets = resultsets_of((at < 0) ? '' : printed.slice(at));
    if ((sets.serviceman_row === undefined) || (sets.serviceman_row.length === 0)) {
        return null;
    }
    const row = sets.serviceman_row[0];
    return items_from_rows(row.map(v => v.name), [row.map((v, i) => value_from_text(v.text, types[i]))]).items[0];
}

// What a change's script printed as serviceman_state, its one value; null for NULL or none
function state_read(printed)
{
    const sets = resultsets_of(printed.slice(Math.max(0, printed.search(RE_XML_HEAD))));
    if ((sets.serviceman_state === undefined) || (sets.serviceman_state.length === 0)) {
        return null;
    }
    return sets.serviceman_state[0][0].text;
}

// The tables as the page lists them, by name; a count where it was made, else MySQL's estimate;
// the key a row of each is named by, null for a view or a table with none
function tables_read(printed)
{
    const sets = resultsets_of(printed);
    const tables = (sets.serviceman_tables === undefined) ? [] : sets.serviceman_tables;
    const count_by_name = {};
    for (const row of (sets.serviceman_counts === undefined) ? [] : sets.serviceman_counts) {
        count_by_name[row[0].text] = Number(row[1].text);
    }
    const key_rows_by_name = {};
    for (const row of (sets.serviceman_keys === undefined) ? [] : sets.serviceman_keys) {
        if (key_rows_by_name[row[0].text] === undefined) {
            key_rows_by_name[row[0].text] = [];
        }
        key_rows_by_name[row[0].text].push(row);
    }
    const out = [];
    for (const row of tables) {
        const [name, type, estimate, bytes, index_bytes, indexes] = row.map(v => v.text);
        const view = (type === 'VIEW');
        const counted = (count_by_name[name] === undefined) ? null : count_by_name[name];
        const item = {name, type: view ? 'view' : 'table', count: null, estimated: false, bytes: null, storage_bytes: null, index_bytes: null, indexes: null, key: null};
        if (view === false) {
            item.key = key_of(key_rows_by_name[name] || []);
            item.count = (counted === null) ? number_or_null(estimate) : counted;
            item.estimated = (counted === null) && (item.count !== null);
            item.bytes = number_or_null(bytes);
            item.index_bytes = number_or_null(index_bytes);
            item.storage_bytes = ((item.bytes === null) || (item.index_bytes === null)) ? null : (item.bytes + item.index_bytes);
            item.indexes = number_or_null(indexes);
        }
        out.push(item);
    }
    out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || ((a.name < b.name) ? -1 : 1));
    return out;
}

function number_or_null(text)
{
    return (text === null) ? null : Number(text);
}

// The columns a row of a table is named by, from its unique keys as information_schema has them,
// each row [table, key, column, nullable, part], the primary key first: that key, else the first
// unique key, by name, whose columns are all NOT NULL, whole and no expression, which names one
// row as a primary key does; null for none. A unique key of a column that may be NULL does not:
// NULL is no value two rows are kept apart by.
function key_of(rows)
{
    const columns_by_key = new Map();
    for (const row of rows) {
        const [, key, column, nullable, part] = row.map(v => v.text);
        const columns = columns_by_key.has(key) ? columns_by_key.get(key) : [];
        columns.push({column, whole: (column !== null) && (nullable === '') && (part === null)});
        columns_by_key.set(key, columns);
    }
    for (const columns of columns_by_key.values()) {
        if (columns.every(v => v.whole)) {
            return columns.map(v => v.column);
        }
    }
    return null;
}

// A page as the browser answers it: its rows as objects keyed by column, each value read by its
// column's type, one past the page saying whether a next page is there; the rest of a page past
// PAGE_BYTES left for the next
function page_read(printed, limit)
{
    const at = printed.search(RE_XML_HEAD);
    const types = types_of((at < 0) ? printed : printed.slice(0, at));
    const sets = resultsets_of((at < 0) ? '' : printed.slice(at));
    const fetched = (sets.serviceman_page === undefined) ? [] : sets.serviceman_page;
    const names = (fetched.length === 0) ? [] : fetched[0].map(v => v.name);
    const rows = [];
    let bytes = 0;
    let cut = false;
    for (const row of fetched.slice(0, limit)) {
        const values = row.map((v, i) => value_from_text(v.text, types[i]));
        bytes += JSON.stringify(values).length;
        if ((bytes > PAGE_BYTES) && (rows.length > 0)) {
            cut = true;
            break;
        }
        rows.push(values);
    }
    const page = items_from_rows(names, rows);
    const took = sets.serviceman_took;
    const counted = sets.serviceman_count;
    return {
        items: page.items,
        columns: page.columns,
        count: ((counted === undefined) || (counted.length === 0)) ? null : Number(counted[0][0].text),
        more: cut || (fetched.length > limit),
        took_ms: ((took === undefined) || (took.length === 0)) ? null : Number(took[0][0].text),
        cut,
    };
}

// The column types the client printed in its first run, in order: {name}, as it names them
function types_of(text)
{
    const out = [];
    for (const block of text.split(/^Field\s+\d+:/m).slice(1)) {
        const type = /^Type:\s+(\w+)/m.exec(block);
        out.push({name: (type === null) ? '' : type[1]});
    }
    return out;
}

// A value as the client printed it, read by its column's type: a number kept whole, JSON as its
// values, bits as their number; a date, a time, binary data (0x…) and the rest as the text it
// is; NULL as null
function value_from_text(text, type)
{
    if ((text === null) || (type === undefined)) {
        return text;
    }
    if (INTEGERS.includes(type.name) || DECIMALS.includes(type.name)) {
        return ejson_number_from_text(text);
    }
    if (FLOATS.includes(type.name)) {
        return Number(text);
    }
    if ((type.name === 'BIT') && /^0x[0-9A-Fa-f]+$/.test(text)) {
        return ejson_number_from_text(BigInt(text).toString());
    }
    if (type.name === 'JSON') {
        return json_or_text(text);
    }
    return text;
}

// A JSON column's value as its values; text that is no JSON, which MySQL does not print there,
// stays the text it is rather than losing the page
function json_or_text(text)
{
    try {
        return ejson_from_json(text);
    }
    catch {
        return text;
    }
}

// The XML's result sets by the statement that printed them, `EXECUTE <name>` named <name>: each
// a list of rows, each row its fields, {name, text}, text null for NULL
function resultsets_of(xml)
{
    const out = {};
    for (const set of xml.matchAll(/<resultset statement="([^"]*)"[^>]*>([\s\S]*?)<\/resultset>/g)) {
        const name = xml_text(set[1]).replace(/^EXECUTE /, '').trim();
        const rows = [];
        for (const row of set[2].matchAll(/<row>([\s\S]*?)<\/row>/g)) {
            const fields = [];
            for (const field of row[1].matchAll(/<field name="([^"]*)"(?: xsi:nil="true" \/>|>([^<]*)<\/field>)/g)) {
                fields.push({name: xml_text(field[1]), text: (field[2] === undefined) ? null : xml_text(field[2])});
            }
            rows.push(fields);
        }
        out[name] = rows;
    }
    return out;
}

// The text of the client's XML, as it escapes it
function xml_text(text)
{
    return text.replace(/&(lt|gt|quot|amp);/g, v => ({'&lt;': '<', '&gt;': '>', '&quot;': '"', '&amp;': '&'})[v]);
}

module.exports = mysql_adapter;
