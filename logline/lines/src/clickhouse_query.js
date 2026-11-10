// One query over ClickHouse's HTTP door. The address may carry who asks —
// http://lines:@clickstack:8123 — and that is sent the way ClickHouse reads it, in its own
// headers. A refusal throws with what ClickHouse said, and with its own number for what it
// refused as `exception_code` (252), null when it gave none.
async function clickhouse_query(address, sql, body, settings)
{
    const url = new URL(address);
    const headers = {};
    if (url.username !== '') {
        headers['X-ClickHouse-User'] = decodeURIComponent(url.username);
        headers['X-ClickHouse-Key'] = decodeURIComponent(url.password);
    }
    url.username = '';
    url.password = '';
    url.searchParams.set('query', sql);
    for (const name of Object.keys(settings || {})) {
        url.searchParams.set(name, String(settings[name]));
    }
    const answer = await fetch(url, {method: 'POST', headers, body: (body === undefined) ? '' : body});
    const text = await answer.text();
    if (answer.ok === false) {
        const said = text.trim().split('\n')[0];
        // The number comes in a header of its own, and at the start of what ClickHouse says:
        // `Code: 252. DB::Exception: …`
        const found = /^Code: (\d+)\./.exec(said);
        const code = answer.headers.get('x-clickhouse-exception-code') || ((found === null) ? null : found[1]);
        throw Object.assign(new Error(`clickhouse ${answer.status}: ${said}`), {exception_code: (code === null) ? null : parseInt(code, 10)});
    }
    return text;
}

module.exports = clickhouse_query;
