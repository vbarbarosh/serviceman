const assert = require('assert');
const link_carrying = require('../src/main/src/helpers/link_carrying');
const link_send_message = require('../src/helpers/link_send_message');
const link_send_stream = require('../src/helpers/link_send_stream');
const net = require('net');
const path = require('path');
const remote_attach = require('../src/main/src/helpers/remote_attach');
const remote_call = require('../src/main/src/helpers/remote_call');
const remote_state = require('../src/main/src/helpers/remote_state');
const test = require('node:test');
const timers = require('timers/promises');
const tunnel_open = require('../src/main/src/helpers/tunnel_open');
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
    assert.deepStrictEqual(view_from_remote(remote, now).unanswered, {method: 'fs_stat', ms: 40000, heard_ms: 3000, carrying: {count: 0, files: []}});
    delete remote.state.calls[2];
    delete remote.state.calls[3];
    assert.strictEqual(view_from_remote(remote, now).unanswered, null, 'an upgrade takes its time; a call of two seconds is not late');
    // A call that ran out of time keeps it said until the machine answers anything again
    Object.assign(remote.state, {unanswered_since: now - 75000, unanswered_method: 'fs_stat'});
    assert.deepStrictEqual(view_from_remote(remote, now).unanswered, {method: 'fs_stat', ms: 75000, heard_ms: 3000, carrying: {count: 0, files: []}});
    remote.state.phase = 'offline';
    remote.state.calls[2] = {method: 'fs_stat', at: now - 40000};
    assert.strictEqual(view_from_remote(remote, now).unanswered, null, 'a machine away is offline, not unanswering');
});

// A server read "not answering" for minutes, each time while a tar of tens of MB went to it
// over the same link, and nothing on its page said so. Its view names the files its link
// carries, the most bytes first, how far each got and how long its bytes have stood: a file
// that stands is a link that carries nothing, one that grows a link that is full.
test('a machine not answering names the files its link carries, how far they got and when they last moved', async function () {
    const remote_unanswered_said = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'remote_unanswered_said.js'))).default;
    const now = Date.now();
    const remote = {name: 'vps1', title: null, tags: [], machine: null, state: Object.assign(remote_state(), {phase: 'online', heard_at: now - 1000})};
    remote.state.calls = {1: {method: 'term_list', at: now - 72000}};
    remote.state.streams = {
        2: {carries: {way: 'to', name: '.move-4242-1793270000000.tar'}, opened_at: now - 73000, sent: 13*1048576, taken: 9*1048576, taken_at: now - 63000, got: 40, got_at: now - 63000},
        4: {carries: null, opened_at: now - 9000, sent: 10, taken: 10, taken_at: now - 100, got: 900, got_at: now - 100},
        6: {carries: {way: 'from', name: 'claude.json'}, opened_at: now - 2000, sent: 0, taken: 0, taken_at: null, got: 65536, got_at: null},
    };
    const unanswered = view_from_remote(remote, now).unanswered;
    assert.deepStrictEqual(unanswered.carrying, {count: 2, files: [
        {way: 'to', name: '.move-4242-1793270000000.tar', bytes: 13*1048576, taken: 9*1048576, still_ms: 63000},
        {way: 'from', name: 'claude.json', bytes: 65536, taken: null, still_ms: 2000},
    ]}, 'a shell is no file; a file whose bytes never moved has stood since it opened');
    const view = Object.assign({phase: 'online'}, {unanswered});
    assert.strictEqual(remote_unanswered_said(view), 'Not answering for 1m 12s: serviceman asked it term_list and waits for the answer; its link is up and its beats still come; the link carries 2 files, the furthest along .move-4242-1793270000000.tar to it meanwhile, 13.0MB sent and 9.0MB written there, nothing more for 1m 3s');
    // One file, still moving: its bytes were written a moment ago
    delete remote.state.streams[6];
    remote.state.streams[2].taken_at = now - 400;
    assert.strictEqual(remote_unanswered_said(Object.assign({phase: 'online'}, {unanswered: view_from_remote(remote, now).unanswered})), 'Not answering for 1m 12s: serviceman asked it term_list and waits for the answer; its link is up and its beats still come; the link carries .move-4242-1793270000000.tar to it meanwhile, 13.0MB sent and 9.0MB written there, and growing');
    // One coming from it, that stands
    remote.state.streams = {6: {carries: {way: 'from', name: 'claude.json'}, opened_at: now - 30000, sent: 0, taken: 0, taken_at: null, got: 65536, got_at: now - 20000}};
    assert.strictEqual(remote_unanswered_said(Object.assign({phase: 'online'}, {unanswered: view_from_remote(remote, now).unanswered})), 'Not answering for 1m 12s: serviceman asked it term_list and waits for the answer; its link is up and its beats still come; the link carries claude.json from it meanwhile, 64.0KB come, nothing more for 20s');
    // Nothing on the link: the words end where they did
    remote.state.streams = {};
    assert.strictEqual(remote_unanswered_said(Object.assign({phase: 'online'}, {unanswered: view_from_remote(remote, now).unanswered})), 'Not answering for 1m 12s: serviceman asked it term_list and waits for the answer; its link is up and its beats still come');
});

