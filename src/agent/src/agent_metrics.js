const agent_metrics_average = require('./agent_metrics_average');
const agent_metrics_dir = require('./agent_metrics_dir');
const agent_metrics_rounded = require('./agent_metrics_rounded');
const agent_metrics_state = require('./agent_metrics_state');
const agent_say = require('./agent_say');
const agent_servermon_lines = require('./agent_servermon_lines');
const fs = require('fs');
const path = require('path');

// How often a sample is taken. The env name is for a test that cannot wait half a minute.
const SAMPLE_EVERY_MS = parseInt(process.env.SERVICEMAN_METRICS_MS || '30000', 10);
const AVERAGE_MS = 5*60*1000;
const DAY_MS = 24*60*60*1000;
// The half-minute files cover two days whatever the hour: today and the two before it
const RAW_KEEP_DAYS = 3;
const AVERAGE_KEEP_DAYS = 91;
const RE_FILE = /^(30s|5m)-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const state = {taken_at: null, bucket: null, rows: [], day: null, failing: false, busy: false};

// The machine's numbers, written down on the machine every half minute whether serviceman is
// there or not: a chart of the hours the link was down is a chart of what the machine did then.
// They are servermon's lines of that half minute made into one, never measured here.
// What is kept and how long: see agent_metrics_read.
function agent_metrics(group)
{
    // The clock never keeps the agent up by itself: --once ends with its link
    const clock = setInterval(function () {
        if (state.busy) {
            return;
        }
        state.busy = true;
        sample_write(group).finally(function () {
            state.busy = false;
        });
    }, SAMPLE_EVERY_MS);
    clock.unref();
}

async function sample_write(group)
{
    try {
        const sample = sample_take();
        // servermon wrote nothing since the last one: the chart has a gap there, as it has for
        // the hours the machine was off
        if (sample === null) {
            return;
        }
        const dir = agent_metrics_dir();
        fs.mkdirSync(dir, {recursive: true});
        const day = day_of(sample.at);
        if (day !== state.day) {
            state.day = day;
            files_prune(dir, sample.at);
        }
        fs.appendFileSync(path.join(dir, `30s-${day}.jsonl`), `${JSON.stringify(sample)}\n`);
        const bucket = Math.floor(sample.at/AVERAGE_MS);
        if ((state.bucket !== null) && (bucket !== state.bucket) && (state.rows.length > 0)) {
            const average = agent_metrics_average(state.rows, state.bucket*AVERAGE_MS);
            fs.appendFileSync(path.join(dir, `5m-${day_of(average.at)}.jsonl`), `${JSON.stringify(average)}\n`);
            state.rows = [];
        }
        state.bucket = bucket;
        state.rows.push(sample);
        if (state.failing) {
            state.failing = false;
            agent_say(group, 'agent_metrics_ok', {dir});
        }
    }
    catch (error) {
        // Said once, not every half minute: a full disk would fill the log as well
        if (state.failing === false) {
            state.failing = true;
            agent_say(group, 'agent_metrics_error', {reason: error.message});
        }
    }
}

// One line: servermon's lines since the last one, the rates and the cpu as their mean, the
// rest as the last of them says; null when there are none
function sample_take()
{
    const since = ((state.taken_at === null) ? (Date.now() - SAMPLE_EVERY_MS) : state.taken_at);
    const rows = agent_servermon_lines().filter(v => v.at > since);
    if (rows.length === 0) {
        return null;
    }
    // Taken only with a line to go in: the beats' pings wait for the next one
    const pings = agent_metrics_state.pings.splice(0);
    const last = rows[rows.length - 1];
    state.taken_at = last.at;
    return agent_metrics_rounded({
        at: Date.now(),
        cpu: mean(rows.map(v => ((v.cpu === null) ? null : v.cpu/100))),
        load: last.load,
        mem: last.mem_used,
        mem_total: last.mem_total,
        disk: sum_of(last.mounts, 'used'),
        disk_total: sum_of(last.mounts, 'size'),
        disk_read: mean(rows.map(v => sum_of(v.disks, 'read'))),
        disk_write: mean(rows.map(v => sum_of(v.disks, 'write'))),
        net_in: mean(rows.map(v => sum_of(v.nets, 'in'))),
        net_out: mean(rows.map(v => sum_of(v.nets, 'out'))),
        tcp: last.tcp.open,
        ping: mean(pings),
    });
}

// The items' values added up; null when none of them has one
function sum_of(items, key)
{
    const values = items.map(v => v[key]).filter(v => (typeof v === 'number'));
    return ((values.length === 0) ? null : values.reduce((a, b) => a + b, 0));
}

function mean(values)
{
    const found = values.filter(v => (typeof v === 'number'));
    return ((found.length === 0) ? null : found.reduce((a, b) => a + b, 0)/found.length);
}

function files_prune(dir, now)
{
    for (const name of fs.readdirSync(dir)) {
        const found = RE_FILE.exec(name);
        if (found === null) {
            continue;
        }
        const keep_days = ((found[1] === '30s') ? RAW_KEEP_DAYS : AVERAGE_KEEP_DAYS);
        if (Date.parse(found[2]) <= now - keep_days*DAY_MS) {
            fs.rmSync(path.join(dir, name), {force: true});
        }
    }
}

// The day a moment belongs to, in UTC: the name of its file
function day_of(at)
{
    return new Date(at).toISOString().slice(0, 10);
}

module.exports = agent_metrics;
