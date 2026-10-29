const assert = require('assert');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const link_proxy_rig = require('./link_proxy_rig');
const link_test = require('../src/main/src/helpers/link_test');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

process.env.SERVICEMAN_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'));

// The longest stretch the bytes did not grow, the stretch at the end included
test('a test says the longest its bytes stood', function () {
    assert.strictEqual(link_test.stood_most([[0, 0], [250, 10], [500, 20]]), 0);
    assert.strictEqual(link_test.stood_most([[0, 0], [250, 10], [500, 10], [750, 10], [1000, 30]]), 500);
    assert.strictEqual(link_test.stood_most([[0, 0], [250, 0], [500, 0]]), 500, 'none ever moved');
    assert.strictEqual(link_test.stood_most([[0, 0], [250, 10], [500, 20], [750, 20]]), 250, 'it stood at the end');
});

// A link of 1 MB/s toward the machine and 2 MB/s back, measured as it is: each way at its
// speed, a quick call waiting on the bytes ahead of it while a way is full, and a call with
// the link idle as quick as the link
test('a link test measures each way, and the calls while it is full', async function (t) {
    const running = await link_proxy_rig(t, {down: 1024*1024, up: 2*1024*1024});
    const result = await link_test(running.app, running.app.remote_by_name.vps1, {spell_ms: 3000});
    const summary = link_test.summary(result);
    assert.ok((summary.down_bps > 0.6*1024*1024) && (summary.down_bps < 1.4*1024*1024), `down ${summary.down_bps}`);
    assert.ok((summary.up_bps > 1.2*1024*1024) && (summary.up_bps < 2.8*1024*1024), `up ${summary.up_bps}`);
    assert.ok(summary.idle_ms < 200, `idle ${summary.idle_ms}`);
    assert.ok(result.down.pings.length >= 2, 'calls asked while the way is full');
    assert.ok(summary.down_wait_ms > 500, `a call waits behind the bytes ahead of it: ${summary.down_wait_ms}`);
    assert.ok(summary.down_stood_ms < 1000, `a way that moves does not stand: ${summary.down_stood_ms}`);
    assert.strictEqual(typeof summary.resends_here, 'number', 'this machine says what it sent again');
    assert.strictEqual(typeof summary.resends_there, 'number', 'and so does the agent');
    assert.ok(result.down.samples.length > 8, 'its bytes counted every 250 ms');
});

// The way to the machine stands 1.5 s mid-test: the test says so
test('a link test says how long the way to the machine stood', async function (t) {
    const running = await link_proxy_rig(t, {down: 1024*1024, up: 4*1024*1024});
    const remote = running.app.remote_by_name.vps1;
    const testing = link_test(running.app, remote, {spell_ms: 4000});
    await timers.setTimeout(2500);
    const link = running.links[running.links.length - 1];
    link.stand();
    await timers.setTimeout(1500);
    link.stood = false;
    const summary = link_test.summary(await testing);
    assert.ok(summary.down_stood_ms >= 1250, `stood ${summary.down_stood_ms}`);
});

// Through the control door: one at a time, and an agent that cannot is told so, not hung on
test('the link test door refuses an old agent and a second test at once', async function (t) {
    const running = await link_proxy_rig(t, {down: 4*1024*1024, up: 4*1024*1024});
    const remote = running.app.remote_by_name.vps1;
    remote.state.link_test_running = true;
    const busy = await fetch_host({port: running.control_port, host: 'serviceman.localhost', method: 'POST', path: '/api/v1/remotes/vps1/link-test'});
    assert.strictEqual(busy.status, 409);
    remote.state.link_test_running = false;
    remote.state.resources.can = remote.state.resources.can.filter(v => v !== 'net_test');
    const old = await fetch_host({port: running.control_port, host: 'serviceman.localhost', method: 'POST', path: '/api/v1/remotes/vps1/link-test'});
    assert.strictEqual(old.status, 400);
    assert.match(JSON.parse(old.body).error, /from before the link test/);
});