// The stream a file rides counts its bytes both ways as they move: what it sent, what the far end
// said it wrote, and when; what it was given back. A file is named by the target that opened it.
test('a file\'s stream counts what it sent and what the machine wrote, and says what it carries', async function (t) {
    const app = {log_lines: [], log_stdout_time: false, config: {join: null}};
    const remote = {name: 'vps1', title: null, tags: [], machine: null, state: remote_state()};
    const pair = await socket_pair();
    t.after(function () {
        pair.host.removeAllListeners('close');
        pair.host.destroy();
        pair.agent.destroy();
        pair.server.close();
    });
    pair.agent.resume();
    remote_attach(app, remote, pair.host);
    remote.state.phase = 'online';
    const stream = tunnel_open(remote, {file: {dir: '/home/user', name: 'big.tar'}});
    const shell = tunnel_open(remote, {shell: {}});
    assert.deepStrictEqual(stream.carries, {way: 'to', name: 'big.tar'});
    assert.strictEqual(shell.carries, null);
    assert.deepStrictEqual(tunnel_open(remote, {tar: {dir: '/home/user/agents/a1', names: []}}).carries, {way: 'from', name: 'a tar of a1'});
    assert.deepStrictEqual(tunnel_open(remote, {tar_put: {dir: '/home/user/in'}}).carries, {way: 'to', name: 'a tar into in'});
    assert.deepStrictEqual(tunnel_open(remote, {read: {path: '/home/user/claude.json'}}).carries, {way: 'from', name: 'claude.json'});
    assert.deepStrictEqual(tunnel_open(remote, {part: {dir: '/home/user', name: 'song.mp3', id: 'a1', offset: 0}}).carries, {way: 'to', name: 'song.mp3'});
    stream.write(Buffer.alloc(100000, 7));
    await until(() => stream.sent === 100000);
    assert.strictEqual(stream.taken, 0);
    assert.strictEqual(stream.taken_at, null);
    // The machine says it wrote 65536 of them
    const credit = Buffer.alloc(4);
    credit.writeUInt32BE(65536, 0);
    link_send_stream(pair.agent, 'r', stream.id, credit);
    await until(() => stream.taken === 65536);
    assert.ok(Date.now() - stream.taken_at < 1000);
    link_send_stream(pair.agent, 'd', stream.id, Buffer.from('{"path":"/home/user/big.tar"}\n'));
    await until(() => stream.got === 30);
    const carrying = link_carrying(remote.state, Date.now());
    assert.strictEqual(carrying.count, 5, 'five files, and a shell that is none');
    assert.deepStrictEqual(Object.assign({}, carrying.files[0], {still_ms: 0}), {way: 'to', name: 'big.tar', bytes: 100000, taken: 65536, still_ms: 0});
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
        // A file on its way to it, of which the machine wrote nothing yet
        tunnel_open(remote, {file: {dir: '/home/user', name: 'big.tar'}}).write(Buffer.alloc(5000, 7));
        const first = remote_call(app, remote, 'fs_stat', {path: '/'}, 50);
        const second = remote_call(app, remote, 'fs_stat', {path: '/etc'}, 80);
        await assert.rejects(first, /did not answer within/);
        await assert.rejects(second, /did not answer within/);
        assert.deepStrictEqual(said(app), ['remote_unanswered remote=vps1 method=fs_stat']);
        assert.match(app.log_lines.find(v => v.includes('[remote_unanswered]')), / carrying=1 file=big\.tar way=to sent=5000 taken=0 still=0s$/, 'the file on its link, how far it got, and how long its bytes stood');
        // The machine's answer to the first, late
        link_send_message(pair.agent, {type: 'reply', id: 1, ok: true, value: {}});
        await until(() => said(app).length === 2);
        assert.deepStrictEqual(said(app), ['remote_unanswered remote=vps1 method=fs_stat', 'remote_answering remote=vps1']);
        assert.match(app.log_lines.find(v => v.includes('[remote_answering]')), / carrying=1 file=big\.tar way=to sent=5000 taken=0 still=0s$/);
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
