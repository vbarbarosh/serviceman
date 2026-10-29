const net_counters_read = require('../../../helpers/net_counters_read');
const remote_call = require('./remote_call');
const timers = require('timers/promises');
const tunnel_open = require('./tunnel_open');

// How long each way is tried, how often its bytes are counted and a quick call is asked
const SPELL_MS = 8000;
const SAMPLE_MS = 250;
const IDLE_PINGS = 5;
// A ping waits as long as the link makes it: a way that stands is what the test is for
const PING_TIMEOUT_MS = 120000;
const COUNTERS_TIMEOUT_MS = 10000;
// The most the machine is asked to send back, whatever the link could carry in the spell
const POUR_BYTES_MOST = 512*1024*1024;
// What the machine's answer about the bytes it swallowed may still take once the last are sent
const END_TIMEOUT_MS = 120000;
const PIECE = Buffer.alloc(64*1024);

// A machine's link, measured the way a file uses it: bytes sent to the machine for a spell as
// fast as it takes them, then bytes from it, a quick call asked every SAMPLE_MS all the while,
// as the page asks while a file goes. Before and after, the counters of both ends for what
// their networks dropped and sent again. {idle_ms, down, up, here, there}: idle_ms the round
// trips with nothing else on the link; down and up {bytes, ms, samples, pings, stood_ms}, the
// bytes taken over time as [ms, bytes], each call as [ms asked, ms it took], and the longest
// stretch the bytes did not move; here and there {before, after}, net_counters_read's for
// serviceman and the machine.
async function link_test(app, remote, options)
{
    const spell_ms = ((options !== undefined) && (options.spell_ms !== undefined)) ? options.spell_ms : SPELL_MS;
    const before = await counters(app, remote);
    const idle_ms = [];
    for (let i = 0; i < IDLE_PINGS; i++) {
        const time0 = Date.now();
        await remote_call(app, remote, 'ping', {}, PING_TIMEOUT_MS);
        idle_ms.push(Date.now() - time0);
    }
    const down = await way(app, remote, spell_ms, down_run);
    const up = await way(app, remote, spell_ms, up_run);
    const after = await counters(app, remote);
    return {
        idle_ms,
        down,
        up,
        here: {before: before.here, after: after.here},
        there: {before: before.there, after: after.there},
    };
}

async function counters(app, remote)
{
    return {
        here: net_counters_read(),
        there: await remote_call(app, remote, 'net_counters', {}, COUNTERS_TIMEOUT_MS),
    };
}

// One way: its bytes counted every SAMPLE_MS, a quick call asked every SAMPLE_MS, until `run`
// says the way is over
async function way(app, remote, spell_ms, run)
{
    const time0 = Date.now();
    const counted = {bytes: 0};
    const samples = [[0, 0]];
    const pings = [];
    let over = false;
    const sampler = setInterval(function () {
        samples.push([Date.now() - time0, counted.bytes]);
    }, SAMPLE_MS);
    const asking = (async function () {
        while (over === false) {
            const asked = Date.now();
            try {
                await remote_call(app, remote, 'ping', {}, PING_TIMEOUT_MS);
            }
            catch {
                // The link went; the way says so
                return;
            }
            pings.push([asked - time0, Date.now() - asked]);
            await timers.setTimeout(Math.max(0, SAMPLE_MS - (Date.now() - asked)));
        }
    })();
    try {
        await run(remote, spell_ms, counted);
    }
    finally {
        over = true;
        clearInterval(sampler);
    }
    const ms = Date.now() - time0;
    samples.push([ms, counted.bytes]);
    await asking;
    return {bytes: counted.bytes, ms, samples, pings, stood_ms: stood_most(samples)};
}

// To the machine: zeros as fast as it takes them, for the spell; counted as the machine says it
// took them, which is what has crossed the link
async function down_run(remote, spell_ms, counted)
{
    const stream = tunnel_open(remote, {sink: {}});
    const said = [];
    const ended = new Promise(function (resolve, reject) {
        stream.on('data', function (chunk) {
            said.push(chunk);
        });
        stream.on('end', resolve);
        stream.on('error', reject);
        stream.on('close', function () {
            reject(new Error(`the link to ${remote.name} went during the test`));
        });
    });
    stream.on('taken', function () {
        counted.bytes = stream.taken;
    });
    const until = Date.now() + spell_ms;
    while (Date.now() < until) {
        if (stream.write(PIECE) === false) {
            await Promise.race([new Promise(v => stream.once('drain', v)), timers.setTimeout(Math.max(0, until - Date.now()))]);
        }
    }
    stream.end();
    await Promise.race([ended, timers.setTimeout(END_TIMEOUT_MS).then(function () {
        throw new Error(`${remote.name} never said what it took`);
    })]);
    counted.bytes = stream.taken;
    stream.destroy();
}

// From the machine: what it sends for the spell, counted as it arrives
async function up_run(remote, spell_ms, counted)
{
    const stream = tunnel_open(remote, {pour: {ms: spell_ms, bytes: POUR_BYTES_MOST}});
    await new Promise(function (resolve, reject) {
        stream.on('data', function (chunk) {
            counted.bytes += chunk.length;
        });
        stream.on('end', resolve);
        stream.on('error', reject);
        stream.on('close', function () {
            reject(new Error(`the link to ${remote.name} went during the test`));
        });
    });
    stream.destroy();
}

// The longest stretch, in ms, between two counts the bytes did not grow in, the last one
// before the way ended included
function stood_most(samples)
{
    let most = 0;
    let since = null;
    for (let i = 1; i < samples.length; i++) {
        if (samples[i][1] > samples[i - 1][1]) {
            since = null;
            continue;
        }
        since = (since === null) ? samples[i - 1][0] : since;
        most = Math.max(most, samples[i][0] - since);
    }
    return most;
}

// The test in a few numbers, for the log line and the page: the round trip with nothing on the
// link; each way's speed, the longest a call waited on it and the longest its bytes stood; what
// each end's network dropped and sent again meanwhile (null where a machine does not say)
link_test.summary = function (result) {
    return {
        idle_ms: median(result.idle_ms),
        down_bps: bps(result.down),
        down_wait_ms: wait_most(result.down),
        down_stood_ms: result.down.stood_ms,
        up_bps: bps(result.up),
        up_wait_ms: wait_most(result.up),
        up_stood_ms: result.up.stood_ms,
        drops_here: grew(result.here, ['udp_rcvbuf_errors', 'udp_sndbuf_errors']),
        drops_there: grew(result.there, ['udp_rcvbuf_errors', 'udp_sndbuf_errors']),
        resends_here: grew(result.here, ['tcp_retrans']),
        resends_there: grew(result.there, ['tcp_retrans']),
    };
};

function median(values)
{
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length/2)];
}

function bps(way)
{
    return Math.round(way.bytes*1000/Math.max(1, way.ms));
}

function wait_most(way)
{
    return way.pings.reduce((most, v) => Math.max(most, v[1]), 0);
}

// How much the named counters grew between the two readings; null where either is missing
function grew(end, names)
{
    if ((end.before === null) || (end.after === null) || (end.before === undefined) || (end.after === undefined)) {
        return null;
    }
    let out = 0;
    for (const name of names) {
        if ((typeof end.before[name] !== 'number') || (typeof end.after[name] !== 'number')) {
            return null;
        }
        out += end.after[name] - end.before[name];
    }
    return out;
}

link_test.stood_most = stood_most;
link_test.SPELL_MS = SPELL_MS;

module.exports = link_test;
