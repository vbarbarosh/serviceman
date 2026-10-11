const file_write_synced = require('./file_write_synced');
const path = require('path');

const BATCH_LINES = 1000;
const BATCH_BYTES = 1024*1024;
const SEND_MS = 30000;
const IDLE_MS = 1000;
const WAIT_FIRST_MS = 1000;
const WAIT_LONGEST_MS = 60000;
// How long sending has to go without a failure before it is said to work again
const STEADY_MS = 30000;

// The spool, to Logline, one batch at a time and in order. A batch leaves the spool only when
// Logline answers 2xx; any other answer, or none, and the same batch goes again — the same
// bytes, which Logline stores once however often they come. A batch Logline refuses outright —
// a 4xx no retry can change — is put aside in refused/, said, and not deleted.
//
// New lines wake an idle loop, never the wait after a failure: the lines this loop says about
// itself are new lines too, and waking on them sent the same refused batch ten times a second.
// New settings end that wait, since a new token or endpoint may be the cure.
//
// ctx: {spool, dir, settings, stats, say} -> {stop, wake, retry}
function logline_ship(ctx)
{
    const run = {running: true, wake: null, idle: false};
    loop(ctx, run);
    return {
        stop: function () {
            run.running = false;
            wake(run);
        },
        wake: function () {
            if (run.idle) {
                wake(run);
            }
        },
        retry: () => wake(run),
    };
}

async function loop(ctx, run)
{
    const state = {wait_ms: WAIT_FIRST_MS, failed_at: 0};
    while (run.running) {
        try {
            await round(ctx, run, state);
        }
        catch (error) {
            // Whatever broke, the lines are still in the spool: said, and tried again
            ctx.say('logline_ship_error', {reason: error.message, then: 'tried again'});
            await sleep(run, WAIT_LONGEST_MS);
        }
    }
}

// One batch, sent — or the wait before the next try
async function round(ctx, run, state)
{
    const cut = ctx.spool.batch(BATCH_LINES, BATCH_BYTES);
    if (cut === null) {
        run.idle = true;
        await sleep(run, IDLE_MS);
        run.idle = false;
        return;
    }
    const settings = ctx.settings();
    const answer = await send(settings, cut.body);
    if (run.running === false) {
        return;
    }
    if (answer.ok) {
        ctx.spool.ack(cut);
        stats_add(ctx, cut, 'ok');
        // Working again only once it has gone a while without a failure: a Logline that takes
        // one batch and refuses the next is still failing, and is not said twice a batch
        if ((ctx.stats.failing !== null) && (Date.now() - state.failed_at >= STEADY_MS)) {
            ctx.say('logline_ship_ok', {after: ctx.stats.failing, sent: cut.count});
            ctx.stats.failing = null;
        }
        state.wait_ms = WAIT_FIRST_MS;
        return;
    }
    if (answer.refused) {
        // Nothing will make Logline take it: it is kept aside, whole, and the rest go on
        file_write_synced(path.join(ctx.dir, 'refused', `${cut.first}-${cut.last}.json`), JSON.stringify({answer: answer.text, batch: JSON.parse(cut.body)}));
        ctx.spool.ack(cut);
        stats_add(ctx, cut, answer.text);
        ctx.say('logline_batch_refused', {first: cut.first, last: cut.last, lines: cut.count, reason: answer.text, kept: `refused/${cut.first}-${cut.last}.json`});
        return;
    }
    ctx.stats.last_answer = answer.text;
    state.failed_at = Date.now();
    // Said once per reason: a Logline away for an hour is one line, not a line a minute
    if (ctx.stats.failing !== answer.text) {
        ctx.say('logline_ship_error', {reason: answer.text, waiting: ctx.spool.stats().waiting_lines, then: 'the same batch again, until it is taken'});
        ctx.stats.failing = answer.text;
    }
    await sleep(run, state.wait_ms);
    state.wait_ms = Math.min(state.wait_ms*2, WAIT_LONGEST_MS);
}

// {ok} for a 2xx, {refused} for an answer no retry changes, and why in `text`
async function send(settings, body)
{
    if ((settings.logs !== 'all') || (settings.endpoint === null) || (settings.token === null)) {
        return {ok: false, refused: false, text: 'this machine is not told where to send'};
    }
    let res;
    try {
        res = await fetch(settings.endpoint, {
            method: 'POST',
            headers: {'authorization': `Bearer ${settings.token}`, 'content-type': 'application/json'},
            body,
            signal: AbortSignal.timeout(SEND_MS),
        });
    }
    catch (error) {
        return {ok: false, refused: false, text: ((error.cause === undefined) ? error.message : error.cause.message)};
    }
    const text = await res.text().catch(() => '');
    let said = text;
    try {
        said = JSON.parse(text).error || text;
    }
    catch {
        // Not Logline's JSON; the text is what there is
    }
    if ((res.status >= 200) && (res.status <= 299)) {
        return {ok: true, refused: false, text: 'ok'};
    }
    // A wrong token, a wrong address, a Logline too busy: none of it is the batch's fault
    const retried = [401, 403, 404, 408, 425, 429];
    return {ok: false, refused: ((res.status >= 400) && (res.status <= 499) && (retried.includes(res.status) === false)), text: `${res.status} ${said}`.trim()};
}

function stats_add(ctx, cut, answer)
{
    ctx.stats.sent_lines += ((answer === 'ok') ? cut.count : 0);
    ctx.stats.sent_batches += ((answer === 'ok') ? 1 : 0);
    ctx.stats.sent_bytes += ((answer === 'ok') ? Buffer.byteLength(cut.body) : 0);
    ctx.stats.last_sent_at = new Date().toISOString();
    ctx.stats.last_answer = answer;
    file_write_synced(path.join(ctx.dir, 'stats.json'), JSON.stringify({
        sent_lines: ctx.stats.sent_lines,
        sent_batches: ctx.stats.sent_batches,
        sent_bytes: ctx.stats.sent_bytes,
        last_sent_at: ctx.stats.last_sent_at,
        last_answer: ctx.stats.last_answer,
    }));
}

function sleep(run, ms)
{
    return new Promise(function (resolve) {
        const timer = setTimeout(done, ms);
        run.wake = done;
        function done() {
            clearTimeout(timer);
            run.wake = null;
            resolve();
        }
    });
}

function wake(run)
{
    if (run.wake !== null) {
        run.wake();
    }
}

module.exports = logline_ship;
