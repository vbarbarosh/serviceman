// One query over ClickHouse's HTTP door. The address may carry who asks —
// http://lines:@clickstack:8123 — and that is sent the way ClickHouse reads it, in its own
// headers. A refusal throws with what ClickHouse said.
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
    const answer = await fetch(url, {method: 'POST', headers, body: ((body === undefined) ? '' : body)});
    const text = await answer.text();
    if (answer.ok === false) {
        throw new Error(`clickhouse ${answer.status}: ${text.trim().split('\n')[0]}`);
    }
    return text;
}

module.exports = clickhouse_query;
