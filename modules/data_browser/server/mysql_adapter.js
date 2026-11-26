const ejson_from_json = require('./ejson_from_json');
const ejson_number_from_text = require('./ejson_number_from_text');
const items_from_rows = require('./items_from_rows');
const sql_part_from_text = require('./sql_part_from_text');

// How long a page of rows may take to be found, and to be counted, before MySQL stops it
const FIND_MS = 20000;
const COUNT_MS = 5000;
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
// Every script is one READ ONLY transaction, and the session's too
const HEAD = [
    'SET SESSION TRANSACTION READ ONLY;',
    'START TRANSACTION READ ONLY;',
    `SET SESSION max_execution_time = ${FIND_MS};`,
];

// The database's tables and views, each with its rows, its size and its indexes as MySQL keeps
// them; then the rows of each table small enough, counted, within a limit of their own
const TABLES = [
    'SELECT t.TABLE_NAME AS name, t.TABLE_TYPE AS type, t.TABLE_ROWS AS estimate, t.DATA_LENGTH AS bytes, t.INDEX_LENGTH AS index_bytes,',
    '    (SELECT COUNT(DISTINCT s.INDEX_NAME) FROM information_schema.STATISTICS AS s WHERE (s.TABLE_SCHEMA = t.TABLE_SCHEMA) AND (s.TABLE_NAME = t.TABLE_NAME)) AS indexes',
    'FROM information_schema.TABLES AS t WHERE t.TABLE_SCHEMA = DATABASE()',
].join('\n');
const COUNTS = [
    'SELECT GROUP_CONCAT(CONCAT(\'SELECT \', QUOTE(TABLE_NAME), \' AS name, COUNT(*) AS n FROM `\', REPLACE(TABLE_NAME, \'`\', \'``\'), \'`\') SEPARATOR \' UNION ALL \') INTO @serviceman_counts',
    `FROM information_schema.TABLES WHERE (TABLE_SCHEMA = DATABASE()) AND (TABLE_TYPE = 'BASE TABLE') AND (DATA_LENGTH <= ${COUNT_BYTES});`,
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
//     adapter = mysql_adapter(v => database_script(connect, server, 'shop', v))
//     await adapter.collections()   // [{name, type, count, estimated, bytes, storage_bytes, index_bytes, indexes}]
//     await adapter.documents({collection: 'orders', filter: "status = 'paid'", sort: 'placed DESC', fields: 'id, total', skip: 0, limit: 50})
//                                   // {items, columns, count, more, took_ms, cut}
//     await adapter.aggregate({collection: 'orders', pipeline: 'SELECT status, COUNT(*) FROM orders GROUP BY status', skip: 0, limit: 50})
//                                   // {items, columns, count: null, more, took_ms, cut}
function mysql_adapter(run)
{
    return {
        engine: 'mysql',
        collections: async function () {
            const lines = [
                'SET SESSION information_schema_stats_expiry = 0;',
                'SET SESSION group_concat_max_len = 16777216;',
            ].concat(HEAD, rows_lines('serviceman_tables', TABLES), COUNTS, [
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
            const order = (sort === '') ? '' : ` ORDER BY\n${sort}\n`;
            const statement = `SELECT ${(fields === '') ? '*' : `\n${fields}\n`} FROM ${target}${where}${order}`;
            const lines = page_lines(statement, ask).concat([`SET SESSION max_execution_time = ${COUNT_MS};`], rows_lines('serviceman_count', `SELECT COUNT(*) AS n FROM ${target}${where}`), ['ROLLBACK;', '']);
            return page_read(await printed_read(run, lines.join('\n'), ''), ask.limit);
        },
        aggregate: async function (ask) {
            const query = sql_part_from_text(ask.pipeline, '');
            const statement = `(\n${(query === '') ? `SELECT * FROM ${name_quoted(ask.collection)}` : query}\n)`;
            const lines = page_lines(statement, ask).concat(['ROLLBACK;', '']);
            const found = page_read(await printed_read(run, lines.join('\n'), query), ask.limit);
            return {items: found.items, columns: found.columns, count: null, more: found.more, took_ms: found.took_ms, cut: found.cut};
        },
    };
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

// Text as MySQL reads it from hex: no client or server reads anything in it as SQL
function hex_text(text)
{
    return `CONVERT(X'${Buffer.from(text, 'utf8').toString('hex')}' USING utf8mb4)`;
}

// A name as MySQL quotes it
function name_quoted(name)
{
    return `\`${String(name).replace(/`/g, '``')}\``;
}

// What the client printed. One that ended with an error throws what MySQL refused (400), unless
// the page was printed before it: then what failed was the count, past its limit, and the page
// is answered without it. An error of the client itself did not reach the database (502).
// `query` is what was typed into the query box, '' for none.
async function printed_read(run, script, query)
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
        throw Object.assign(new Error(said_of(Number(said[1]), said[2].trim().replace(/\s+/g, ' '), query)), {status: 400});
    }
}

// What MySQL said, in words for the page
function said_of(code, said, query)
{
    if (code === 3024) {
        return `it took longer than ${FIND_MS/1000} s, and MySQL stopped it: an index on what it filters or sorts by makes it quick`;
    }
    if (code === 1792) {
        return `it writes, and this page changes nothing for now: ${said}`;
    }
    // A DELETE or a DROP typed into the query box is no query the page can be read from
    if ((code === 1064) && (query !== '') && (/^[(\s]*(SELECT|WITH|TABLE|VALUES)\b/i.test(query) === false)) {
        return `only what one SELECT gives is read here, and this page changes nothing for now: ${said}`;
    }
    return said;
}

// The tables as the page lists them, by name; a count where it was made, else MySQL's estimate
function tables_read(printed)
{
    const sets = resultsets_of(printed);
    const tables = (sets.serviceman_tables === undefined) ? [] : sets.serviceman_tables;
    const count_by_name = {};
    for (const row of (sets.serviceman_counts === undefined) ? [] : sets.serviceman_counts) {
        count_by_name[row[0].text] = Number(row[1].text);
    }
    const out = [];
    for (const row of tables) {
        const [name, type, estimate, bytes, index_bytes, indexes] = row.map(v => v.text);
        const view = (type === 'VIEW');
        const counted = (count_by_name[name] === undefined) ? null : count_by_name[name];
        const item = {name, type: view ? 'view' : 'table', count: null, estimated: false, bytes: null, storage_bytes: null, index_bytes: null, indexes: null};
        if (view === false) {
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
