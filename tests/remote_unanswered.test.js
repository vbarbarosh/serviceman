const assert = require('assert');
const link_send_message = require('../src/helpers/link_send_message');
const net = require('net');
const remote_attach = require('../src/main/src/helpers/remote_attach');
const remote_call = require('../src/main/src/helpers/remote_call');
const remote_state = require('../src/main/src/helpers/remote_state');
const test = require('node:test');
const timers = require('timers/promises');
const view_from_remote = require('../src/main/src/helpers/view_from_remote');

// A machine whose beats come and whose answers do not is one whose calls wait in line: its view
// names the oldest quick call still waiting, past ten seconds; a slow one, an upgrade, is no sign
test('a machine names the oldest quick call that waits past ten seconds for its answer', function () {
    const now = Date.now();
    const remote = {name: 'vps1', title: null, tags: [], machine: null, state: Object.assign(remote_state(), {phase: 'online', heard_at: now - 3000})};
    remote.state.calls = {
        1: {method: 'apt_upgrade', at: now - 90000},
        2: {method: 'fs_stat', at: now - 40000},
        3: {method: 'uptime', at: now - 25000},
        4: {method: 'metrics', at: now - 2000},
    };
    assert.deepStrictEqual(view_from_remote(remote, now).unanswered, {method: 'fs_stat', ms: 40000, heard_ms: 3000});
    delete remote.state.calls[2];
    delete remote.state.calls[3];
    assert.strictEqual(view_from_remote(remote, now).unanswered, null, 'an upgrade takes its time; a call of two seconds is not late');
    // A call that ran out of time keeps it said until the machine answers anything again
    Object.assign(remote.state, {unanswered_since: now - 75000, unanswered_method: 'fs_stat'});
    assert.deepStrictEqual(view_from_remote(remote, now).unanswered, {method: 'fs_stat', ms: 75000, heard_ms: 3000});
    remote.state.phase = 'offline';
    remote.state.calls[2] = {method: 'fs_stat', at: now - 40000};
    assert.strictEqual(view_from_remote(remote, now).unanswered, null, 'a machine away is offline, not unanswering');
});

// When a machine's calls waited minutes on a link that stayed up, serviceman's log
// said nothing of it. A call that runs out of time says once that the machine does not answer,
// and the first answer after, late ones too, says once that it answers again.
test('a machine that stops answering is said once, and once when it answers again', async function (t) {
    const app = {log_lines: [], log_stdout_time: false, config: {join: null}};
    const remote = {name: 'vps1', title: null, tags: [], machine: null, state: remote_state()};
    const pair = await socket_pair();
    t.after(function () {
        pair.host.removeAllListeners('close');
        pair.host.destroy();
        pair.agent.destroy();
        pair.server.close();
    });
    const log = console.log;
    console.log = function () {};
    try {
        remote_attach(app, remote, pair.host);
        remote.state.phase = 'online';
        const first = remote_call(app, remote, 'fs_stat', {path: '/'}, 50);
        const second = remote_call(app, remote, 'fs_stat', {path: '/etc'}, 80);
        await assert.rejects(first, /did not answer within/);
        await assert.rejects(second, /did not answer within/);
        assert.deepStrictEqual(said(app), ['remote_unanswered remote=vps1 method=fs_stat']);
        // The machine's answer to the first, late
        link_send_message(pair.agent, {type: 'reply', id: 1, ok: true, value: {}});
        await until(() => said(app).length === 2);
        assert.deepStrictEqual(said(app), ['remote_unanswered remote=vps1 method=fs_stat', 'remote_answering remote=vps1']);
        assert.strictEqual(remote.state.unanswered_since, null);
        assert.strictEqual(view_from_remote(remote).unanswered, null, 'it answers again');
    }
    finally {
        console.log = log;
    }
});

// The senders of the lines written, with the remote and the method where they say them
function said(app)
{
    return app.log_lines.map(v => /\]\[([a-z_]+)\] (remote=\S+)(?: (method=\S+))?/.exec(v)).filter(v => v !== null).map(v => [v[1], v[2], v[3]].filter(Boolean).join(' '));
}

// Two ends of one TCP connection on this machine: {host, agent, server}
async function socket_pair()
{
    const server = net.createServer();
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const accepted = new Promise(v => server.once('connection', v));
    const agent = net.connect(server.address().port, '127.0.0.1');
    const host = await accepted;
    return {host, agent, server};
}

async function until(ok)
{
    const deadline = Date.now() + 3000;
    while (ok() === false) {
        if (Date.now() > deadline) {
            throw new Error('waited too long');
        }
        await timers.setTimeout(10);
    }
}
