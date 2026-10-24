const clickhouse_query = require('./clickhouse_query');

// A partition of a table kept by day has the day as its id: 20261024
const RE_DAY_ID = /^(\d{4})(\d{2})(\d{2})$/;
const RE_TTL = /\bTTL\s+(.+?)(?:\s+SETTINGS\s|$)/;

// What the log table keeps, day by day: each day's lines, their size on disk and before
// compression, oldest first, read from the sizes ClickHouse keeps of its parts and never from
// the lines. today is ClickHouse's own, the day its next lines go to; ttl what the table says
// of deleting lines by itself, null where it says nothing. A table not kept by day has its
// parts under undated.
//
//     {today, ttl, days: [{day, rows, bytes, raw}], undated: {rows, bytes, raw}}
async function log_days(clickhouse, table)
{
    const [database, name] = table_split(table);
    const params = {param_database: database, param_table: name};
    const [parts, about] = await Promise.all([
        rows_of(clickhouse, `
            SELECT
                partition_id AS id,
                sum(rows) AS rows,
                sum(bytes_on_disk) AS bytes,
                sum(data_uncompressed_bytes) AS raw
            FROM
                system.parts
            WHERE
                active
                AND database = {database:String}
                AND table = {table:String}
            GROUP BY
                partition_id
            ORDER BY
                partition_id
            FORMAT
                JSONEachRow
        `, params),
        rows_of(clickhouse, `
            SELECT
                toString(today()) AS today,
                (
                    SELECT
                        any(engine_full)
                    FROM
                        system.tables
                    WHERE
                        database = {database:String}
                        AND name = {table:String}
                ) AS engine
            FORMAT
                JSONEachRow
        `, params),
    ]);
    const ttl = RE_TTL.exec(about[0].engine || '');
    const out = {today: about[0].today, ttl: (ttl === null) ? null : ttl[1], days: [], undated: {rows: 0, bytes: 0, raw: 0}};
    for (const part of parts) {
        const day = day_of(part.id);
        const sizes = {rows: Number(part.rows), bytes: Number(part.bytes), raw: Number(part.raw)};
        if (day === null) {
            out.undated = {rows: out.undated.rows + sizes.rows, bytes: out.undated.bytes + sizes.bytes, raw: out.undated.raw + sizes.raw};
            continue;
        }
        out.days.push(Object.assign({day}, sizes));
    }
    return out;
}

// Every day before this one dropped whole, oldest first: a day goes at once and its space with
// it, with no rewrite of the rest. Today is never before itself, so the day lines go to now is
// never dropped. A drop that fails stops the rest, and says how many went before it.
//
//     before  '2026-10-17'
//     {before, dropped: [{day, rows, bytes}], rows, bytes}
async function log_days_forget(clickhouse, table, before)
{
    if ((typeof before !== 'string') || (day_real(before) === false)) {
        throw Object.assign(new Error('before: a day, 2026-10-17'), {status: 400});
    }
    const kept = await log_days(clickhouse, table);
    if (before > kept.today) {
        throw Object.assign(new Error(`before: ${before} is after today, ${kept.today}: today's lines are never dropped`), {status: 400});
    }
    const out = {before, dropped: [], rows: 0, bytes: 0};
    for (const item of kept.days.filter(v => v.day < before)) {
        try {
            await clickhouse_query(clickhouse, `ALTER TABLE ${table} DROP PARTITION ID '${item.day.replace(/-/g, '')}'`);
        }
        catch (error) {
            throw new Error(`${out.dropped.length} of ${kept.days.filter(v => v.day < before).length} days dropped, then ${item.day}: ${error.message}`);
        }
        out.dropped.push({day: item.day, rows: item.rows, bytes: item.bytes});
        out.rows += item.rows;
        out.bytes += item.bytes;
    }
    return out;
}

// 20261024 -> 2026-10-24; null for an id that is no day
function day_of(id)
{
    const found = RE_DAY_ID.exec(String(id));
    return (found === null) ? null : `${found[1]}-${found[2]}-${found[3]}`;
}

// 2026-10-17 is one, 2026-02-30 and 17.10.2026 are not
function day_real(text)
{
    const time = new Date(`${text}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && (Number.isNaN(time.getTime()) === false) && (time.toISOString().slice(0, 10) === text);
}

// default.otel_logs -> [default, otel_logs]; a table with no database is in default
function table_split(table)
{
    const at = table.indexOf('.');
    return (at === -1) ? ['default', table] : [table.slice(0, at), table.slice(at + 1)];
}

async function rows_of(clickhouse, sql, settings)
{
    const text = (await clickhouse_query(clickhouse, sql, undefined, settings)).trim();
    return (text === '') ? [] : text.split('\n').map(v => JSON.parse(v));
}

log_days.forget = log_days_forget;

module.exports = log_days;
