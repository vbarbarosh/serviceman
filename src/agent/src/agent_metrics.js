const agent_cpu_times = require('./agent_cpu_times');
const agent_disk_bytes = require('./agent_disk_bytes');
const agent_disks = require('./agent_disks');
const agent_mem_free = require('./agent_mem_free');
const agent_metrics_average = require('./agent_metrics_average');
const agent_metrics_dir = require('./agent_metrics_dir');
const agent_metrics_rounded = require('./agent_metrics_rounded');
const agent_metrics_state = require('./agent_metrics_state');
const agent_net_bytes = require('./agent_net_bytes');
const agent_say = require('./agent_say');
const agent_tcp_count = require('./agent_tcp_count');
const fs = require('fs');
const os = require('os');
const path = require('path');

// How often a sample is taken. The env name is for a test that cannot wait half a minute.
const SAMPLE_EVERY_MS = parseInt(process.env.SERVICEMAN_METRICS_MS || '30000', 10);
const AVERAGE_MS = 5*60*1000;
const DAY_MS = 24*60*60*1000;
// The half-minute files cover two days whatever the hour: today and the two before it
const RAW_KEEP_DAYS = 3;
const AVERAGE_KEEP_DAYS = 91;
const RE_FILE = /^(30s|5m)-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const state = {cpu: null, net: null, disk: null, taken_at: null, bucket: null, rows: [], day: null, failing: false, busy: false};

// The machine's numbers, written down on the machine every half minute whether serviceman is
// there or not: a chart of the hours the link was down is a chart of what the machine did then.
// What is kept and how long: see agent_metrics_read.
function agent_metrics(options, group)
{
    counters_take();
    // The clock never keeps the agent up by itself: --once ends with its link
    const clock = setInterval(function () {
        if (state.busy) {
            return;
        }
        state.busy = true;
        sample_write(options, group).finally(function () {
            state.busy = false;
        });
    }, SAMPLE_EVERY_MS);
    clock.unref();
}

async function sample_write(options, group)
{
    try {
        const sample = await sample_take(options);
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

// One line: what the machine carries now, and the rates since the last line
async function sample_take(options)
{
    const before = {cpu: state.cpu, net: state.net, disk: state.disk, at: state.taken_at};
    counters_take();
    const seconds = ((before.at === null) ? 0 : (state.taken_at - before.at)/1000);
    const disks = await agent_disks(options.dir);
    const mem_total = os.totalmem();
    const pings = agent_metrics_state.pings.splice(0);
    return agent_metrics_rounded({
        at: state.taken_at,
        cpu: cpu_busy(before.cpu, state.cpu),
        load: os.loadavg()[0],
        mem: mem_total - agent_mem_free(),
        mem_total,
        disk: ((disks === null) ? null : disks.used),
        disk_total: ((disks === null) ? null : disks.total),
        disk_read: rate(before.disk, state.disk, 'read', seconds),
        disk_write: rate(before.disk, state.disk, 'written', seconds),
        net_in: rate(before.net, state.net, 'rx', seconds),
        net_out: rate(before.net, state.net, 'tx', seconds),
        tcp: agent_tcp_count(),
        ping: ((pings.length === 0) ? null : pings.reduce((a, b) => a + b, 0)/pings.length),
    });
}

function counters_take()
{
    state.cpu = agent_cpu_times();
    state.net = agent_net_bytes();
    state.disk = agent_disk_bytes();
    state.taken_at = Date.now();
}

function cpu_busy(before, now)
{
    if (before === null) {
        return null;
    }
    const total = now.total - before.total;
    if (total <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, 1 - (now.idle - before.idle)/total));
}

// Bytes a second between two readings of a counter. A counter that went back (a reboot, a card
// taken out) says nothing about the time between.
function rate(before, now, key, seconds)
{
    if ((before === null) || (now === null) || (seconds <= 0)) {
        return null;
    }
    const delta = now[key] - before[key];
    return ((delta < 0) ? null : delta/seconds);
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
