const tailnet_request = require('./tailnet_request');

// The lines a service wrote in the last day, as its Logs tab shows them: read from Logline the
// way its own viewer reads them, through the viewer's /clickhouse, the read-only door its page
// uses. A service's lines carry its name as their service, or serviceman-<name> for those from
// before the agent said so; from the machines it runs on alone (logline_link says why).
//
//     logline   the config's, with the viewer's address in `ui`
//     service   {name, remotes}
//     find      what a line holds, any case; '' for every line
//     out       {lines: [{time_ms, line, stream}], total}: the last LIMIT, oldest first, and
//               how many there are in all
const LIMIT = 500;
const TIMEOUT_MS = 10000;

async function service_lines(logline, service, find)
{
    const params = new URLSearchParams({default_format: 'JSONEachRow', param_name: service.name, param_container: `serviceman-${service.name}`, param_limit: String(LIMIT)});
    const where = [
        'TimestampTime >= now() - INTERVAL 1 DAY',
        'Timestamp >= now64(9) - INTERVAL 1 DAY',
        'ServiceName IN ({name:String}, {container:String})',
    ];
    const machines = service.remotes.filter(v => v.startsWith('#') === false);
    if (machines.length > 0) {
        for (const [i, v] of machines.entries()) {
            params.set(`param_remote_${i}`, v);
        }
        where.push(`ResourceAttributes['remote'] IN (${machines.map((v, i) => `{remote_${i}:String}`).join(', ')})`);
    }
    if (find !== '') {
        params.set('param_find', find);
        where.push('positionCaseInsensitive(Body, {find:String}) > 0');
    }
    const [rows, counted] = await Promise.all([clickhouse(logline, params, `
        SELECT
            toUnixTimestamp64Milli(Timestamp) AS time_ms,
            Body AS line,
            LogAttributes['log.iostream'] AS stream
        FROM
            default.otel_logs
        WHERE
            ${where.join(' AND ')}
        ORDER BY
            Timestamp DESC
        LIMIT
            {limit:UInt32}
    `), clickhouse(logline, params, `
        SELECT
            count() AS total
        FROM
            default.otel_logs
        WHERE
            ${where.join(' AND ')}
    `)]);
    const lines = rows.map(v => ({time_ms: Number(v.time_ms), line: v.line, stream: v.stream})).reverse();
    return {lines, total: (counted.length === 0) ? lines.length : Number(counted[0].total)};
}

// The rows a query answers, JSONEachRow; an error says what Logline said, or that it did not.
// It goes through tailscale's proxy where TAILNET_PROXY names one, as logline_admin_call does:
// in serviceman's image, the only way out to the tailnet. A wall in front of the viewer lets
// the page's visitor through, not serviceman: its answer, a way to a sign-in, is said so.
async function clickhouse(logline, params, sql)
{
    const url = new URL('/clickhouse', logline.ui);
    url.search = params.toString();
    let answer;
    try {
        answer = await tailnet_request(url, {method: 'POST', headers: {'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(sql)}, body: sql, timeout_ms: TIMEOUT_MS, proxy: process.env.TAILNET_PROXY});
    }
    catch (error) {
        throw new Error(`Logline does not answer at ${url.origin}: ${error.message}`);
    }
    if ((answer.status >= 300) && (answer.status <= 399)) {
        throw new Error(`Logline's viewer at ${url.origin} sends serviceman on elsewhere (${answer.status}), to a sign-in most likely: its lines are read past no wall`);
    }
    if ((answer.status < 200) || (answer.status > 299)) {
        throw new Error(`Logline answered ${answer.status}: ${answer.text.replace(/^Code: \d+\. DB::Exception: /, '').trim().slice(0, 300)}`);
    }
    try {
        return answer.text.split('\n').filter(v => v.trim() !== '').map(v => JSON.parse(v));
    }
    catch {
        throw new Error(`Logline's viewer at ${url.origin} answered a page, not lines: ${answer.text.trim().slice(0, 80)}`);
    }
}

module.exports = service_lines;
