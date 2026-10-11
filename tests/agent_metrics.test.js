const agent_metrics_average = require('../src/agent/src/agent_metrics_average');
const agent_metrics_read = require('../src/agent/src/agent_metrics_read');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// The history is read from this folder, never from beside the agent's own file in src/: the
// agent asks for its folder when it reads, so setting it here is in time
process.env.SERVICEMAN_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-metrics-'));
const DIR = path.join(process.env.SERVICEMAN_AGENT_DIR, 'metrics');

const MINUTE_MS = 60*1000;

test('an hour is read as half-minute points, and the minutes the machine was off are a gap', function () {
    files_clear();
    const now = Date.now();
    const rows = [];
    for (let at = now - 60*MINUTE_MS; at <= now; at += 30000) {
        // Off from 40 to 20 minutes ago: nothing written
        if ((at > now - 40*MINUTE_MS) && (at < now - 20*MINUTE_MS)) {
            continue;
        }
        rows.push({at, cpu: 0.25, mem: 100, mem_total: 400, net_in: 1000, tcp: 3, ping: null});
    }
    rows_write('30s', rows);
    const answer = agent_metrics_read({range: '1h'});
    assert.strictEqual(answer.step_ms, 30000);
    assert.ok(answer.points.length > 70, `${answer.points.length} points`);
    assert.strictEqual(answer.points.some(v => (v.at > now - 39*MINUTE_MS) && (v.at < now - 21*MINUTE_MS)), false, 'no point stands in the gap');
    assert.strictEqual(answer.points[0].cpu, 0.25);
    assert.strictEqual(answer.points[0].ping, null, 'a ping nobody measured stays null, not zero');
});

test('a day is at most 720 points, each the mean of its step', function () {
    files_clear();
    // On the half minute, as the agent writes them, so each two-minute step holds four
    const now = Math.floor(Date.now()/30000)*30000;
    const rows = [];
    for (let at = now - 24*60*MINUTE_MS; at <= now; at += 30000) {
        rows.push({at, cpu: (((at/30000) % 2 === 0) ? 0 : 1)});
    }
    rows_write('30s', rows);
    const answer = agent_metrics_read({range: '24h'});
    assert.strictEqual(answer.step_ms, 120000);
    assert.ok(answer.points.length <= 721, `${answer.points.length} points`);
    assert.ok(answer.points.slice(1, -1).every(v => v.cpu === 0.5), 'four samples of 0 and 1 make one point of 0.5');
});

test('a week is read from the averages, and reaches now through the half-minute lines', function () {
    files_clear();
    const now = Date.now();
    const averages = [];
    for (let at = now - 7*24*60*MINUTE_MS; at < now - 60*MINUTE_MS; at += 5*MINUTE_MS) {
        averages.push({at: Math.floor(at/(5*MINUTE_MS))*5*MINUTE_MS, cpu: 0.1});
    }
    rows_write('5m', averages);
    rows_write('30s', [{at: now - 2*MINUTE_MS, cpu: 0.9}]);
    const answer = agent_metrics_read({range: '7d'});
    assert.ok(answer.points.length <= 721, `${answer.points.length} points`);
    assert.strictEqual(answer.points[answer.points.length - 1].cpu, 0.9, 'the last minutes are there');
});

test('a line cut by a power loss is skipped, and a range nobody knows is refused', function () {
    files_clear();
    const now = Date.now();
    fs.mkdirSync(DIR, {recursive: true});
    fs.writeFileSync(path.join(DIR, `30s-${day_of(now)}.jsonl`), `${JSON.stringify({at: now - 1000, cpu: 0.5})}\n{"at": 17`);
    assert.strictEqual(agent_metrics_read({range: '1h'}).points.length, 1);
    assert.throws(() => agent_metrics_read({range: '1y'}), /no range is called "1y"/);
});

test('a machine that never wrote anything has an empty history, not an error', function () {
    files_clear();
    assert.deepStrictEqual(agent_metrics_read({range: '30d'}).points, []);
});

test('a mean counts only the samples that had the number', function () {
    const mean = agent_metrics_average([{at: 1, cpu: 0.2, ping: null}, {at: 2, cpu: 0.4, ping: 30}, {at: 3, cpu: 0.6}], 0);
    assert.deepStrictEqual(mean, {at: 0, cpu: 0.4, ping: 30});
    assert.deepStrictEqual(agent_metrics_average([{at: 1, ping: null}], 0), {at: 0, ping: null});
});

function files_clear()
{
    fs.rmSync(DIR, {recursive: true, force: true});
}

function rows_write(kind, rows)
{
    fs.mkdirSync(DIR, {recursive: true});
    for (const row of rows) {
        fs.appendFileSync(path.join(DIR, `${kind}-${day_of(row.at)}.jsonl`), `${JSON.stringify(row)}\n`);
    }
}

function day_of(at)
{
    return new Date(at).toISOString().slice(0, 10);
}
