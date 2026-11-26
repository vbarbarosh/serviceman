const body_bytes_read = require('../body_bytes_read');
const logline_clickhouse = require('./logline_clickhouse');

// The lines a service wrote in the last day, as its Logs tab shows them: read from Logline the
// way its own viewer reads them, from ClickHouse on Logline's machine as its read-only user
// (logline_clickhouse), the way the viewer serviceman serves asks. A service's lines carry its
// name as their service, or serviceman-<name> for those from before the agent said so; from the
// machines it runs on alone (logline_link says why).
//
//     service   {name, remotes}
//     ask       {find, labels, around_ms}:
//               find        what a line holds, any case; '' for every line
//               labels      [{name, value}]: only the lines with every one of them
//               around_ms   null for the last day; a line's time for its surroundings, the
//                           lines of 2 minutes either side of it
//     out       {lines, label_sets, total}: the last LIMIT, oldest first (the LIMIT nearest the
//               time asked, for surroundings), and how many there are in all. A line is
//               {time_ms, line, stream, label_set, severity, subject, group, parent}: what
//               Logline's viewer shows of it, the last four only when it has them, its labels
//               the label set it names, an index into `label_sets`. The lines of a service
//               share a few label sets, a machine's and a stream's: each goes once, as an
//               object in the viewer's order, so a list read again every few seconds stays
//               small
const LIMIT = 500;
const TIMEOUT_MS = 10000;
// What one answer may hold: 500 lines, and their count, of any length a line may have
const ANSWER_LIMIT_BYTES = 64*1024*1024;
const AROUND_MS = 120000;
// A line's group, subject and parent: its own fields when it was sent with them, otherwise read
// from its words in the rules' form, `[group_uid][sender] details parent=<uid>`; Logline's viewer
// reads them so
const SUBJECT_EXPR = "if(empty(LogAttributes['subject']), extract(Body, '(?:^|[[:space:]])\\\\[[^\\\\]]+\\\\]\\\\[([^\\\\]]+)\\\\]'), LogAttributes['subject'])";
const GROUP_EXPR = "if(empty(LogAttributes['group_uid']), extract(Body, '(?:^|[[:space:]])\\\\[([^\\\\]]+)\\\\]\\\\[[^\\\\]]+\\\\]'), LogAttributes['group_uid'])";
const PARENT_EXPR = "if(empty(LogAttributes['parent_group_uid']), extract(Body, '(?:^|[[:space:]])parent=([^[:space:]]+)'), LogAttributes['parent_group_uid'])";
// Where a label lives in otel_logs, as Logline's lines endpoint puts it there; any other label
// is a ResourceAttributes key of its own name
const LABEL_COLUMNS = {service: 'toString(ServiceName)', stream: "LogAttributes['log.iostream']"};
const LABEL_RESOURCE_KEYS = {
    host: 'host.name',
    project: 'service.namespace',
    container: 'container.name',
    container_id: 'container.id',
    image: 'container.image.name',
};
const RESOURCE_LABEL_NAMES = Object.fromEntries(Object.entries(LABEL_RESOURCE_KEYS).map(v => [v[1], v[0]]));
// The viewer's order of a line's labels; the others follow by name
const LABEL_ORDER = ['remote', 'host', 'project', 'service', 'container', 'image', 'stream', 'container_id'];

async function service_lines(app, service, ask)
{
    const params = new URLSearchParams({default_format: 'JSONEachRow', param_name: service.name, param_container: `serviceman-${service.name}`, param_limit: String(LIMIT)});
    const where = [];
    if (ask.around_ms === null) {
        where.push('TimestampTime >= now() - INTERVAL 1 DAY', 'Timestamp >= now64(9) - INTERVAL 1 DAY');
    }
    else {
        params.set('param_around', String(ask.around_ms));
        params.set('param_from_s', String(Math.floor((ask.around_ms - AROUND_MS)/1000)));
        params.set('param_to_s', String(Math.ceil((ask.around_ms + AROUND_MS)/1000)));
        where.push(
            'TimestampTime >= toDateTime({from_s:Int64})',
            'TimestampTime <= toDateTime({to_s:Int64})',
            `abs(toUnixTimestamp64Milli(Timestamp) - {around:Int64}) <= ${AROUND_MS}`,
        );
    }
    where.push('ServiceName IN ({name:String}, {container:String})');
    const machines = service.remotes.filter(v => v.startsWith('#') === false);
    if (machines.length > 0) {
        for (const [i, v] of machines.entries()) {
            params.set(`param_remote_${i}`, v);
        }
        where.push(`ResourceAttributes['remote'] IN (${machines.map((v, i) => `{remote_${i}:String}`).join(', ')})`);
    }
    if (ask.find !== '') {
        params.set('param_find', ask.find);
        where.push('positionCaseInsensitive(Body, {find:String}) > 0');
    }
    for (const [i, label] of ask.labels.entries()) {
        params.set(`param_label_${i}`, label.value);
        where.push(`${label_expr(label.name, i, params)} = {label_${i}:String}`);
    }
    // The last day: the newest first, turned around below. Surroundings: the nearest first, put
    // in time's order below.
    const order = (ask.around_ms === null) ? 'Timestamp DESC' : 'abs(toUnixTimestamp64Milli(Timestamp) - {around:Int64}) ASC, Timestamp ASC';
    const [rows, counted] = await Promise.all([clickhouse(app, params, `
        SELECT
            toString(Timestamp) AS at,
            toUnixTimestamp64Milli(Timestamp) AS time_ms,
            Body AS line,
            LogAttributes['log.iostream'] AS stream,
            SeverityText AS severity,
            ${SUBJECT_EXPR} AS subject,
            ${GROUP_EXPR} AS group_uid,
            ${PARENT_EXPR} AS parent_group_uid,
            toString(ServiceName) AS service,
            ResourceAttributes AS resource
        FROM
            default.otel_logs
        WHERE
            ${where.join(' AND ')}
        ORDER BY
            ${order}
        LIMIT
            {limit:UInt32}
    `), clickhouse(app, params, `
        SELECT
            count() AS total
        FROM
            default.otel_logs
        WHERE
            ${where.join(' AND ')}
    `)]);
    const ordered = (ask.around_ms === null) ? rows.reverse() : rows.sort(at_compare);
    const sets = new Map();
    const lines = ordered.map(v => line_from_row(v, sets));
    return {lines, label_sets: Array.from(sets.keys()).map(v => JSON.parse(v)), total: (counted.length === 0) ? lines.length : Number(counted[0].total)};
}

