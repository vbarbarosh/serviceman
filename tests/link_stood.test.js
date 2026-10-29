const assert = require('assert');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const link_proxy_rig = require('./link_proxy_rig');
const link_stood = require('../src/main/src/helpers/link_stood');
const os = require('os');
const path = require('path');
const remote_call = require('../src/main/src/helpers/remote_call');
const remotes_measure = require('../src/main/src/helpers/remotes_measure');
const test = require('node:test');
const timers = require('timers/promises');

process.env.SERVICEMAN_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'));
// Half a minute is no test: the way to a machine is taken to stand after 1.5 s here, at both ends
process.env.SERVICEMAN_STOOD_MS = '1500';

// A server, 2026-10-29: its calls waited 65 to 223 s behind a tar whose bytes stood, while its
// beats kept coming. That is the way to it standing; a link that moves slowly, a machine gone
// quiet, a file that is all taken, or no file at all, is not.
test('the way to a machine stands when a call waits and a file to it stood, the machine still heard', function () {
    const now = Date.now();
    const STOOD = link_stood.stood_ms();
    function file(fields) {
        return Object.assign({carries: {way: 'to', name: 'big.tar'}, opened_at: now - STOOD - 9000, sent: 10*1048576, taken: 6*1048576, taken_at: now - STOOD - 100, got: 0, got_at: null}, fields);
    }
    // A quick call waiting, the machine heard 2 s ago, and the streams given
    function state(streams, fields) {
        return Object.assign({heard_at: now - 2000, unanswered_since: null, calls: {1: {method: 'term_list', at: now - STOOD - 500}}, streams}, fields);
    }
    const shell = {carries: null, opened_at: now - 60000, sent: 5, taken: 5, taken_at: now - 100, got: 9, got_at: now - 100};
    assert.deepStrictEqual(link_stood(state({2: file({}), 4: shell}), now), {waited_ms: STOOD + 500, file: {name: 'big.tar', sent: 10*1048576, taken: 6*1048576, still_ms: STOOD + 100}});
    assert.strictEqual(link_stood(state({2: file({})}, {calls: {}}), now), null, 'every call answered');
    assert.strictEqual(link_stood(state({2: file({})}, {calls: {1: {method: 'apt_upgrade', at: now - 600000}}}), now), null, 'only an upgrade waits, and it takes its time');
    assert.strictEqual(link_stood(state({2: file({})}, {calls: {1: {method: 'term_list', at: now - STOOD + 100}}}), now), null, 'a call that waited less');
    assert.strictEqual(link_stood(state({2: file({})}, {calls: {}, unanswered_since: now - STOOD - 900}), now).waited_ms, STOOD + 900, 'a call that ran out of time unanswered still counts');
    assert.strictEqual(link_stood(state({2: file({})}, {heard_at: now - 20000}), now), null, 'a machine not heard: the old rule, silence, is what drops it');
    assert.strictEqual(link_stood(state({2: file({taken_at: now - 400})}), now), null, 'bytes still taken: a link that is full, not one that stands');
    assert.strictEqual(link_stood(state({2: file({taken: 10*1048576})}), now), null, 'every byte taken: a file paused, not a way that stands');
    assert.strictEqual(link_stood(state({2: file({carries: {way: 'from', name: 'big.tar'}})}), now), null, 'a file coming from it');
    assert.strictEqual(link_stood(state({4: shell}), now), null, 'no file on the link');
    assert.strictEqual(link_stood(state({2: file({taken: 0, taken_at: null, opened_at: now - STOOD - 900})}), now).file.still_ms, STOOD + 900, 'a file none of which was ever taken has stood since it opened');
});

// The link is reset and the agent dials in again; calls answer on the new link
test('a link whose way to the machine stood is reset, and the agent dials a fresh one', async function (t) {
    // The agent's own rule kept out of the way, so serviceman's is what acts
    const running = await link_proxy_rig(t, {pass_reset: true, agent_env: {SERVICEMAN_STOOD_MS: '60000'}});
    await stand_and_recover(running);
    assert.ok(running.app.log_lines.some(v => /\[remote_dropped\] remote=vps1 reason="the way to it stood" waited=\S+ file=big\.tar sent=\d+ taken=\d+ still=\S+ then="its agent dials in again"/.test(v)), running.app.log_lines.filter(v => v.includes('remote_dropped')).join('\n'));
});

// What stands between the two may let the reset through no better than the bytes: the agent,
// with a file coming in and nothing heard from the host, dials fresh by itself
test('an agent that hears nothing while a file comes in dials fresh, the reset never reaching it', async function (t) {
    const running = await link_proxy_rig(t, {pass_reset: false});
    await stand_and_recover(running);
    await wait_until(() => running.agent_said.includes('[agent_host_stood]'), 10000);
});

// A file to the machine, its way standing once it is under way; then a quick call, which waits.
// Measured as serviceman's clock does it, every 250 ms here, and the link must come back by itself.
async function stand_and_recover(running)
{
    const remote = running.app.remote_by_name.vps1;
    const upload = upload_start(running, 20*1024*1024);
    await wait_until(() => link_of(running).carried > 2*1024*1024, 10000);
    link_of(running).stand();
    const call = remote_call(running.app, remote, 'fs_stat', {path: os.tmpdir()}, 60000).catch(e => e);
    const first = remote.state.socket;
    const clock = setInterval(function () {
        remotes_measure(running.app);
    }, 250);
    try {
        await wait_until(() => (remote.state.phase === 'online') && (remote.state.socket !== first), 20000);
        assert.ok(await call instanceof Error, 'the call that waited on the stuck link fails with it');
        const answer = await remote_call(running.app, remote, 'fs_stat', {path: os.tmpdir()}, 5000);
        assert.strictEqual(answer.kind, 'dir');
    }
    finally {
        clearInterval(clock);
        upload.destroy();
    }
}

// The proxy's link now: the last one the agent dialled
function link_of(running)
{
    return running.links[running.links.length - 1];
}

// A file to the machine, its body sent as fast as it is taken
function upload_start(running, size)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-stood-'));
    const request = http.request({port: running.control_port, host: '127.0.0.1', method: 'POST', path: `/api/v1/remotes/vps1/fs/upload?dir=${encodeURIComponent(dir)}&name=big.tar`, headers: {host: 'serviceman.localhost', authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}});
    request.on('error', function () {});
    request.on('response', function (answer) {
        answer.resume();
    });
    let sent = 0;
    (function more() {
        while (sent < size) {
            sent += 64*1024;
            if (request.write(Buffer.alloc(64*1024, 7)) === false) {
                request.once('drain', more);
                return;
            }
        }
        request.end();
    })();
    return request;
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + timeout_ms;
    while (ready() === false) {
        if (Date.now() >= deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(50);
    }
}
