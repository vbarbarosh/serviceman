const agent_metrics_average = require('./agent_metrics_average');
const agent_metrics_dir = require('./agent_metrics_dir');
const fs = require('fs');
const path = require('path');

const HOUR_MS = 60*60*1000;
const DAY_MS = 24*HOUR_MS;
const RANGES = {'1h': HOUR_MS, '24h': DAY_MS, '7d': 7*DAY_MS, '30d': 30*DAY_MS};
// A range up to this long is read from the half-minute lines, a longer one from the averages
const RAW_MOST_MS = 2*DAY_MS;
const RAW_MS = 30*1000;
const AVERAGE_MS = 5*60*1000;
// About one point for each pixel of a wide chart: more is drawn over itself
const POINTS_MOST = 720;

// The machine's numbers over the last hour, day, week or month, as at most POINTS_MOST points,
// each the mean of what fell in its step. A step with nothing in it is no point at all: the
// machine was off, and the chart shows a gap.
//
// The longer ranges come from the five-minute averages, and the minutes since the last of them
// from the half-minute lines, so every range reaches the moment it was asked.
function agent_metrics_read(params)
{
    const span_ms = RANGES[params.range];
    if (span_ms === undefined) {
        throw new Error(`no range is called ${JSON.stringify(String(params.range))}; there are ${Object.keys(RANGES).join(', ')}`);
    }
    const to = Date.now();
    const from = to - span_ms;
    const source_ms = (span_ms <= RAW_MOST_MS) ? RAW_MS : AVERAGE_MS;
    const step_ms = Math.max(source_ms, Math.ceil(span_ms/POINTS_MOST/source_ms)*source_ms);
    let rows = rows_read((source_ms === RAW_MS) ? '30s' : '5m', from, to);
    if (source_ms === AVERAGE_MS) {
        const since = (rows.length === 0) ? from : rows[rows.length - 1].at + AVERAGE_MS;
        rows = rows.concat(rows_read('30s', since, to));
    }
    return {range: params.range, from, to, step_ms, points: points_of(rows, step_ms)};
}

function rows_read(kind, from, to)
{
    const dir = agent_metrics_dir();
    const out = [];
    for (let day = Math.floor(from/DAY_MS)*DAY_MS; day <= to; day += DAY_MS) {
        let text;
        try {
            text = fs.readFileSync(path.join(dir, `${kind}-${new Date(day).toISOString().slice(0, 10)}.jsonl`), 'utf8');
        }
        catch {
            continue;
        }
        for (const line of text.split('\n')) {
            if (line === '') {
                continue;
            }
            let row;
            try {
                row = JSON.parse(line);
            }
            catch {
                // A line cut by a power loss: the rest of the file still holds
                continue;
            }
            if ((row.at >= from) && (row.at <= to)) {
                out.push(row);
            }
        }
    }
    // A clock set back writes a line out of order; the steps are counted in time
    out.sort((a, b) => a.at - b.at);
    return out;
}

function points_of(rows, step_ms)
{
    const out = [];
    let bucket = null;
    let group = [];
    for (const row of rows) {
        const b = Math.floor(row.at/step_ms);
        if ((bucket !== null) && (b !== bucket)) {
            out.push(agent_metrics_average(group, bucket*step_ms));
            group = [];
        }
        bucket = b;
        group.push(row);
    }
    if (group.length > 0) {
        out.push(agent_metrics_average(group, bucket*step_ms));
    }
    return out;
}

module.exports = agent_metrics_read;