// The condition of one label, as Logline's viewer writes it: its column, or its key in
// ResourceAttributes, the key a parameter too. A name is looked up among the tables' own: one
// like `constructor` is a key of its own name.
function label_expr(name, i, params)
{
    if (Object.hasOwn(LABEL_COLUMNS, name)) {
        return LABEL_COLUMNS[name];
    }
    if (Object.hasOwn(LABEL_RESOURCE_KEYS, name)) {
        return `ResourceAttributes['${LABEL_RESOURCE_KEYS[name]}']`;
    }
    params.set(`param_label_key_${i}`, name);
    return `ResourceAttributes[{label_key_${i}:String}]`;
}

// A row as ClickHouse gives it -> a line as the tab shows it. Its labels, named as the viewer
// names them, in its order, the empty ones left out, are added to `sets` (the text of each set
// -> its index) when new.
function line_from_row(row, sets)
{
    const labels = new Map([['service', row.service], ['stream', row.stream]]);
    for (const [key, value] of Object.entries(row.resource || {})) {
        labels.set(Object.hasOwn(RESOURCE_LABEL_NAMES, key) ? RESOURCE_LABEL_NAMES[key] : key, value);
    }
    const names = Array.from(labels.keys()).filter(v => labels.get(v) !== '').sort(label_compare);
    const set = JSON.stringify(Object.fromEntries(names.map(v => [v, labels.get(v)])));
    if (sets.has(set) === false) {
        sets.set(set, sets.size);
    }
    const out = {time_ms: Number(row.time_ms), line: row.line, stream: row.stream, label_set: sets.get(set)};
    for (const [name, value] of [['severity', row.severity], ['subject', row.subject], ['group', row.group_uid], ['parent', row.parent_group_uid]]) {
        if (value !== '') {
            out[name] = value;
        }
    }
    return out;
}

// Two rows by their time, to the nanosecond: toString(Timestamp) is of one width
function at_compare(a, b)
{
    return (a.at < b.at) ? -1 : ((a.at > b.at) ? 1 : 0);
}

function label_compare(a, b)
{
    const i = LABEL_ORDER.indexOf(a);
    const j = LABEL_ORDER.indexOf(b);
    if ((i !== -1) || (j !== -1)) {
        return ((i === -1) ? LABEL_ORDER.length : i) - ((j === -1) ? LABEL_ORDER.length : j);
    }
    return (a < b) ? -1 : ((a > b) ? 1 : 0);
}

// The rows a query answers, JSONEachRow; an error says what Logline said, or why it was not
// asked: its machine away, ClickHouse not answering there (logline_clickhouse)
async function clickhouse(app, params, sql)
{
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let status;
    let text;
    try {
        const answer = await logline_clickhouse(app, params, Buffer.from(sql), signal);
        status = answer.statusCode;
        text = (await body_bytes_read(answer, ANSWER_LIMIT_BYTES)).toString('utf8');
    }
    catch (error) {
        if (signal.aborted) {
            throw new Error(`Logline gave no answer within ${TIMEOUT_MS/1000}s`);
        }
        throw error;
    }
    if ((status < 200) || (status > 299)) {
        throw new Error(`Logline answered ${status}: ${text.replace(/^Code: \d+\. DB::Exception: /, '').trim().slice(0, 300)}`);
    }
    try {
        return text.split('\n').filter(v => v.trim() !== '').map(v => JSON.parse(v));
    }
    catch {
        throw new Error(`Logline answered something that is not lines: ${text.trim().slice(0, 80)}`);
    }
}

module.exports = service_lines;
