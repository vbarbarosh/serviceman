const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const config_remote_add = require('../src/main/src/helpers/config_remote_add');
const crypto = require('crypto');
const fake_docker_engine = require('./fake_docker_engine');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const link_send_stream = require('../src/helpers/link_send_stream');
const net = require('net');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const remote_call = require('../src/main/src/helpers/remote_call');
const remote_tags = require('../src/main/src/helpers/remote_tags');
const remotes_measure = require('../src/main/src/helpers/remotes_measure');
const server_start = require('../src/main/src/helpers/server_start');
const terminal_connect = require('../demos/terminal-client/terminal_connect');
const terminals_list = require('../demos/terminal-client/terminals_list');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';
const TOKEN2 = 'fedcba9876543210fedcba9876543210';
const JOIN_TOKEN = 'aaaabbbbccccddddeeeeffff00001111';

// Every agent this file spawns keeps its state here — never beside its own file in src/
process.env.SERVICEMAN_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'));
// The machine's numbers are servermon's: an agent given this log folder starts it, and the
// servermon it started outlives it, so the file stops it at the end
const LOGS_ENV = {SERVICEMAN_LOG_DIR: path.join(process.env.SERVICEMAN_AGENT_DIR, 'logs')};

test.after(function () {
    servermon_stop(path.join(process.env.SERVICEMAN_AGENT_DIR, 'servermon.js'));
});

test('an agent dials in, says what its machine is, and is measured', async function () {
    const running = await serviceman_start([{name: 'vps1', title: 'the first box', token: TOKEN}]);
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start(running.control_port, TOKEN, [], Object.assign({SERVICEMAN_STATS_MS: '200'}, LOGS_ENV));
    try {
        assert.strictEqual(remote.state.phase, 'offline');

        await wait_until(() => remote.state.phase === 'online');
        assert.strictEqual(remote.state.resources.hostname.length > 0, true);
        // The field is always there — the machine's os-release name, or null where there is none
        assert.strictEqual(remote.state.resources.os !== undefined, true);
        // Who the agent is over there: the name a sudoers line needs, and whose shell opens
        assert.strictEqual(remote.state.resources.user.length > 0, true);
        assert.strictEqual(remote.state.resources.cpu.count > 0, true);
        assert.strictEqual(remote.state.resources.mem.total > 0, true);
        assert.strictEqual(remote.state.resources.disk.free > 0, true);
        // From servermon's last line, once it has written one
        await wait_until(() => remote.state.stats.mem_free > 0);
        assert.strictEqual(remote.state.stats.servermon.state, 'running');
        // The field is always there — what update-notifier says, or null where there is none
        assert.strictEqual(remote.state.stats.updates !== undefined, true);
        // The same for the battery: a number and a word on a laptop, null on everything else
        assert.strictEqual(remote.state.stats.battery !== undefined, true);

        await wait_until(() => remote.state.throughput_bps !== null);
        assert.strictEqual(remote.state.latency_ms >= 0, true);
        assert.strictEqual(remote.state.throughput_bps > 0, true);

        const answer = await remote_call(running.app, remote, 'stats');
        assert.strictEqual(answer.mem_free > 0, true);

        const state = await state_read(running);
        assert.deepStrictEqual(state.remotes.map(v => [v.name, v.title, v.phase]), [
            ['vps1', 'the first box', 'online'],
        ], 'the machines are the ones the config names, and nothing else');
        assert.strictEqual(state.remotes[0].machine.hostname, remote.state.resources.hostname);
        assert.strictEqual(state.remotes[0].latency_ms >= 0, true);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_online\] remote=vps1 from=127\.0\.0\.1/.test(v)), true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a call the agent does not know comes back as an error, and so does a call to an offline remote', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}]);
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start(running.control_port, TOKEN);
    try {
        await wait_until(() => remote.state.phase === 'online');
        await assert.rejects(remote_call(running.app, remote, 'fly'), /this agent knows nothing called "fly"/);
        await assert.rejects(remote_call(running.app, running.app.remote_by_name.vps2, 'ping'), /remote vps2 is offline — its agent is not dialled in/);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a token no remote holds is refused, and the agent says why', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}]);
    try {
        const wrong = await agent_output(running.control_port, 'wrong-token-wrong-token');
        assert.match(wrong, /refused the link: 403 no remote in the config holds that token/);
        assert.strictEqual(running.app.remote_by_name.vps1.state.phase, 'offline');
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_refused\] from=127\.0\.0\.1 reason=unknown_token/.test(v)), true);
    }
    finally {
        await running.close();
    }
});

test('the token says which remote dialled in, and a second agent on the same token is refused', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}]);
    const second = running.app.remote_by_name.vps2;
    const agent = agent_start(running.control_port, TOKEN2);
    try {
        await wait_until(() => second.state.phase === 'online');
        assert.strictEqual(running.app.remote_by_name.vps1.state.phase, 'offline', 'the other remote was never touched');

        const twice = await agent_output(running.control_port, TOKEN2);
        assert.match(twice, /refused the link: 409 an agent is already connected as remote vps2/);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_refused\] remote=vps2 from=127\.0\.0\.1 reason=token_in_use/.test(v)), true);
        assert.strictEqual(second.state.phase, 'online', 'the agent that was there keeps the link');
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a link that drops leaves the remote offline, and the agent dials in again', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}]);
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start(running.control_port, TOKEN);
    try {
        await wait_until(() => remote.state.phase === 'online');
        const first_at = remote.state.connected_at;

        remote.state.socket.destroy();
        await wait_until(() => remote.state.phase === 'offline');
        assert.strictEqual(remote.state.socket, null);
        assert.strictEqual(remote.state.latency_ms, null);
        assert.strictEqual(remote.state.left_at !== null, true);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_offline\] remote=vps1 held=/.test(v)), true);

        await wait_until(() => remote.state.phase === 'online', 15000);
        assert.strictEqual(remote.state.connected_at > first_at, true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a link that drops while its machine is pinged leaves serviceman running', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}]);
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start(running.control_port, TOKEN);
    try {
        await wait_until(() => remote.state.phase === 'online');

        // Quiet long enough to be pinged; the link drops with the ping on its way, and the
        // failed ping finds no socket left (a crash on socket.destroy() of null, 2026-08-17)
        remote.state.heard_at = Date.now() - 30000;
        const measured = remotes_measure(running.app);
        remote.state.socket.destroy();
        await measured;
        assert.strictEqual(remote.state.phase, 'offline');
        assert.strictEqual(remote.state.socket, null);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_quiet\]/.test(v)), false, 'a dropped link is not a quiet machine');
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a remote that is left alone in the config keeps its link when the config is applied again', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}]);
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start(running.control_port, TOKEN);
    try {
        await wait_until(() => remote.state.phase === 'online');
        const socket = remote.state.socket;

        const config = config_from_json({
            listen: {host: '127.0.0.1', port: running.app.config.listen.port},
            control: {host: 'serviceman.localhost', port: running.app.config.control.port},
            remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps3', token: TOKEN2}],
            services: [],
        }, __dirname);
        const applied = await app_apply_config(running.app, config);

        assert.deepStrictEqual(applied.notes, [
            'remote vps3: new remote, waiting for its agent to dial in',
            'remote vps2: removed from the config',
        ]);
        assert.strictEqual(running.app.remote_by_name.vps1.state.socket, socket);
        assert.strictEqual(running.app.remote_by_name.vps1.state.phase, 'online');
        assert.deepStrictEqual(running.app.remotes.map(v => v.name), ['vps1', 'vps3']);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('an agent dials in over a socket file, and serviceman needs no port at all', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-sock-'));
    const socket_path = path.join(dir, 'serviceman.sock');
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}], {control: {host: null, port: 0, socket: socket_path}});
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start_at(`unix://${socket_path}`, TOKEN);
    try {
        assert.strictEqual((fs.statSync(socket_path).mode & 0o777).toString(8), '600', 'only its owner may reach the control page through it');

        await wait_until(() => remote.state.phase === 'online');
        assert.strictEqual(remote.state.address, undefined, 'a socket file has no address to come from');
        assert.strictEqual(remote.state.resources.cpu.count > 0, true);

        // The same door answers the control page, and a caller over a socket file is this machine
        const answer = await socket_get(socket_path, '/api/v1/status');
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(JSON.parse(answer.body).remotes.some(v => (v.name === 'vps1') && (v.phase === 'online')), true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a token shorter than a secret is refused before serviceman starts', function () {
    assert.throws(() => config_from_json({remotes: [{name: 'vps1', token: 'hunter2'}], services: []}, '/srv'), /remotes\[0\].token: a secret of at least 16 characters is required/);
    assert.throws(() => config_from_json({remotes: [{name: 'VPS 1', token: TOKEN}], services: []}, '/srv'), /remotes\[0\].name: expected lowercase letters/);
    assert.throws(() => config_from_json({remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps1', token: TOKEN2}], services: []}, '/srv'), /remotes\[1\].name: "vps1" is used twice/);
    assert.throws(() => config_from_json({remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN}], services: []}, '/srv'), /remotes\[1\].token: the same token is on remote "vps1"/);
});

test('remotes are made, reshaped and taken away from the control page', async function () {
    const running = await serviceman_start_file({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [{name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'}],
    });
    try {
        const made = await control(running, 'POST', '/api/v1/remotes', {remote: {name: 'vps1', title: 'the first box', token: TOKEN}});
        assert.strictEqual(made.status, 200);
        assert.deepStrictEqual(made.body.notes, ['remote vps1: new remote, waiting for its agent to dial in']);
        assert.deepStrictEqual(config_file_read(running).remotes, [{name: 'vps1', title: 'the first box', token: TOKEN}]);
        assert.deepStrictEqual(Object.keys(config_file_read(running)), ['listen', 'control', 'remotes', 'services'], 'the machines come before what runs on them');
        assert.deepStrictEqual((await state_read(running)).remotes.map(v => [v.name, v.phase]), [['vps1', 'offline']]);

        const twice = await control(running, 'POST', '/api/v1/remotes', {remote: {name: 'vps1', token: TOKEN}});
        assert.strictEqual(twice.status, 400);
        assert.strictEqual(twice.body.error, 'a remote named "vps1" already exists');

        const weak = await control(running, 'POST', '/api/v1/remotes', {remote: {name: 'vps2', token: 'hunter2'}});
        assert.strictEqual(weak.status, 400);
        assert.match(weak.body.error, /remotes\[1\].token: a secret of at least 16 characters is required/);

        const named = await control(running, 'PUT', '/api/v1/remotes/vps1', {remote: {name: 'vps1', title: 'renamed', token: TOKEN}});
        assert.strictEqual(named.status, 200);
        assert.strictEqual(config_file_read(running).remotes[0].title, 'renamed');

        const used = await control(running, 'POST', '/api/v1/services', {service: {name: 'far', type: 'docker', remote: 'vps1', publish: {host: 'far.test', port: 80}, image: 'demo/far'}});
        assert.strictEqual(used.status, 200);
        const held = await control(running, 'DELETE', '/api/v1/remotes/vps1', null);
        assert.strictEqual(held.status, 409, 'it is there and in use, which is not a 404');
        // The refusal is about the machine, and names what is keeping it: a person pressing
        // Remove on a machine is not looking at services[1]
        assert.strictEqual(held.body.error, 'vps1 is where far runs — say where it runs instead, then take the machine away');
        assert.deepStrictEqual(held.body.services, ['far'], 'named as well as said, so the page can offer to open them');
        assert.strictEqual(config_file_read(running).remotes.length, 1, 'the remote a service needs is kept');

        await control(running, 'DELETE', '/api/v1/services/far', null);
        const gone = await control(running, 'DELETE', '/api/v1/remotes/vps1', null);
        assert.strictEqual(gone.status, 200);
        assert.deepStrictEqual(config_file_read(running).remotes, []);
        assert.deepStrictEqual((await state_read(running)).remotes.map(v => v.name), [], 'no machine is left, and nothing stands in for one');

        const missing = await control(running, 'DELETE', '/api/v1/remotes/vps9', null);
        assert.strictEqual(missing.status, 404);
    }
    finally {
        await running.close();
    }
});

test('a machine that is talking is never asked anything, and one that went quiet is asked once', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}]);
    const remote = running.app.remote_by_name.vps1;
    try {
        // It said something a moment ago, so there is nothing to ask and nothing to say
        remote.state.phase = 'online';
        remote.state.connected_at = Date.now();
        remote.state.heard_at = Date.now();
        remote.state.socket = fake_socket();
        await remotes_measure(running.app);
        assert.deepStrictEqual(remote.state.calls, {}, 'a machine that is talking is not pinged');
        assert.strictEqual(running.app.log_lines.some(v => /remote_quiet/.test(v)), false);

        // It has gone quiet: it is asked, the asking fails on a dead link, and that is said
        // once — not once every clock
        const dead = remote.state.socket;
        remote.state.heard_at = Date.now() - 30000;
        await remotes_measure(running.app);
        await remotes_measure(running.app);
        assert.strictEqual(running.app.log_lines.filter(v => /\[remote_quiet\] remote=vps1/.test(v)).length, 1);
        assert.strictEqual(dead.destroyed, false, 'a machine that has gone quiet is not a machine that is gone');
        assert.deepStrictEqual(remote.state.calls, {}, 'no call is left waiting for an answer nobody will send');

        // An agent dialled in again while the asking was failing: the fresh link is left alone
        const fresh = fake_socket();
        remote.state.heard_at = Date.now() - 30000;
        const measured = remotes_measure(running.app);
        remote.state.socket = fresh;
        await measured;
        assert.strictEqual(fresh.destroyed, false, 'the link that took its place is not the one that failed');
        assert.strictEqual(remote.state.socket, fresh);

        // Nothing at all for long enough: the link is dropped, and the reason says why
        remote.state.heard_at = Date.now() - 70000;
        await remotes_measure(running.app);
        assert.strictEqual(fresh.destroyed, true, 'nothing heard for a minute is a machine that is gone');
        assert.match(remote.state.gone_reason, /nothing heard for 7\ds/);
    }
    finally {
        remote.state.socket = null;
        await running.close();
    }
});

test('a machine nobody wrote down adds itself with the join token, and claims only what it may', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-join-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        join: {token: JOIN_TOKEN, tags_allowed: ['gpu'], name_prefix: 'auto-'},
        services: [{name: 'far', type: 'docker', remotes: ['#gpu'], publish: {host: 'far.test', port: 80}, image: 'demo/far'}],
    }, null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    const servers = await server_start(app);
    const control_port = servers.control.address().port;
    const agent = agent_start(control_port, JOIN_TOKEN, ['--machine', 'box-17', '--tag', 'gpu', '--tag', 'secret']);
    try {
        await wait_until(() => app.remote_by_name['auto-box-17'] !== undefined);
        const joined = app.remote_by_name['auto-box-17'];
        assert.strictEqual(app.remotes.length, 1);
        assert.deepStrictEqual(joined.tags, ['gpu'], 'a tag the config does not allow is dropped, not honoured');
        assert.strictEqual(joined.machine, 'box-17');
        assert.strictEqual(joined.token.length, 64, 'the machine gets a secret of its own');
        await wait_until(() => app.remote_by_name['auto-box-17'].state.phase === 'online');
        assert.strictEqual(app.log_lines.some(v => /\[remote_joined\] remote=auto-box-17 machine=box-17 from=127\.0\.0\.1 tags=\["gpu"\] refused=\["secret"\]/.test(v)), true);

        // It is written down like any other machine, so it outlives the process that met it
        const written = JSON.parse(fs.readFileSync(config_path, 'utf8'));
        assert.deepStrictEqual(written.remotes.map(v => [v.name, v.machine, v.tags]), [['auto-box-17', 'box-17', ['gpu']]]);
        assert.deepStrictEqual(Object.keys(written), ['listen', 'control', 'join', 'remotes', 'services']);

        // The same machine coming back takes its own entry instead of leaving a dead one
        agent.kill('SIGKILL');
        await wait_until(() => app.remote_by_name['auto-box-17'].state.phase === 'offline');
        const again = agent_start(control_port, JOIN_TOKEN, ['--machine', 'box-17', '--tag', 'gpu']);
        try {
            await wait_until(() => app.remote_by_name['auto-box-17'].state.phase === 'online', 15000);
            assert.strictEqual(app.remotes.length, 1, 'one machine, one entry');
        }
        finally {
            again.kill('SIGKILL');
        }
    }
    finally {
        agent.kill('SIGKILL');
        await serviceman_close(app, servers);
    }
});

test('a machine that dies is offline at once, not when the next ping notices', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}]);
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start(running.control_port, TOKEN);
    try {
        await wait_until(() => remote.state.phase === 'online');

        // The agent is killed, so its end hangs up without a word. A socket taken over from an
        // http upgrade stays half-open when that happens, and the link would read as online
        // until a ping half a minute later said otherwise.
        agent.kill('SIGKILL');
        await wait_until(() => remote.state.phase === 'offline', 3000);
        assert.strictEqual(remote.state.socket, null);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('two changes to the config at once are written one after the other, and neither is lost', async function () {
    const running = await serviceman_start_file({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [{name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'}],
    });
    try {
        // The control page and a machine adding itself both read the file, change it, and write
        // it back. Sent together, the second must not write the first's change away.
        const made = [
            control(running, 'POST', '/api/v1/remotes', {remote: {name: 'vps1', token: TOKEN}}),
            config_remote_add(running.app, {name: 'vps2', token: TOKEN2, machine: 'box-9', tags: []}),
            control(running, 'POST', '/api/v1/remotes', {remote: {name: 'vps3', token: JOIN_TOKEN}}),
        ];
        await Promise.all(made);
        // Whoever reached the file first is not the point; all three being in it is
        assert.deepStrictEqual(config_file_read(running).remotes.map(v => v.name).sort(), ['vps1', 'vps2', 'vps3']);
        assert.deepStrictEqual(running.app.remotes.map(v => v.name).sort(), ['vps1', 'vps2', 'vps3']);
    }
    finally {
        await running.close();
    }
});

test('a machine that added itself cannot grow tags it was never allowed', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-claim-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        join: {token: JOIN_TOKEN, tags_allowed: ['gpu']},
        services: [],
    }, null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    const servers = await server_start(app);
    const port = servers.control.address().port;
    const first = agent_start(port, JOIN_TOKEN, ['--machine', 'box-3', '--tag', 'gpu']);
    try {
        await wait_until(() => app.remote_by_name['auto-box-3'] !== undefined);
        await wait_until(() => app.remote_by_name['auto-box-3'].state.phase === 'online');
        assert.deepStrictEqual(remote_tags(app.remote_by_name['auto-box-3']), ['gpu']);

        // It comes back claiming more than the join allows: the extra is dropped every time,
        // not only on the first link
        first.kill('SIGKILL');
        await wait_until(() => app.remote_by_name['auto-box-3'].state.phase === 'offline', 3000);
        const again = agent_start(port, JOIN_TOKEN, ['--machine', 'box-3', '--tag', 'gpu', '--tag', 'secret']);
        try {
            await wait_until(() => app.remote_by_name['auto-box-3'].state.phase === 'online', 15000);
            assert.deepStrictEqual(remote_tags(app.remote_by_name['auto-box-3']), ['gpu']);
            assert.strictEqual(app.remotes.length, 1);
        }
        finally {
            again.kill('SIGKILL');
        }
    }
    finally {
        first.kill('SIGKILL');
        await serviceman_close(app, servers);
    }
});

test('a stranger without the join token is still turned away', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}], {join: {token: JOIN_TOKEN, tags_allowed: ['gpu']}});
    try {
        const wrong = await agent_output(running.control_port, 'wrong-token-wrong-token');
        assert.match(wrong, /refused the link: 403 no remote in the config holds that token/);
        assert.strictEqual(running.app.remotes.length, 1, 'nothing was added');
    }
    finally {
        await running.close();
    }
});

test('one command installs the agent, and it carries the address the machine reached', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}]);
    try {
        const answer = await fetch_host({port: running.control_port, host: 'serviceman.tail1234.ts.net:3701', path: '/api/v1/install.sh'});
        assert.strictEqual(answer.status, 200);
        assert.match(answer.headers['content-type'], /shellscript/);
        assert.match(answer.body, /^#!\/bin\/sh/);
        assert.match(answer.body, /url='http:\/\/serviceman\.tail1234\.ts\.net:3701'/, 'the machine dials back where it came from');
        assert.strictEqual(answer.body.includes(TOKEN), false, 'the installer holds no secret; the token is given to it');

        // A script it writes and does not make runnable is one nobody can run
        assert.match(answer.body, /chmod 755 .*bin\/restart/);

        // It is a script somebody will pipe into a shell, so it has to be a script that runs
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-install-')), 'install.sh');
        fs.writeFileSync(file, answer.body);
        const checked = child_process.spawnSync('sh', ['-n', file], {encoding: 'utf8'});
        assert.strictEqual(checked.status, 0, checked.stderr);

        // Without a token it refuses, and says which one it wants
        const empty = child_process.spawnSync('sh', [file], {encoding: 'utf8'});
        assert.strictEqual(empty.status, 1);
        assert.match(empty.stderr, /--token is required/);
    }
    finally {
        await running.close();
    }
});

test('the agent file is offered on the control port', async function () {
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}]);
    try {
        const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/agent.js'});
        assert.strictEqual(answer.status, 200);
        assert.match(answer.headers['content-disposition'], /serviceman-agent\.js/);
    }
    finally {
        await running.close();
    }
});

test('an agent from before machine shells is not asked for one, and its link survives', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const ws = require('ws');
    let client = null;
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        // What an old agent's hello looks like: no word about what it can be asked for
        delete remote.state.resources.can;

        client = new ws.WebSocket(`ws://127.0.0.1:${running.control_port}/api/v1/shell?remote=ui1`, {headers: {authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}});
        let note = '';
        client.on('message', function (data) {
            const message = JSON.parse(data.toString('utf8'));
            note = (message.type === 'note') ? message.text : note;
        });
        await new Promise(v => client.on('close', v));
        assert.match(note, /from before machine shells/);
        assert.strictEqual(remote.state.phase, 'online', 'the answer is a note, never a dead link');
    }
    finally {
        if (client !== null) {
            client.close();
        }
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('the updates of a machine are installed on a press, said line by line, and stopped on another', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--apt', path.join(__dirname, 'bin', 'apt-get')]);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.strictEqual(remote.state.apt.phase, 'idle', 'nothing installs itself');

        const began = await control(running, 'POST', '/api/v1/remotes/ui1/packages/upgrade', null);
        assert.strictEqual(began.status, 202);

        // The lines arrive while it runs; nobody waits for the end to read the first of them
        await wait_until(() => remote.state.apt.lines.some(v => /Unpacking demo-package-1 /.test(v)), 10000);
        assert.strictEqual(remote.state.apt.phase, 'running');
        assert.strictEqual(remote.state.apt.lines.some(v => /Reading package lists/.test(v)), true);

        // A second ask while one is running is refused rather than started beside it
        const again = await control(running, 'POST', '/api/v1/remotes/ui1/packages/upgrade', null);
        assert.strictEqual(again.status, 409);

        const stopped = await control(running, 'POST', '/api/v1/remotes/ui1/packages/cancel', null);
        assert.strictEqual(stopped.status, 200);
        assert.strictEqual(stopped.body.stopped, true);
        await wait_until(() => remote.state.apt.phase !== 'running', 15000);
        assert.strictEqual(remote.state.apt.phase, 'cancelled');
        assert.strictEqual(remote.state.apt.lines.some(v => /Aborted/.test(v)), true, 'what it said on its way out is in the log too');

        // And the whole of it is what the page reads back
        const read = await control(running, 'GET', '/api/v1/remotes/ui1/packages/upgrade', null);
        assert.strictEqual(read.body.phase, 'cancelled');
        assert.strictEqual(read.body.lines.length, remote.state.apt.lines.length);

        // Its stream says the same lines, and how it ended, for a page that follows it
        assert.strictEqual(began.body.url, `/api/v1/streams/${began.body.stream}`);
        assert.strictEqual(read.body.url, began.body.url);
        const streamed = await fetch_host({port: running.control_port, host: '127.0.0.1', path: began.body.url});
        const said = streamed.body.trim().split('\n').map(v => JSON.parse(v));
        assert.deepStrictEqual(said.slice(0, -1).map(v => v.text), remote.state.apt.lines);
        assert.strictEqual(said[said.length - 1].end, 'cancelled');

        // What is waiting is counted from apt when a run ends, not read from the file ubuntu
        // writes once a day — and the machine is asked for it at once, not in half a minute
        await wait_until(() => (remote.state.stats.updates !== null) && (remote.state.stats.updates.pending === 2), 10000);
        assert.strictEqual(remote.state.stats.updates.security, 1);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('the updates of several machines are installed at once, the one serviceman runs on last', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apt-all-'));
    const docker = await fake_docker_engine(path.join(dir, 'docker.sock'));
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}, {name: 'vps3', token: JOIN_TOKEN}]);
    const apt = ['--apt', path.join(__dirname, 'bin', 'apt-get')];
    const first = agent_start(running.control_port, TOKEN, apt);
    // vps2's Docker runs this serviceman: what docker says of its own container's id
    const second = agent_start(running.control_port, TOKEN2, apt, {SERVICEMAN_AGENT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-')), DOCKER_HOST: `unix://${path.join(dir, 'docker.sock')}`});
    running.app.own_container = docker.add('serviceman');
    try {
        const vps1 = running.app.remote_by_name.vps1;
        const vps2 = running.app.remote_by_name.vps2;
        await wait_until(() => (vps1.state.phase === 'online') && (vps2.state.phase === 'online'));

        // Nothing was asked yet, and nothing names what nobody can upgrade
        assert.deepStrictEqual((await control(running, 'GET', '/api/v1/apt-upgrade', null)).body, {batch: null});
        assert.strictEqual((await control(running, 'POST', '/api/v1/apt-upgrade', {remotes: []})).status, 400);
        const none = await control(running, 'POST', '/api/v1/apt-upgrade', {remotes: ['vps3', 'ghost']});
        assert.strictEqual(none.status, 409);
        assert.deepStrictEqual(none.body.skipped.map(v => v.name), ['vps3', 'ghost']);

        // A machine away is left out and said why; the one serviceman runs on waits its turn
        const began = await control(running, 'POST', '/api/v1/apt-upgrade', {remotes: ['vps1', 'vps2', 'vps3']});
        assert.strictEqual(began.status, 202);
        assert.deepStrictEqual(began.body.started, ['vps1', 'vps2']);
        assert.strictEqual(began.body.held, 'vps2');
        assert.deepStrictEqual(began.body.skipped, [{name: 'vps3', reason: 'vps3 is not connected'}]);
        await wait_until(() => vps1.state.apt.lines.some(v => /Unpacking demo-package-1 /.test(v)), 10000);
        assert.strictEqual(vps2.state.apt.phase, 'waiting');

        // A row per machine, with its last line rather than all of them
        const read = await control(running, 'GET', '/api/v1/apt-upgrade', null);
        assert.deepStrictEqual(read.body.batch.remotes.map(v => [v.name, v.phase]), [['vps1', 'running'], ['vps2', 'waiting']]);
        assert.match(read.body.batch.remotes[0].last_line, /Unpacking demo-package-\d+ /);
        assert.strictEqual(read.body.batch.ended_at, null);

        // A second ask while they run is refused rather than started beside it
        assert.strictEqual((await control(running, 'POST', '/api/v1/apt-upgrade', {remotes: ['vps1']})).status, 409);

        // The others ending is vps2's turn
        await control(running, 'POST', '/api/v1/remotes/vps1/packages/cancel', null);
        await wait_until(() => vps2.state.apt.lines.some(v => /Unpacking demo-package-1 /.test(v)), 15000);
        assert.strictEqual(vps1.state.apt.phase, 'cancelled');
        assert.strictEqual(vps2.state.apt.phase, 'running');

        // Cancel all stops what goes, and the batch is over
        const stopped = await control(running, 'POST', '/api/v1/apt-cancel', null);
        assert.deepStrictEqual(stopped.body.stopped, ['vps2']);
        await wait_until(() => running.app.apt_all.ended_at !== null, 15000);
        assert.strictEqual(vps2.state.apt.phase, 'cancelled');
    }
    finally {
        first.kill('SIGKILL');
        second.kill('SIGKILL');
        await running.close();
        await docker.close();
    }
});

test('a machine waiting its turn is not started once cancelled, and starts at once from its own page', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apt-all-'));
    const docker = await fake_docker_engine(path.join(dir, 'docker.sock'));
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}]);
    const apt = ['--apt', path.join(__dirname, 'bin', 'apt-get')];
    const first = agent_start(running.control_port, TOKEN, apt);
    const second = agent_start(running.control_port, TOKEN2, apt, {SERVICEMAN_AGENT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-')), DOCKER_HOST: `unix://${path.join(dir, 'docker.sock')}`});
    running.app.own_container = docker.add('serviceman');
    try {
        const vps1 = running.app.remote_by_name.vps1;
        const vps2 = running.app.remote_by_name.vps2;
        await wait_until(() => (vps1.state.phase === 'online') && (vps2.state.phase === 'online'));

        await control(running, 'POST', '/api/v1/apt-upgrade', {remotes: ['vps1', 'vps2']});
        assert.strictEqual(vps2.state.apt.phase, 'waiting');
        // Its own page cancels it like a run, and it is not started when its turn comes
        const cancelled = await control(running, 'POST', '/api/v1/remotes/vps2/packages/cancel', null);
        assert.strictEqual(cancelled.body.stopped, true);
        await control(running, 'POST', '/api/v1/remotes/vps1/packages/cancel', null);
        await wait_until(() => running.app.apt_all.ended_at !== null, 15000);
        assert.strictEqual(vps2.state.apt.phase, 'cancelled');
        assert.strictEqual(vps2.state.apt.lines.length, 0);

        // Install them on a waiting machine starts it now; its turn then finds it already run
        await control(running, 'POST', '/api/v1/apt-upgrade', {remotes: ['vps1', 'vps2']});
        assert.strictEqual((await control(running, 'POST', '/api/v1/remotes/vps2/packages/upgrade', null)).status, 202);
        await wait_until(() => vps2.state.apt.lines.some(v => /Unpacking demo-package-1 /.test(v)), 10000);
        await control(running, 'POST', '/api/v1/apt-cancel', null);
        await wait_until(() => running.app.apt_all.ended_at !== null, 15000);
        assert.strictEqual(vps2.state.apt.phase, 'cancelled');
    }
    finally {
        first.kill('SIGKILL');
        second.kill('SIGKILL');
        await running.close();
        await docker.close();
    }
});

test('a machine with a root half does its root work there, and says so', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-'));
    const socket = path.join(dir, 'root.sock');
    // The root half: the same file, dialling nowhere, answering that socket alone
    const root = child_process.spawn(process.execPath, [AGENT, '--role', 'root', '--root-socket', socket, '--apt', path.join(__dirname, 'bin', 'apt-get')], {stdio: ['ignore', 'pipe', 'pipe']});
    root.stdout.resume();
    root.stderr.resume();
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    // The session agent is given no apt of its own: what it cannot do itself, it asks for
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket]);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        await wait_until(() => remote.state.resources.can.includes('root'), 10000);

        const began = await control(running, 'POST', '/api/v1/remotes/ui1/packages/upgrade', null);
        assert.strictEqual(began.status, 202);
        // The lines come from the root half, through the session agent, over the link
        await wait_until(() => remote.state.apt.lines.some(v => /Unpacking demo-package-1 /.test(v)), 15000);
        const stopped = await control(running, 'POST', '/api/v1/remotes/ui1/packages/cancel', null);
        assert.strictEqual(stopped.body.stopped, true);
        await wait_until(() => remote.state.apt.phase !== 'running', 15000);
        assert.strictEqual(remote.state.apt.phase, 'cancelled');
    }
    finally {
        agent.kill('SIGKILL');
        root.kill('SIGKILL');
        await running.close();
    }
});

test('the firewall of a machine is read and changed through its root half', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-ufw-'));
    const socket = path.join(dir, 'root.sock');
    // The root half alone knows ufw: the session agent is given none, so every call goes there
    const ufw = path.join(__dirname, '..', 'modules', 'firewall', 'tests', 'fake_ufw.js');
    const root = child_process.spawn(process.execPath, [AGENT, '--role', 'root', '--root-socket', socket, '--ufw', ufw], {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {FAKE_UFW_STATE: path.join(dir, 'ufw.json')})});
    const said = [];
    root.stdout.on('data', v => said.push(v.toString('utf8')));
    root.stderr.resume();
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket, '--ufw', '/nowhere/ufw']);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        await wait_until(() => remote.state.resources.can.includes('root') && remote.state.resources.can.includes('ufw'), 10000);

        // The ports it listens on, beside its firewall: serviceman's own control port among them
        const ports = await control(running, 'GET', '/api/v1/remotes/ui1/firewall/ports', null);
        assert.strictEqual(ports.status, 200);
        assert.ok(ports.body.items.some(v => v.port === running.control_port));

        const empty = await control(running, 'GET', '/api/v1/remotes/ui1/firewall', null);
        assert.deepStrictEqual([empty.status, empty.body.installed, empty.body.active, empty.body.rules], [200, true, false, []]);
        const added = await control(running, 'POST', '/api/v1/remotes/ui1/firewall/rules', {action: 'allow', port: '22', proto: 'tcp'});
        assert.deepStrictEqual(added.body.rules.map(v => v.command), ['allow 22/tcp']);
        const on = await control(running, 'POST', '/api/v1/remotes/ui1/firewall/enable', null);
        assert.strictEqual(on.body.active, true);
        const gone = await control(running, 'POST', '/api/v1/remotes/ui1/firewall/rules/delete', {command: 'allow 22/tcp'});
        assert.deepStrictEqual([gone.body.rules, gone.body.undo], [[], {command: 'allow 22/tcp', at: 1}]);
        assert.match(said.join(''), /root_job_begin. method=ufw/);
        assert.ok(running.app.log_lines.some(v => /\[ufw_rule_deleted\] remote=ui1 rule="allow 22\/tcp"/.test(v)), 'the host says what was changed');

        // What is not a rule of ufw is refused by the agent itself
        const reset = await remote_call(running.app, remote, 'ufw', {argv: ['--force', 'reset']}, 5000).catch(e => e);
        assert.match(reset.message, /ufw is asked only for/);
    }
    finally {
        agent.kill('SIGKILL');
        root.kill('SIGKILL');
        await running.close();
    }
});

test('the ports of a machine are read by its root half, so what holds each one is named', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-ports-'));
    const socket = path.join(dir, 'root.sock');
    const root = child_process.spawn(process.execPath, [AGENT, '--role', 'root', '--root-socket', socket], {stdio: ['ignore', 'pipe', 'pipe']});
    const said = [];
    root.stdout.on('data', v => said.push(v.toString('utf8')));
    root.stderr.resume();
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket]);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        await wait_until(() => remote.state.resources.can.includes('root'), 10000);

        // ss names the holder of a socket only to whoever may read it, so the question goes
        // to the half that may read every one of them
        const ports = await machine_read(running, 'ui1', 'ports');
        assert.strictEqual(ports.status, 200);
        const found = ports.body.items.find(v => v.port === running.control_port);
        assert.notStrictEqual(found, undefined);
        assert.match(said.join(''), /root_job_begin. method=port_list/);
    }
    finally {
        agent.kill('SIGKILL');
        root.kill('SIGKILL');
        await running.close();
    }
});

// The minute after an update: the session agent is new, its root half not yet. Asking sudo
// then would answer "give it a root agent" on a machine that has one.
test('a root half from before the firewall says it is updating, not that the machine has none', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-old-ufw-'));
    const socket = path.join(dir, 'root.sock');
    const root = net.createServer(function (client) {
        client.on('data', function (chunk) {
            const method = JSON.parse(chunk.toString('utf8')).method;
            client.write(`${JSON.stringify({type: 'reply', ok: false, error: `the root agent knows nothing called ${JSON.stringify(method)}`})}\n`);
        });
    });
    await new Promise(v => root.listen(socket, v));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    // A sudo that asks for a password, as on a machine whose sudoers line names nothing
    const sudo = path.join(dir, 'ufw-sudo');
    fs.writeFileSync(sudo, '#!/bin/sh\necho "sudo: a password is required" >&2\nexit 1\n', {mode: 0o755});
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket, '--ufw', sudo]);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        const answer = await control(running, 'GET', '/api/v1/remotes/ui1/firewall', null);
        assert.strictEqual(answer.status, 502);
        assert.match(answer.body.error, /the root half on this machine is from before the firewall; it updates itself within half a minute/);
    }
    finally {
        agent.kill('SIGKILL');
        root.close();
        await running.close();
    }
});

test('a root half from before the port list is asked, refuses, and the ports come back anyway', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-old-'));
    const socket = path.join(dir, 'root.sock');
    // A root half of the age the machines are before an update: it answers, and it has never
    // heard of this method
    const asked = [];
    const root = net.createServer(function (client) {
        client.on('data', function (chunk) {
            asked.push(JSON.parse(chunk.toString('utf8')).method);
            client.write(`${JSON.stringify({type: 'reply', ok: false, error: 'the root agent knows nothing called "port_list"'})}\n`);
        });
    });
    await new Promise(v => root.listen(socket, v));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket]);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        const ports = await machine_read(running, 'ui1', 'ports');
        assert.strictEqual(ports.status, 200);
        assert.strictEqual(asked.includes('port_list'), true, 'the root half was asked first');
        // What the agent may see in its own session, which is fewer names and not an error
        assert.notStrictEqual(ports.body.items.find(v => v.port === running.control_port), undefined);
    }
    finally {
        agent.kill('SIGKILL');
        root.close();
        await running.close();
    }
});

test('a root half installed while the machine is connected is noticed without a restart', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-later-'));
    const socket = path.join(dir, 'root.sock');
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket], {SERVICEMAN_STATS_MS: '200'});
    let root = null;
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.strictEqual(remote.state.resources.can.includes('root'), false, 'nothing answers that socket yet');

        // The root half arrives a minute after the agent did, which is how it happens: bin/update
        // first, bin/install-root after
        root = child_process.spawn(process.execPath, [AGENT, '--role', 'root', '--root-socket', socket], {stdio: ['ignore', 'pipe', 'pipe']});
        root.stdout.resume();
        root.stderr.resume();

        await wait_until(() => remote.state.resources.can.includes('root'), 10000);
    }
    finally {
        agent.kill('SIGKILL');
        if (root !== null) {
            root.kill('SIGKILL');
        }
        await running.close();
    }
});

test('a machine says it is going, and the host writes down why instead of waiting out the silence', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, [], {SERVICEMAN_BEAT_MS: '200'});
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        // It is talking by itself: the host hears something without asking for anything
        const heard = remote.state.heard_at;
        await wait_until(() => remote.state.heard_at > heard, 5000);

        // systemd stops a unit with SIGTERM, and that is what a shutdown looks like from there
        agent.kill('SIGTERM');
        await wait_until(() => remote.state.phase === 'offline', 10000);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_leaving\] remote=ui1 reason=stopping/.test(v)), true);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_offline\] remote=ui1 .*reason="it said it was stopping"/.test(v)), true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a machine taken out of the config is told so when it dials in, and stops dialling', async function () {
    const running = await serviceman_start_file({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'ui1', token: TOKEN}],
        services: [],
    });
    try {
        const gone = await control(running, 'DELETE', '/api/v1/remotes/ui1', null);
        assert.strictEqual(gone.status, 200);

        // The machine was asleep when it happened, and dials in with the token it still holds
        const said = [];
        const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${running.control_port}`, '--token', TOKEN], {stdio: ['ignore', 'pipe', 'pipe']});
        agent.stdout.on('data', v => said.push(v.toString('utf8')));
        agent.stderr.on('data', v => said.push(v.toString('utf8')));
        const code = await Promise.race([
            new Promise(v => agent.on('close', v)),
            new Promise(v => setTimeout(() => v('never'), 15000)),
        ]);
        agent.kill('SIGKILL');

        assert.strictEqual(code, 0, 'it stopped instead of dialling again');
        const text = said.join('');
        assert.match(text, /was taken out of the config on this host/);
        // It runs from the repo here, and nothing will delete a checkout
        assert.match(text, /agent_uninstall_refused/);
        assert.match(text, /is not a bundled agent/);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_refused\] remote=ui1 .*reason=removed/.test(v)), true);
    }
    finally {
        await running.close();
    }
});

test('the agent of a machine is fetched again on a press, and the file goes with the ask', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        // This one runs from the repo, so it refuses — and says why, which is the answer the
        // page shows rather than a silent nothing
        const asked = await control(running, 'POST', '/api/v1/remotes/ui1/agent-update', null);
        assert.strictEqual(asked.status, 502);
        assert.match(asked.body.error, /is not a bundled agent — this one runs from the repo/);
        assert.match(remote.state.update_refused, /is not a bundled agent/);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_update_asked\].*asked="by hand"/.test(v)), true);

        // And the page is told which agent this host serves, so it knows what behind means
        const state = await state_read(running);
        assert.strictEqual((typeof state.agent_built === 'string') || (state.agent_built === null), true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a root half left behind by an update is asked to step aside for the new file', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-old-'));
    const socket = path.join(dir, 'root.sock');
    // A root half from before the update, kept up by something — which is what systemd says
    // about itself by name
    const root = child_process.spawn(process.execPath, [AGENT, '--role', 'root', '--root-socket', socket], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, {SERVICEMAN_AGENT_BUILT: '2020-01-01T00:00:00.000Z', INVOCATION_ID: 'test'}),
    });
    root.stdout.resume();
    root.stderr.resume();
    const gone = new Promise(v => root.on('close', v));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket], {SERVICEMAN_STATS_MS: '200'});
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');
        // It ends by itself; the system that keeps it up starts the new one
        const code = await Promise.race([gone, new Promise(v => setTimeout(() => v('never'), 15000))]);
        assert.strictEqual(code, 0, 'the old root half stopped for the new file');
    }
    finally {
        agent.kill('SIGKILL');
        root.kill('SIGKILL');
        await running.close();
    }
});

test('a root half nobody keeps up is left alone, and said out loud', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-hand-'));
    const socket = path.join(dir, 'root.sock');
    // The same old build, this one run by hand: stopping it would leave the machine with none
    const env = Object.assign({}, process.env, {SERVICEMAN_AGENT_BUILT: '2020-01-01T00:00:00.000Z', SERVICEMAN_ROOT_SUPERVISED: 'no'});
    delete env.INVOCATION_ID;
    const root = child_process.spawn(process.execPath, [AGENT, '--role', 'root', '--root-socket', socket], {stdio: ['ignore', 'pipe', 'pipe'], env});
    root.stdout.resume();
    root.stderr.resume();
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', socket], {SERVICEMAN_STATS_MS: '200'});
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        await wait_until(() => running.app.log_lines.some(v => /root_update_by_hand/.test(v)), 15000);
        assert.strictEqual(root.exitCode, null, 'it is still running — nothing would start it again');
        assert.strictEqual(remote.state.resources.can.includes('root'), true, 'and it still does the root work');
    }
    finally {
        agent.kill('SIGKILL');
        root.kill('SIGKILL');
        await running.close();
    }
});

test('a machine with no root half says so, and its root work stays in its own session', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--root-socket', '/nowhere/serviceman-root.sock']);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.strictEqual(remote.state.resources.can.includes('root'), false);
        assert.strictEqual(remote.state.resources.can.includes('apt'), true, 'it can still be asked; it is sudo over there that answers');
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('the screen of a machine is asked for by hand, and comes back as a png', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    // A capture line of its own is what a machine whose wayland allows nothing else is given
    const shot = `${process.execPath} ${path.join(__dirname, 'fixtures', 'shot.js')} %f`;
    const agent = agent_start(running.control_port, TOKEN, ['--screenshot', shot]);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/remotes/ui1/screenshot', method: 'POST'});
        assert.strictEqual(answer.status, 200);
        assert.match(answer.headers['content-type'], /image\/png/);
        assert.strictEqual(Buffer.from(answer.body, 'binary').subarray(1, 4).toString('utf8'), 'PNG');
        assert.strictEqual(running.app.log_lines.some(v => /\[screenshot_taken\] remote=ui1 method="the --screenshot line"/.test(v)), true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a picture the size of a postage stamp is not a screen, and is not answered as one', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    // What `import` does on a wayland session: the X root window it grabs has nothing in it
    const blank = `${process.execPath} -e "require('fs').writeFileSync(process.argv[1], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQkdMAAACkAFt2Ll/jAAAAAElFTkSuQmCC', 'base64'))" %f`;
    const agent = agent_start(running.control_port, TOKEN, ['--screenshot', blank]);
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');

        const answer = await control(running, 'POST', '/api/v1/remotes/ui1/screenshot', null);
        assert.strictEqual(answer.status, 502);
        assert.match(answer.body.tried[0], /wrote a 1×1 picture, which is not this screen/);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a screenful of one flat colour is a screen that is off, and is not answered as a picture', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    // What `import -window root` gives on a machine whose screen is asleep: the right size,
    // and nothing drawn on it
    const blank = `${process.execPath} ${path.join(__dirname, 'fixtures', 'shot.js')} %f --blank`;
    const agent = agent_start(running.control_port, TOKEN, ['--screenshot', blank]);
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');

        const answer = await control(running, 'POST', '/api/v1/remotes/ui1/screenshot', null);
        assert.strictEqual(answer.status, 502);
        assert.match(answer.body.tried[0], /picture of one flat colour — the screen is off or locked/);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a machine that will not take a picture says what every way it tried answered', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, ['--screenshot', 'false %f']);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        const answer = await control(running, 'POST', '/api/v1/remotes/ui1/screenshot', null);
        assert.strictEqual(answer.status, 502);
        assert.match(answer.body.error, /no way to take a picture of the screen on ui1/);
        assert.strictEqual(answer.body.tried.length, 1, 'a line of its own is tried alone');
        assert.match(answer.body.tried[0], /^the --screenshot line: /);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a machine shell runs as the agent user, in a real pty', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const ws = require('ws');
    let client = null;
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        client = new ws.WebSocket(`ws://127.0.0.1:${running.control_port}/api/v1/shell?remote=ui1`, {headers: {authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}});
        let text = '';
        client.on('message', function (data) {
            text += data.toString('utf8');
        });
        await new Promise(v => client.on('open', v));
        client.send(JSON.stringify({type: 'input', data: 'tty; echo who_$(whoami)\r'}));
        // A pty answers with a pts device; a pipe would say "not a tty"
        await wait_until(() => text.includes('/dev/pts/'), 8000);
        await wait_until(() => text.includes(`who_${os.userInfo().username}`), 8000);
    }
    finally {
        if (client !== null) {
            client.close();
        }
        agent.kill('SIGKILL');
        await running.close();
    }
});

// The client a program like Visual Notes copies from demos/terminal-client: the same
// terminals as the Shell tab, joined from outside the page. No tmux: a holder process the agent
// leaves on the machine keeps the shell and what it printed, through a restart of the agent.
test('a terminal kept on a machine outlives its page and its agent, and its tab ends it', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    let agent = agent_start(running.control_port, TOKEN);
    const url = `http://127.0.0.1:${running.control_port}`;
    const remote = running.app.remote_by_name.ui1;
    try {
        await wait_until(() => remote.state.phase === 'online');
        assert.deepStrictEqual((await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items, []);

        const first = terminal_connect({url, remote: 'ui1', name: 'work', cols: 100, rows: 30, token: fetch_host.OWNER_TOKEN});
        let screen = '';
        first.on('data', v => screen += v.toString('utf8'));
        const note = await new Promise(v => first.on('note', v));
        assert.match(note, /the terminal work on ui1/);
        first.write('echo kept-$((40+2)); stty size\r');
        await wait_until(() => screen.includes('kept-42'), 8000);
        await wait_until(() => screen.includes('30 100'), 8000);
        const listed = (await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items;
        assert.deepStrictEqual(listed.map(v => [v.name, v.attached]), [['work', 1]]);
        assert.match(listed[0].command, /^socat -,raw,echo=0 UNIX-CONNECT:.+\/terminals\/work\.sock$/);

        // Left, and the agent killed and started again: the terminal is still there, and joined
        // again it hands back what it printed, for the page to scroll through
        first.close();
        await new Promise(v => first.on('close', v));
        agent.kill('SIGKILL');
        await wait_until(() => remote.state.phase !== 'online');
        agent = agent_start(running.control_port, TOKEN);
        await wait_until(() => remote.state.phase === 'online');
        assert.deepStrictEqual((await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items.map(v => [v.name, v.attached]), [['work', 0]]);
        const second = terminal_connect({url, remote: 'ui1', name: 'work', token: fetch_host.OWNER_TOKEN});
        let again = '';
        second.on('data', v => again += v.toString('utf8'));
        await wait_until(() => again.includes('kept-42'), 8000);

        // Its tab's ×: the shell is hung up, whoever had it open sees it close, and it is gone
        const closed = new Promise(v => second.on('close', v));
        const ended = await control_fetch(`${url}/api/v1/remotes/ui1/terminals/work/end`, {method: 'POST'});
        assert.deepStrictEqual(await ended.json(), {ended: true});
        await closed;
        assert.deepStrictEqual((await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items, []);
    }
    finally {
        await control_fetch(`${url}/api/v1/remotes/ui1/terminals/work/end`, {method: 'POST'}).catch(() => null);
        agent.kill('SIGKILL');
        await running.close();
    }
});

// What a program like Visual Notes needs beside joining: make a terminal, see the folder its
// shell is in, stop what runs in it, and kill it
test('a terminal is made without joining it, says its folder, and takes signals', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const url = `http://127.0.0.1:${running.control_port}`;
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');
        assert.deepStrictEqual(await post('', {}), {name: '1', created: true});
        assert.deepStrictEqual(await post('', {name: '1'}), {name: '1', created: false});
        const made = (await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items;
        assert.deepStrictEqual(made.map(v => [v.name, v.attached, v.cwd]), [['1', 0, os.homedir()]]);

        const terminal = terminal_connect({url, remote: 'ui1', name: '1', token: fetch_host.OWNER_TOKEN});
        let screen = '';
        terminal.on('data', v => screen += v.toString('utf8'));
        await new Promise(v => terminal.on('open', v));
        terminal.write('cd /tmp\r');
        let cwd = null;
        for (let i = 0; (i < 80) && (cwd !== '/tmp'); i++) {
            await timers.setTimeout(100);
            cwd = (await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items[0].cwd;
        }
        assert.strictEqual(cwd, '/tmp', 'the folder follows cd');

        // SIGINT to the foreground stops the sleep, as Ctrl-C would: the shell answers again in
        // well under the 30 seconds it would have slept
        terminal.write('sleep 30\r');
        await timers.setTimeout(500);
        const time0 = Date.now();
        const stopped = await post('/1/signal', {signal: 'SIGINT', to: 'foreground'});
        assert.strictEqual(stopped.to, 'foreground');
        terminal.write('echo after-$((20+1))\r');
        await wait_until(() => screen.includes('after-21'), 5000);
        assert.ok(Date.now() - time0 < 5000);

        // SIGWINCH to the foreground is how a program is told to draw itself again
        terminal.write(`sh -c 'trap "echo winch-\\$((40+2)); exit" WINCH; while :; do sleep 0.1; done'\r`);
        await timers.setTimeout(500);
        await post('/1/signal', {signal: 'SIGWINCH', to: 'foreground'});
        await wait_until(() => screen.includes('winch-42'), 5000);

        assert.match((await control_fetch(`${url}/api/v1/remotes/ui1/terminals/1/signal`, {method: 'POST', body: JSON.stringify({signal: 'SIGNOPE'})}).then(v => v.json())).error, /a signal is one of/);

        // SIGKILL to the shell ends the terminal: whoever had it open sees it close
        const closed = new Promise(v => terminal.on('close', v));
        await post('/1/signal', {signal: 'SIGKILL'});
        await closed;
        assert.deepStrictEqual((await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items, []);
    }
    finally {
        await control_fetch(`${url}/api/v1/remotes/ui1/terminals/1/end`, {method: 'POST'}).catch(() => null);
        agent.kill('SIGKILL');
        await running.close();
    }

    async function post(path, body) {
        const answer = await control_fetch(`${url}/api/v1/remotes/ui1/terminals${path}`, {method: 'POST', body: JSON.stringify(body)});
        return await answer.json();
    }
});

// A program that makes a terminal for its own work gives it its variables and its folder; an
// agent from before them is refused, never left to start the shell without them
test('a terminal is made with the variables and the folder asked for', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const url = `http://127.0.0.1:${running.control_port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-term-cwd-'));
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.deepStrictEqual(await post({name: 'env', env: {WORK_KEY: 'k-41', TERM: 'xterm-256color'}, cwd: dir}), {status: 200, body: {name: 'env', created: true}});
        assert.deepStrictEqual((await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items.map(v => [v.name, v.cwd]), [['env', dir]]);

        const terminal = terminal_connect({url, remote: 'ui1', name: 'env', token: fetch_host.OWNER_TOKEN});
        let screen = '';
        terminal.on('data', v => screen += v.toString('utf8'));
        await new Promise(v => terminal.on('open', v));
        terminal.write('echo "key=$WORK_KEY at=$(pwd)"\r');
        await wait_until(() => screen.includes(`key=k-41 at=${dir}`), 5000);
        terminal.close();

        // Running already, it keeps what it was made with
        assert.deepStrictEqual(await post({name: 'env', env: {WORK_KEY: 'other'}}), {status: 200, body: {name: 'env', created: false}});

        // A value is never repeated in a refusal: it may be a secret
        const bad_name = await post({name: 'bad', env: {'1X': 'secret-value'}});
        assert.strictEqual(bad_name.status, 400);
        assert.match(bad_name.body.error, /a variable's name is letters, digits and _/);
        const bad_value = await post({name: 'bad', env: {X: 41}});
        assert.strictEqual(bad_value.status, 400);
        assert.doesNotMatch(JSON.stringify(bad_value.body), /41/);
        const no_folder = await post({name: 'bad', cwd: path.join(dir, 'none')});
        assert.strictEqual(no_folder.status, 400);
        assert.match(no_folder.body.error, /no folder .+\/none on this machine/);
        assert.deepStrictEqual((await terminals_list({url, remote: 'ui1', token: fetch_host.OWNER_TOKEN})).items.map(v => v.name), ['env']);

        // What an older agent says it can do: no word about env and cwd
        remote.state.resources.can = remote.state.resources.can.filter(v => v !== 'term_env');
        const old = await post({name: 'old', cwd: dir});
        assert.strictEqual(old.status, 400);
        assert.match(old.body.error, /from before env and cwd/);
        assert.deepStrictEqual(await post({name: 'old'}), {status: 200, body: {name: 'old', created: true}}, 'without them it is made as before');
    }
    finally {
        for (const name of ['env', 'old']) {
            await control_fetch(`${url}/api/v1/remotes/ui1/terminals/${name}/end`, {method: 'POST'}).catch(() => null);
        }
        agent.kill('SIGKILL');
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }

    async function post(body) {
        const answer = await control_fetch(`${url}/api/v1/remotes/ui1/terminals`, {method: 'POST', body: JSON.stringify(body)});
        return {status: answer.status, body: await answer.json()};
    }
});

// What a program keeping a copy of a folder needs: to hear what changes in it on the machine,
// through serviceman, without asking again and again
test('a folder on a machine is watched through serviceman, and what changes in it comes as events', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const url = `http://127.0.0.1:${running.control_port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-watch-'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    const stop = new AbortController();
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');
        assert.ok(running.app.remote_by_name.ui1.state.resources.can.includes('fs_watch'));
        const answer = await control_fetch(`${url}/api/v1/remotes/ui1/fs/watch?path=${encodeURIComponent(dir)}&tree=1&skip=node_modules`, {signal: stop.signal});
        assert.deepStrictEqual([answer.status, answer.headers.get('content-type')], [200, 'text/event-stream; charset=utf-8']);
        const events = [];
        const reading = (async function () {
            let rest = '';
            for await (const chunk of answer.body) {
                const parts = (rest + Buffer.from(chunk).toString('utf8')).split('\n\n');
                rest = parts.pop();
                events.push(...parts.map(v => JSON.parse(v.split('\ndata: ')[1])));
            }
        })().catch(() => null);
        await wait_until(() => events.length > 0);
        assert.deepStrictEqual(events[0], {type: 'ready', path: dir, tree: true, skip: ['node_modules']});

        fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'hello');
        await wait_until(() => events.some(v => v.path === 'src/a.txt'), 5000);
        fs.rmSync(path.join(dir, 'src', 'a.txt'));
        await wait_until(() => events.some(v => v.type === 'removed'), 5000);
        assert.deepStrictEqual(events.slice(1).map(v => `${v.type} ${v.path} ${v.kind} ${v.size}`), ['created src dir null', 'created src/a.txt file 5', 'removed src/a.txt file null']);

        // The page goes, and the host says how long the folder was watched
        stop.abort();
        await reading;
        await wait_until(() => running.app.log_lines.some(v => /\[folder_watched\] remote=ui1 path=.+ tree=true events=3 ms=\d+/.test(v)));

        const missing = await control_fetch(`${url}/api/v1/remotes/ui1/fs/watch?path=${encodeURIComponent(path.join(dir, 'nothing'))}`);
        assert.deepStrictEqual([missing.status, /ENOENT/.test((await missing.json()).error)], [502, true]);
    }
    finally {
        stop.abort();
        agent.kill('SIGKILL');
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// What a program copying a folder to a machine needs first: what is already there, all of it,
// in one request rather than one a folder
test('a whole tree of a machine comes in one request through serviceman, each hash read once', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const url = `http://127.0.0.1:${running.control_port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-tree-'));
    for (let i = 0; i < 3000; i++) {
        fs.mkdirSync(path.join(dir, `d${i}`));
        fs.writeFileSync(path.join(dir, `d${i}`, 'f.txt'), 'x'.repeat(i));
    }
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'skipped.js'), 'x');
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.ok(remote.state.resources.can.includes('fs_tree_typed'));
        const ask = `${url}/api/v1/remotes/ui1/fs?path=${encodeURIComponent(dir)}&tree=1&skip=node_modules`;
        // How many files the agent read for a hash on its last walk, as the host logged it
        async function hashed_last(count) {
            await wait_until(() => running.app.log_lines.some(v => new RegExp(`\\[tree_listed\\] remote=ui1 path=.+ hash=true names=6000 hashed=${count} ms=\\d+`).test(v)));
            running.app.log_lines.length = 0;
        }

        // One request: every folder and file, sizes and times as stat says, end last
        const listed = await (await control_fetch(ask)).json();
        assert.deepStrictEqual([listed.length, listed.at(-1)], [6001, {type: 'end'}]);
        for (const item of listed.slice(0, -1)) {
            const stat = fs.lstatSync(path.join(dir, item.path));
            assert.deepStrictEqual(Object.keys(item), ['type', 'path', 'size', 'mtime_ms']);
            assert.deepStrictEqual([item.type, item.size, item.mtime_ms], [stat.isDirectory() ? 'dir' : 'file', stat.isDirectory() ? null : stat.size, Math.round(stat.mtimeMs)]);
        }
        assert.deepStrictEqual([listed.filter(v => v.type === 'dir').length, listed.some(v => String(v.path).startsWith('node_modules'))], [3000, false]);

        // With hashes: each one sha256sum's, and a second walk reads no file again
        running.app.log_lines.length = 0;
        const hashed = await (await control_fetch(`${ask}&hash=sha256`)).json();
        const summed = child_process.execFileSync('find', [dir, '-name', 'f.txt', '-exec', 'sha256sum', '{}', '+'], {encoding: 'utf8', maxBuffer: 64*1024*1024});
        const by_path = new Map(summed.trim().split('\n').map(v => [path.relative(dir, v.slice(66)), v.slice(0, 64)]));
        assert.strictEqual(by_path.size, 3000);
        assert.strictEqual(hashed.filter(v => v.type === 'file').every(v => (v.sha256 === by_path.get(v.path))), true);
        await hashed_last(3000);
        const again = await (await control_fetch(`${ask}&hash=sha256`)).json();
        assert.deepStrictEqual(JSON.stringify(again), JSON.stringify(hashed));
        await hashed_last(0);
        fs.writeFileSync(path.join(dir, 'd7', 'f.txt'), 'changed');
        const changed = await (await control_fetch(`${ask}&hash=sha256`)).json();
        assert.strictEqual(changed.find(v => v.path === 'd7/f.txt').sha256, crypto.createHash('sha256').update('changed').digest('hex'));
        await hashed_last(1);

        // The same walk as events: one plain data line an object, the very objects of the JSON
        const answer = await control_fetch(ask, {headers: {accept: 'text/event-stream'}});
        assert.deepStrictEqual([answer.status, answer.headers.get('content-type')], [200, 'text/event-stream; charset=utf-8']);
        const sent = (await answer.text()).split('\n\n').filter(v => v.startsWith('data: ')).map(v => v.slice(6));
        assert.deepStrictEqual([sent.length, sent.at(-1)], [6001, '{"type":"end"}']);
        assert.deepStrictEqual(sent.slice(0, -1).sort(), (await (await control_fetch(ask)).json()).slice(0, -1).map(v => JSON.stringify(v)).sort());

        const missing = await control_fetch(`${url}/api/v1/remotes/ui1/fs?path=${encodeURIComponent(path.join(dir, 'nothing'))}&tree=1`);
        assert.deepStrictEqual([missing.status, /ENOENT/.test((await missing.json()).error)], [502, true]);

        // An agent from before the typed tree is told to update, not asked
        remote.state.resources.can = remote.state.resources.can.filter(v => v !== 'fs_tree_typed');
        const old = await control_fetch(ask);
        assert.deepStrictEqual([old.status, /from before a whole tree is listed by type/.test((await old.json()).error)], [400, true]);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// htop and bash ask the terminal questions (its kind, its colours, its modes). Replayed on a
// join, xterm would answer them again into the shell, where they show as typed text: the
// history comes back without them, and with everything else
test('a terminal joined again gets its history without the questions programs asked', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const url = `http://127.0.0.1:${running.control_port}`;
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');
        const first = terminal_connect({url, remote: 'ui1', name: 'asks', token: fetch_host.OWNER_TOKEN});
        let screen = '';
        first.on('data', v => screen += v.toString('latin1'));
        await new Promise(v => first.on('open', v));
        first.write("printf '\\033[c\\033]11;?\\007\\033[01;32mgreen-%s\\n' marker\r");
        await wait_until(() => screen.includes('green-marker'), 5000);
        assert.ok(screen.includes('\x1b[c') && screen.includes('\x1b]11;?\x07'), 'asked live, the questions reach the terminal');
        first.close();
        await new Promise(v => first.on('close', v));

        const second = terminal_connect({url, remote: 'ui1', name: 'asks', token: fetch_host.OWNER_TOKEN});
        let replay = '';
        second.on('data', v => replay += v.toString('latin1'));
        await wait_until(() => replay.includes('green-marker'), 5000);
        assert.strictEqual(replay.includes('\x1b[c'), false);
        assert.strictEqual(replay.includes('\x1b]11;?'), false);
        assert.ok(replay.includes('\x1b[01;32mgreen-marker'), 'colours stay');
        second.close();
    }
    finally {
        await control_fetch(`${url}/api/v1/remotes/ui1/terminals/asks/end`, {method: 'POST'}).catch(() => null);
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a file from the page lands on that machine, under the name it was sent with', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-copy-'));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        // A folder that is not there is made on the way, and what comes back is where the file
        // landed on that machine
        const landed = await file_copy(running, 'ui1', path.join(dir, 'notes'), 'hello.txt', 'hello\n');
        assert.strictEqual(landed.status, 200);
        assert.strictEqual(landed.body.path, path.join(dir, 'notes', 'hello.txt'));
        assert.strictEqual(landed.body.bytes, 6);
        assert.strictEqual(landed.body.replaced, false);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'notes', 'hello.txt'), 'utf8'), 'hello\n');
        // The name it was written under while it was on its way is gone with the copy
        assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'notes')), ['hello.txt']);
        assert.strictEqual(running.app.log_lines.some(v => /\[file_copied\] remote=ui1 /.test(v)), true);

        // One bigger than the window both ends hold open, so the bytes go over in pieces and
        // the credit comes back for each of them
        const long = 'x'.repeat(2*1024*1024);
        const big = await file_copy(running, 'ui1', path.join(dir, 'notes'), 'big.txt', long);
        assert.strictEqual(big.body.bytes, long.length);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'notes', 'big.txt'), 'utf8'), long);

        // The same name again is the file that is there now, and the answer says what it was
        const again = await file_copy(running, 'ui1', path.join(dir, 'notes'), 'hello.txt', 'other\n');
        assert.strictEqual(again.body.replaced, true);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'notes', 'hello.txt'), 'utf8'), 'other\n');

        // A file written over keeps what it was: a script stays runnable, and a link stays a
        // link, the text landing in the file it points at — an edit saved from the page
        fs.writeFileSync(path.join(dir, 'notes', 'run.sh'), 'echo one\n', {mode: 0o755});
        await file_copy(running, 'ui1', path.join(dir, 'notes'), 'run.sh', 'echo two\n');
        assert.strictEqual(fs.statSync(path.join(dir, 'notes', 'run.sh')).mode & 0o777, 0o755);
        fs.symlinkSync('hello.txt', path.join(dir, 'notes', 'link.txt'));
        await file_copy(running, 'ui1', path.join(dir, 'notes'), 'link.txt', 'through the link\n');
        assert.strictEqual(fs.lstatSync(path.join(dir, 'notes', 'link.txt')).isSymbolicLink(), true);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'notes', 'hello.txt'), 'utf8'), 'through the link\n');

        // A name that would walk out of the folder it was sent to is not a name at all
        const wrong = await file_copy(running, 'ui1', dir, '../escaped.txt', 'no\n');
        assert.strictEqual(wrong.status, 400);
        assert.match(wrong.body.error, /a file lands under a name of its own/);
        assert.strictEqual(fs.existsSync(path.join(dir, '..', 'escaped.txt')), false);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a file is copied from one machine to another in parts, and carries on when a link drops', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-transfer-'));
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}]);
    const first = agent_start(running.control_port, TOKEN);
    let second = agent_start(running.control_port, TOKEN2, [], {SERVICEMAN_AGENT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'))});
    try {
        await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'online');
        await wait_until(() => running.app.remote_by_name.vps2.state.phase === 'online');
        fs.mkdirSync(path.join(dir, 'a'));
        const film = crypto.randomBytes(80*1024*1024);
        fs.writeFileSync(path.join(dir, 'a', 'film.bin'), film);

        // A name that is not a machine, or no file, is not a copy
        assert.strictEqual((await control(running, 'POST', '/api/v1/transfers', {from: {disk: 'nowhere', path: '/x'}, to: {disk: 'vps2', dir}})).status, 400);
        const started = await control(running, 'POST', '/api/v1/transfers', {from: {disk: 'vps1', path: path.join(dir, 'a', 'film.bin')}, to: {disk: 'vps2', dir: path.join(dir, 'b')}});
        assert.strictEqual(started.status, 200);
        const id = started.body.id;

        // The machine it goes to drops once a part is in; the copy waits, and carries on from
        // where that machine says it stands once it is back
        await wait_until(() => item_of(running, id).received > 0, 20000);
        second.kill('SIGKILL');
        await wait_until(() => item_of(running, id).phase === 'retrying', 20000);
        const kept = item_of(running, id).received;
        second = agent_start(running.control_port, TOKEN2, [], {SERVICEMAN_AGENT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'))});
        const picked = [];
        await wait_until(function () {
            if (item_of(running, id).phase === 'copying') {
                picked.push(item_of(running, id).received);
            }
            return item_of(running, id).phase === 'ok';
        }, 60000);
        const done = item_of(running, id);
        assert.strictEqual(done.size, film.length);
        assert.ok((kept > 0) && (picked.length > 0) && (Math.min(...picked) >= kept), 'the copy carried on rather than starting over');
        assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(dir, 'b', 'film.bin')), film), 0);
        assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'b')), ['film.bin']);
        assert.strictEqual(running.app.log_lines.some(v => /\[transfer_end_ok\] /.test(v)), true);

        // A file that is not there is an error at once, not a copy that waits forever
        const missing = await control(running, 'POST', '/api/v1/transfers', {from: {disk: 'vps1', path: path.join(dir, 'a', 'none.bin')}, to: {disk: 'vps2', dir: path.join(dir, 'b')}});
        await wait_until(() => item_of(running, missing.body.id).phase === 'error', 20000);
        assert.match(item_of(running, missing.body.id).said, /ENOENT/);
    }
    finally {
        first.kill('SIGKILL');
        second.kill('SIGKILL');
        await running.close();
    }
});

test('a folder is copied from one machine to another whole: files at any depth, empty folders, run bits and links', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-folder-'));
    const running = await serviceman_start([{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}]);
    const first = agent_start(running.control_port, TOKEN);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-home-'));
    const second = agent_start(running.control_port, TOKEN2, [], {SERVICEMAN_AGENT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-')), HOME: home});
    try {
        await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'online');
        await wait_until(() => running.app.remote_by_name.vps2.state.phase === 'online');
        await wait_until(() => running.app.remote_by_name.vps2.state.resources.can.includes('folder_copy'));
        const from = path.join(dir, 'a', 'proj');
        fs.mkdirSync(path.join(from, 'src', 'deep'), {recursive: true});
        fs.mkdirSync(path.join(from, 'empty', 'inner'), {recursive: true});
        fs.writeFileSync(path.join(from, 'src', 'deep', 'x.js'), 'x');
        fs.writeFileSync(path.join(from, 'run.sh'), 'echo hi\n', {mode: 0o755});
        fs.writeFileSync(path.join(from, 'empty.txt'), '');
        fs.writeFileSync(path.join(from, '-rf'), 'a name like an option');
        fs.writeFileSync(path.join(from, 'привет.txt'), 'hi');
        const film = crypto.randomBytes(12*1024*1024);
        fs.writeFileSync(path.join(from, 'film.bin'), film);
        fs.symlinkSync('src', path.join(from, 'lib'));
        for (let i = 0; i < 1200; i++) {
            fs.writeFileSync(path.join(from, 'src', `f${i}.txt`), `file ${i}`);
        }

        const started = await control(running, 'POST', '/api/v1/transfers', {from: {disk: 'vps1', path: from}, to: {disk: 'vps2', dir: path.join(dir, 'b')}});
        assert.strictEqual(started.status, 200);
        await wait_until(() => ['ok', 'error'].includes(item_of(running, started.body.id).phase), 60000);
        const done = item_of(running, started.body.id);
        assert.deepStrictEqual([done.phase, done.said, done.kind, done.files, done.files_done], ['ok', '', 'dir', 1206, 1206]);
        const to = path.join(dir, 'b', 'proj');
        assert.strictEqual(Buffer.compare(fs.readFileSync(path.join(to, 'film.bin')), film), 0);
        assert.strictEqual(fs.readFileSync(path.join(to, 'src', 'deep', 'x.js'), 'utf8'), 'x');
        assert.strictEqual(fs.readFileSync(path.join(to, 'src', 'f1199.txt'), 'utf8'), 'file 1199');
        assert.strictEqual(fs.readFileSync(path.join(to, '-rf'), 'utf8'), 'a name like an option');
        assert.strictEqual(fs.readFileSync(path.join(to, 'привет.txt'), 'utf8'), 'hi');
        assert.strictEqual(fs.statSync(path.join(to, 'empty.txt')).size, 0);
        assert.strictEqual(fs.statSync(path.join(to, 'empty', 'inner')).isDirectory(), true);
        assert.notStrictEqual(fs.statSync(path.join(to, 'run.sh')).mode & 0o100, 0);
        assert.strictEqual(fs.readlinkSync(path.join(to, 'lib')), 'src');
        assert.deepStrictEqual(fs.readdirSync(to).sort(), ['-rf', 'empty', 'empty.txt', 'film.bin', 'lib', 'run.sh', 'src', 'привет.txt']);
        assert.strictEqual(running.app.log_lines.some(v => /\[transfer_end_ok\] .*files=1206/.test(v)), true);

        // A folder named without a root, and not there yet, is made under that machine's home
        fs.rmSync(path.join(from, 'src'), {recursive: true});
        const relative = await control(running, 'POST', '/api/v1/transfers', {from: {disk: 'vps1', path: from}, to: {disk: 'vps2', dir: 'ggg/new'}});
        await wait_until(() => ['ok', 'error'].includes(item_of(running, relative.body.id).phase), 60000);
        assert.deepStrictEqual([item_of(running, relative.body.id).phase, item_of(running, relative.body.id).said], ['ok', '']);
        assert.strictEqual(fs.readFileSync(path.join(home, 'ggg', 'new', 'proj', 'run.sh'), 'utf8'), 'echo hi\n');
        assert.strictEqual(fs.existsSync(path.join(process.cwd(), 'ggg')), false, 'nothing made in the folder the agent was started in');
    }
    finally {
        first.kill('SIGKILL');
        second.kill('SIGKILL');
        await running.close();
    }
});

test('an agent\'s token with the files right is kept within its folder by the machine\'s agent itself, links included', async function () {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-token-home-')));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, [], {HOME: home});
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');
        await wait_until(() => running.app.remote_by_name.ui1.state.resources.can.includes('fs_root'));
        const notes = path.join(home, 'notes');
        fs.mkdirSync(path.join(notes, 'inner'), {recursive: true});
        fs.writeFileSync(path.join(notes, 'a.txt'), 'mine');
        fs.writeFileSync(path.join(home, 'secret.txt'), 'not yours');
        fs.symlinkSync(home, path.join(notes, 'out'));
        const missing = await control(running, 'POST', '/api/v1/tokens', {label: 'notes', remotes: ['ui1'], rights: ['files']});
        assert.deepStrictEqual([missing.status, missing.body.error], [400, 'the files right is of 1 to 20 folders, such as ~/notes or /srv/data, each one line of up to 500 characters']);
        const made = await control(running, 'POST', '/api/v1/tokens', {label: 'notes', remotes: ['ui1'], rights: ['files'], folders: ['~/notes', '~/visual-agency']});
        assert.strictEqual(made.status, 200);
        // The file manager of ui1, asked with that token
        function as_token(method, asked, body) {
            return fetch_host({port: running.control_port, host: '127.0.0.1', method, path: `/api/v1/remotes/ui1/fs${asked}`, token: made.body.token, body}).then(v => ({status: v.status, body: v.body}));
        }

        // Its folder is where it starts, and what is in it is its own
        const start = await as_token('GET', '');
        assert.strictEqual(start.status, 200, start.body);
        assert.deepStrictEqual([JSON.parse(start.body).path, JSON.parse(start.body).items.map(v => v.name).sort()], [notes, ['a.txt', 'inner', 'out']]);
        assert.strictEqual((await as_token('GET', `/file${encodeURIComponent(path.join(notes, 'a.txt')).replace(/%2F/g, '/')}`)).body, 'mine');
        assert.strictEqual((await as_token('POST', `/upload?dir=${encodeURIComponent('inner')}&name=new.txt`, 'new')).status, 200);
        assert.strictEqual(fs.readFileSync(path.join(notes, 'inner', 'new.txt'), 'utf8'), 'new');

        // A folder of it not there yet lists empty and is not made; the first write makes it
        const later = path.join(home, 'visual-agency');
        assert.deepStrictEqual(JSON.parse((await as_token('GET', `?path=${encodeURIComponent('~/visual-agency')}`)).body), {path: later, items: []});
        assert.strictEqual(fs.existsSync(later), false);
        assert.strictEqual((await as_token('POST', `/upload?dir=${encodeURIComponent('~/visual-agency/messages')}&name=first.md`, 'hello')).status, 200);
        assert.strictEqual(fs.readFileSync(path.join(later, 'messages', 'first.md'), 'utf8'), 'hello');

        // Nothing above it, however it is asked, and nothing through a link that leads out
        for (const [method, asked, body] of [
            ['GET', `?path=${encodeURIComponent('/')}`],
            ['GET', `?path=${encodeURIComponent('..')}`],
            ['GET', `?path=${encodeURIComponent('out')}`],
            ['GET', `/file${home}/secret.txt`],
            ['GET', `/file${notes}/out/secret.txt`],
            ['POST', `/upload?dir=${encodeURIComponent(home)}&name=planted.txt`, 'planted'],
            ['POST', `/upload?dir=${encodeURIComponent('out')}&name=planted.txt`, 'planted'],
            ['POST', '/rename', JSON.stringify({from: path.join(notes, 'a.txt'), to: path.join(home, 'stolen.txt')})],
            ['POST', '/delete', JSON.stringify({path: path.join(home, 'secret.txt')})],
            ['POST', '/mkdir', JSON.stringify({path: path.join(home, 'made')})],
        ]) {
            const answer = await as_token(method, asked, body);
            assert.strictEqual(answer.status >= 400, true, `${method} ${asked}: ${answer.status} ${answer.body}`);
            assert.match(answer.body, /outside the folders this token may use/, `${method} ${asked}`);
        }
        for (const name of ['planted.txt', 'stolen.txt', 'made']) {
            assert.strictEqual(fs.existsSync(path.join(home, name)), false, name);
        }
        assert.strictEqual(fs.readFileSync(path.join(home, 'secret.txt'), 'utf8'), 'not yours');
        assert.strictEqual(fs.existsSync(path.join(notes, 'a.txt')), true);

        // The owner's token goes anywhere, as before
        const owner = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/ui1/fs?path=${encodeURIComponent(home)}`});
        assert.strictEqual(owner.status, 200);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a file too big for one request lands in parts, and a part sent again is written over', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-parts-'));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        const where = {dir: path.join(dir, 'films'), name: 'film.bin', id: 'u1abcdef9'};

        // Nothing is in before the first part
        assert.deepStrictEqual(await part_call(running, 'GET', 'part', where), {status: 200, body: {received: 0}});
        const one = await part_call(running, 'POST', 'part', Object.assign({offset: 0}, where), 'abcdef');
        assert.deepStrictEqual(one, {status: 200, body: {received: 6}});
        // The answer to the second part was lost, so it is sent again from where it began
        await part_call(running, 'POST', 'part', Object.assign({offset: 6}, where), 'ghXX');
        const again = await part_call(running, 'POST', 'part', Object.assign({offset: 6}, where), 'ghij');
        assert.deepStrictEqual(again.body, {received: 10});
        // A part past the end is refused, and says nothing came of it
        const past = await part_call(running, 'POST', 'part', Object.assign({offset: 50}, where), 'zz');
        assert.strictEqual(past.status, 502);
        assert.match(past.body.error, /has 10 bytes so far/);
        assert.deepStrictEqual((await part_call(running, 'GET', 'part', where)).body, {received: 10});

        // While the parts gather, the name is not there; a short file is not finished
        assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'films')), ['.film.bin.u1abcdef9.part']);
        const short = await part_call(running, 'POST', 'finish', Object.assign({size: 11}, where));
        assert.strictEqual(short.status, 502);
        const done = await part_call(running, 'POST', 'finish', Object.assign({size: 10}, where));
        assert.deepStrictEqual(done.body, {path: path.join(dir, 'films', 'film.bin'), bytes: 10, replaced: false});
        assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'films')), ['film.bin']);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'films', 'film.bin'), 'utf8'), 'abcdefghij');

        // An empty file is finished with no part at all; one given up leaves nothing
        const empty = await part_call(running, 'POST', 'finish', {dir: where.dir, name: 'empty.txt', id: 'u2abcdef9', size: 0});
        assert.strictEqual(empty.body.bytes, 0);
        await part_call(running, 'POST', 'part', {dir: where.dir, name: 'gone.bin', id: 'u3abcdef9', offset: 0}, 'xyz');
        assert.strictEqual((await part_call(running, 'POST', 'cancel', {dir: where.dir, name: 'gone.bin', id: 'u3abcdef9'})).status, 200);
        assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'films')).sort(), ['empty.txt', 'film.bin']);

        // An id that is not letters and digits is not an upload
        const odd = await part_call(running, 'GET', 'part', {dir: where.dir, name: 'x', id: '../x'});
        assert.strictEqual(odd.status, 400);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

// A drop of many files sent as one stream: no file waits on the one before it
test('many files reach a machine as one tar through serviceman, with their times; an agent from before says 501', async function () {
    const from = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tar-from-'));
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tar-to-'));
    for (let i = 0; i < 300; i++) {
        fs.mkdirSync(path.join(from, `d${i % 10}`), {recursive: true});
        fs.writeFileSync(path.join(from, `d${i % 10}`, `f${i}.txt`), 'x'.repeat(i));
    }
    fs.utimesSync(path.join(from, 'd7', 'f7.txt'), 1600000000, 1600000000);
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', '.']);
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const ask = `http://127.0.0.1:${running.control_port}/api/v1/remotes/ui1/fs/upload/tar?dir=${encodeURIComponent(path.join(to, 'in'))}`;
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.ok(remote.state.resources.can.includes('tar_put'));

        const answer = await control_fetch(ask, {method: 'POST', body: tarred});
        assert.deepStrictEqual([answer.status, await answer.json()], [200, {files: 300, bytes: 44850}]);
        assert.strictEqual(fs.readFileSync(path.join(to, 'in', 'd3', 'f293.txt'), 'utf8'), 'x'.repeat(293));
        assert.strictEqual(fs.readdirSync(path.join(to, 'in'), {recursive: true}).filter(v => v.endsWith('.txt')).length, 300);
        assert.strictEqual(fs.statSync(path.join(to, 'in', 'd7', 'f7.txt')).mtimeMs, 1600000000000);
        await wait_until(() => running.app.log_lines.some(v => /\[files_copied\] remote=ui1 dir=.+ files=300 bytes=44850 ms=\d+/.test(v)));

        // A name that walks out is refused before the machine is asked
        const walked = Buffer.from(tarred);
        walked.write('../out\0', 0);
        walked.write('        ', 148);
        walked.write(`${walked.subarray(0, 512).reduce((v, vv) => v + vv, 0).toString(8).padStart(6, '0')}\0 `, 148);
        const refused = await control_fetch(ask, {method: 'POST', body: walked});
        assert.deepStrictEqual([refused.status, (await refused.json()).error], [400, '"../out" walks out of the folder the tar is sent to']);

        // An agent from before the tar is not asked: the page sends the files apart
        remote.state.resources.can = remote.state.resources.can.filter(v => v !== 'tar_put');
        const old = await control_fetch(ask, {method: 'POST', body: tarred});
        assert.deepStrictEqual([old.status, /from before files come in one tar/.test((await old.json()).error)], [501, true]);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        fs.rmSync(from, {recursive: true, force: true});
        fs.rmSync(to, {recursive: true, force: true});
    }
});

// What a page asks before an upload of thousands of files: whether they fit
test('a machine says the room left on the disk of a folder, made or not yet; an agent from before says 501', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-room-'));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    const ask = `http://127.0.0.1:${running.control_port}/api/v1/remotes/ui1/fs/room?path=${encodeURIComponent(path.join(dir, 'new', 'deep'))}`;
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.ok(remote.state.resources.can.includes('fs_room'));

        // A folder not made yet is measured at the nearest one that is, and is not made
        const answer = await control_fetch(ask);
        const room = await answer.json();
        assert.deepStrictEqual([answer.status, Object.keys(room)], [200, ['bytes_free', 'inodes_free']]);
        assert.ok(room.bytes_free > 0);
        assert.ok((room.inodes_free === null) || (room.inodes_free > 0));
        assert.strictEqual(fs.existsSync(path.join(dir, 'new')), false);

        // An agent from before the room is said is not asked: the page uploads unchecked
        remote.state.resources.can = remote.state.resources.can.filter(v => v !== 'fs_room');
        const old = await control_fetch(ask);
        assert.deepStrictEqual([old.status, /from before a disk says its room/.test((await old.json()).error)], [501, true]);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test('a folder of a machine is read from its page, and a folder that is not there says so', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-fs-'));
    fs.mkdirSync(path.join(dir, 'inner'));
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n');
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        // Folders first, then files; the size and the time belong to files alone
        const answer = await fs_list(running, 'ui1', dir);
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(answer.body.path, dir);
        assert.deepStrictEqual(answer.body.items.map(v => [v.name, v.kind]), [['inner', 'dir'], ['hello.txt', 'file']]);
        assert.strictEqual(answer.body.items[1].size, 6);
        assert.strictEqual(answer.body.items[1].mtime_ms > 0, true);

        const missing = await fs_list(running, 'ui1', path.join(dir, 'nothing'));
        assert.strictEqual(missing.status, 502);
        assert.match(missing.body.error, /ENOENT/);

        const nowhere = await fs_list(running, 'nowhere', dir);
        assert.strictEqual(nowhere.status, 404);
        assert.match(nowhere.body.error, /no remote named "nowhere"/);

        // One file comes back as itself, under its own name and type, sized and seekable —
        // the path is the address's own tail, not a query
        const got = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/ui1/fs/file${url_path(path.join(dir, 'hello.txt'))}`});
        assert.strictEqual(got.status, 200);
        assert.strictEqual(got.body, 'hello\n');
        assert.match(got.headers['content-disposition'], /hello\.txt/);
        assert.match(got.headers['content-type'], /^text\/plain/);
        assert.strictEqual(got.headers['content-length'], '6');
        assert.strictEqual(got.headers['accept-ranges'], 'bytes');

        // The same file under the machine's own name, whole disk under the address's root
        const sub = await fetch_host({port: running.control_port, host: 'ui1.fs.serviceman.localhost', path: url_path(path.join(dir, 'hello.txt'))});
        assert.strictEqual(sub.status, 200);
        assert.strictEqual(sub.body, 'hello\n');

        // And on the door the services answer on, where the control page is reachable too: the
        // page builds the address from the port it was opened on
        const door = await fetch_host({port: running.port, host: 'ui1.fs.serviceman.localhost', path: url_path(path.join(dir, 'hello.txt'))});
        assert.strictEqual(door.status, 200);
        assert.strictEqual(door.body, 'hello\n');

        // A name a header cannot hold as-is rides percent-encoded, and the request still lands
        fs.writeFileSync(path.join(dir, 'привет.txt'), 'privet\n');
        const named = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/ui1/fs/file${url_path(path.join(dir, 'привет.txt'))}`});
        assert.strictEqual(named.status, 200);
        assert.strictEqual(named.body, 'privet\n');
        assert.match(named.headers['content-disposition'], /filename\*=UTF-8''%D0%BF/);
        fs.rmSync(path.join(dir, 'привет.txt'));

        // HEAD is the size without the bytes
        const weighed = await fetch_host({port: running.control_port, host: '127.0.0.1', method: 'HEAD', path: `/api/v1/remotes/ui1/fs/file${url_path(path.join(dir, 'hello.txt'))}`});
        assert.strictEqual(weighed.status, 200);
        assert.strictEqual(weighed.headers['content-length'], '6');
        assert.strictEqual(weighed.body, '');

        // A range is the piece it names, which is how a video seeks
        const piece = await fetch_host({port: running.control_port, host: '127.0.0.1', headers: {range: 'bytes=1-3'}, path: `/api/v1/remotes/ui1/fs/file${url_path(path.join(dir, 'hello.txt'))}`});
        assert.strictEqual(piece.status, 206);
        assert.strictEqual(piece.body, 'ell');
        assert.strictEqual(piece.headers['content-range'], 'bytes 1-3/6');

        // The last bytes by themselves, and a range past the end refused
        const tail_piece = await fetch_host({port: running.control_port, host: '127.0.0.1', headers: {range: 'bytes=-2'}, path: `/api/v1/remotes/ui1/fs/file${url_path(path.join(dir, 'hello.txt'))}`});
        assert.strictEqual(tail_piece.status, 206);
        assert.strictEqual(tail_piece.body, 'o\n');
        const past = await fetch_host({port: running.control_port, host: '127.0.0.1', headers: {range: 'bytes=99-'}, path: `/api/v1/remotes/ui1/fs/file${url_path(path.join(dir, 'hello.txt'))}`});
        assert.strictEqual(past.status, 416);
        assert.strictEqual(past.headers['content-range'], 'bytes */6');

        // A file that is not there is an error, never an empty download
        const empty = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/ui1/fs/file${url_path(path.join(dir, 'nothing.txt'))}`});
        assert.strictEqual(empty.status, 502);

        // Several names come as one tar, a folder among them whole
        fs.writeFileSync(path.join(dir, 'inner', 'deep.txt'), 'deep\n');
        const tar = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/ui1/fs/tar?dir=${encodeURIComponent(dir)}&names=inner&names=hello.txt`});
        assert.strictEqual(tar.status, 200);
        assert.strictEqual(tar.headers['content-type'], 'application/x-tar');
        assert.strictEqual(tar.body.includes('inner/deep.txt'), true);
        assert.strictEqual(tar.body.includes('hello.txt'), true);

        // Renaming carries a name to another folder too, which is what moving is
        const moved = await fs_do(running, 'ui1', 'rename', {from: path.join(dir, 'hello.txt'), to: path.join(dir, 'inner', 'hi.txt')});
        assert.strictEqual(moved.status, 200);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'inner', 'hi.txt'), 'utf8'), 'hello\n');
        assert.strictEqual(fs.existsSync(path.join(dir, 'hello.txt')), false);

        // A folder is made the mkdir -p way: the whole path at once
        const made = await fs_do(running, 'ui1', 'mkdir', {path: path.join(dir, 'foo/bar/baz')});
        assert.strictEqual(made.status, 200);
        assert.strictEqual(fs.statSync(path.join(dir, 'foo/bar/baz')).isDirectory(), true);

        // Deleting takes a folder with everything under it
        const gone = await fs_do(running, 'ui1', 'delete', {path: path.join(dir, 'inner')});
        assert.strictEqual(gone.status, 200);
        assert.strictEqual(fs.existsSync(path.join(dir, 'inner')), false);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

// One folder of that machine, the way the page asks for it
async function fs_list(running, name, dir)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/${name}/fs?path=${encodeURIComponent(dir)}`});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

// A disk path as a url path: each name encoded, the slashes kept
function url_path(text)
{
    return text.split('/').map(encodeURIComponent).join('/');
}

// A rename or a delete, the way the page asks for one
async function fs_do(running, name, action, request)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/${name}/fs/${action}`, method: 'POST', body: JSON.stringify(request)});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

test('a machine that is not connected is not sent a file, and neither is one nobody wrote down', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    try {
        const away = await file_copy(running, 'ui1', '~', 'hello.txt', 'hello\n');
        assert.strictEqual(away.status, 409);
        assert.match(away.body.error, /ui1 is not connected/);

        const nowhere = await file_copy(running, 'nowhere', '~', 'hello.txt', 'hello\n');
        assert.strictEqual(nowhere.status, 404);
        assert.match(nowhere.body.error, /no remote named "nowhere"/);
    }
    finally {
        await running.close();
    }
});

test('what a machine is running, and what it is listening on, are read from its page', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN);
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        // The whole table ps prints, every process carrying the pid of the one that started
        // it — which is what the page draws its tree from
        const procs = await machine_read(running, 'ui1', 'processes');
        assert.strictEqual(procs.status, 200);
        const mine = procs.body.items.find(v => v.pid === agent.pid);
        assert.notStrictEqual(mine, undefined);
        assert.match(mine.command, /agent/);
        assert.strictEqual(mine.ppid, process.pid);
        assert.strictEqual(mine.rss > 0, true);
        assert.strictEqual(mine.user.length > 0, true);

        // The port serviceman itself answers on is one this machine is listening on, and the
        // agent runs here, so it is the same machine that says so
        const ports = await machine_read(running, 'ui1', 'ports');
        assert.strictEqual(ports.status, 200);
        const found = ports.body.items.find(v => v.port === running.control_port);
        assert.notStrictEqual(found, undefined);
        assert.strictEqual(found.proto, 'tcp');
        assert.strictEqual(found.state, 'LISTEN');

        const nowhere = await machine_read(running, 'nowhere', 'processes');
        assert.strictEqual(nowhere.status, 404);
        assert.match(nowhere.body.error, /no remote named "nowhere"/);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a machine that is not connected says nothing about its processes or its ports', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    try {
        const procs = await machine_read(running, 'ui1', 'processes');
        assert.strictEqual(procs.status, 409);
        assert.match(procs.body.error, /ui1 is not connected/);

        const ports = await machine_read(running, 'ui1', 'ports');
        assert.strictEqual(ports.status, 409);
        assert.match(ports.body.error, /ui1 is not connected/);
    }
    finally {
        await running.close();
    }
});

// What that machine is running, or what it is listening on, the way the page asks for it
async function machine_read(running, name, what)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/${name}/${what}`});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

test('a machine keeps its own numbers, the page reads them, and sees the last of them while it is away', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    // A sample every 300ms and a beat every 100ms: a test cannot wait half a minute
    const agent = agent_start(running.control_port, TOKEN, [], Object.assign({SERVICEMAN_METRICS_MS: '300', SERVICEMAN_BEAT_MS: '100'}, LOGS_ENV));
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.ok(remote.state.resources.can.includes('metrics'));
        // Read as the page reads it, until a sample with a ping in it has been written
        let charts = null;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            await timers.setTimeout(200);
            charts = await machine_read(running, 'ui1', 'metrics?range=1h');
            if ((charts.status === 200) && charts.body.points.some(v => (v.cpu !== null) && (v.ping !== null))) {
                break;
            }
        }
        const point = charts.body.points.find(v => v.ping !== null);
        assert.strictEqual(charts.body.away, false);
        assert.strictEqual(charts.body.step_ms, 30000);
        assert.ok((point.cpu >= 0) && (point.cpu <= 1), `cpu ${point.cpu}`);
        assert.ok((point.mem > 0) && (point.mem <= point.mem_total), `mem ${point.mem} of ${point.mem_total}`);
        assert.ok(point.ping >= 0, `ping ${point.ping}`);
        assert.ok('net_in' in point && 'tcp' in point && 'disk_read' in point, Object.keys(point).join(' '));

        const wrong = await machine_read(running, 'ui1', 'metrics?range=1y');
        assert.strictEqual(wrong.status, 400);
        const nowhere = await machine_read(running, 'nowhere', 'metrics?range=1h');
        assert.strictEqual(nowhere.status, 404);

        // An agent from before charts is told so, not asked
        remote.state.resources.can = remote.state.resources.can.filter(v => v !== 'metrics');
        const old = await machine_read(running, 'ui1', 'metrics?range=24h');
        assert.strictEqual(old.status, 400);
        assert.match(old.body.error, /from before charts/);

        // Away, the range read last is still there, marked as such; one never read is not
        agent.kill('SIGKILL');
        await wait_until(() => remote.state.phase === 'offline');
        const away = await machine_read(running, 'ui1', 'metrics?range=1h');
        assert.strictEqual(away.status, 200);
        assert.strictEqual(away.body.away, true);
        assert.ok(away.body.points.length > 0);
        const never = await machine_read(running, 'ui1', 'metrics?range=30d');
        assert.strictEqual(never.status, 409);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a machine counts its uptime from servermon, the page reads it by day, and sees the last of it while it is away', async function () {
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    // A count every 300ms and stats every 200ms: a test cannot wait a minute
    const agent = agent_start(running.control_port, TOKEN, [], Object.assign({SERVICEMAN_UPTIME_MS: '300', SERVICEMAN_STATS_MS: '200', SERVICEMAN_BEAT_MS: '100'}, LOGS_ENV));
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        assert.ok(remote.state.resources.can.includes('uptime'));
        let uptime = null;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            await timers.setTimeout(200);
            uptime = await machine_read(running, 'ui1', 'uptime?days=30');
            if ((uptime.status === 200) && (uptime.body.days[29].known_ms > 0)) {
                break;
            }
        }
        assert.strictEqual(uptime.body.away, false);
        assert.strictEqual(uptime.body.days.length, 30);
        assert.strictEqual(uptime.body.days[0].known_ms, 0, 'the days before servermon are not known');
        assert.ok(uptime.body.days[29].known_ms > 0);
        await wait_until(() => (remote.state.stats !== null) && (remote.state.stats.uptime_30d !== null) && (remote.state.stats.uptime_30d !== undefined));
        assert.ok(remote.state.stats.uptime_30d.known_ms > 0, 'the Remotes list has the last 30 days');

        for (const days of ['0', '91', 'x']) {
            assert.strictEqual((await machine_read(running, 'ui1', `uptime?days=${days}`)).status, 400, `days=${days}`);
        }
        assert.strictEqual((await machine_read(running, 'nowhere', 'uptime')).status, 404);

        // An agent from before uptime is told so, not asked
        const can = remote.state.resources.can;
        remote.state.resources.can = can.filter(v => v !== 'uptime');
        const old = await machine_read(running, 'ui1', 'uptime');
        assert.strictEqual(old.status, 400);
        assert.match(old.body.error, /from before uptime/);
        remote.state.resources.can = can;

        // Away, the last answer is still there, marked as such
        agent.kill('SIGKILL');
        await wait_until(() => remote.state.phase === 'offline');
        const away = await machine_read(running, 'ui1', 'uptime');
        assert.strictEqual(away.status, 200);
        assert.strictEqual(away.body.away, true);
        assert.strictEqual(away.body.days.length, 30);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a request that reaches a machine http socket is answered by serviceman over the link', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-inbound-'));
    // One service that answers a page, and one that says what it was sent — both already
    // running here, so nothing on the machine with the door has any part in them
    const site = await page_server('a site behind the host');
    const said = http.createServer(function (req, res) {
        res.end(JSON.stringify(req.headers));
    });
    await new Promise(v => said.listen(0, '127.0.0.1', v));
    // What this machine's door answers, and with which service
    const running = await serviceman_start([{name: 'ui1', token: TOKEN, inbound: {'site.test': 'site', 'said.test': 'said'}}], {
        services: [
            {name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: `127.0.0.1:${site.address().port}`},
            {name: 'said', type: 'external', publish: {host: 'said.test'}, upstream: `127.0.0.1:${said.address().port}`},
        ],
    });
    const agent = agent_start(running.control_port, TOKEN, [], {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_HTTP_SOCKET_MODE: '0600'});
    const file = path.join(dir, 'http.sock');
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        // The door stands for as long as the link does, and not a moment before it
        await wait_until(() => fs.existsSync(file), 5000);

        // Nothing on that machine serves this: the connection rides the link the agent dialled
        // out, and the page comes from the host at the other end of it
        const page = await fetch_socket(file, 'site.test', '/');
        assert.strictEqual(page.status, 200);
        assert.match(page.body, /a site behind the host/);

        // Who may knock is the mode of the file and nothing else — by default, nobody but the
        // user the agent runs as
        assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600');

        // The control page is not a thing a door may reach, whatever it is asked for: it is
        // given to the machine serviceman runs on, and a request through a link is not that
        const control = await fetch_socket(file, 'serviceman.localhost', '/');
        assert.strictEqual(control.status, 404);
        // A standard answer: which machine this is, and why, is for the log alone
        assert.strictEqual(control.body, '404 Not Found\n');

        // And the log says which machine carried it, since the stream has nobody's address
        assert.strictEqual(running.app.log_lines.some(v => v.includes('connection_begin] through ui1')), true);

        // The visitor is whoever the front of that machine says: the stream carries no address,
        // so what it wrote down is passed on rather than a hop of nothing being added to it,
        // and the scheme it took the request over is not overwritten with this host's own
        const seen = await fetch_socket(file, 'said.test', '/', {'x-real-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.7', 'x-forwarded-proto': 'https'});
        const headers = JSON.parse(seen.body);
        assert.strictEqual(headers['x-forwarded-for'], '198.51.100.7');
        assert.strictEqual(headers['x-forwarded-proto'], 'https');
        assert.strictEqual(running.app.log_lines.some(v => v.includes('"ip":"198.51.100.7"')), true);
    }
    finally {
        agent.kill('SIGKILL');
        site.close();
        said.close();
        await running.close();
    }
});

test('a machine opens no door until one is asked for', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-no-door-'));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, [], {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_STATS_MS: '200'});
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');
        // Long enough for a door to have appeared if one were going to
        await timers.setTimeout(500);

        assert.strictEqual(fs.existsSync(path.join(dir, 'http.sock')), false);
        // And the host says as much, so the page can show a machine that carries nothing in
        await wait_until(() => remote.state.stats !== null, 5000);
        assert.strictEqual(remote.state.stats.door, null);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

test('a machine door serves the names it was given and no others, and none at all by default', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-inbound-rules-'));
    // The name the door carries is not the name the service publishes, which is the whole
    // point of writing it: nothing is renamed to be served from another machine's front
    const site = await page_server('a site behind the host');
    const running = await serviceman_start([{name: 'ui1', token: TOKEN, inbound: {'*.example.com': 'one', 'off.example.com': {service: 'one', off: true}}}], {
        services: [
            {name: 'one', type: 'external', publish: {host: 'one.internal'}, upstream: `127.0.0.1:${site.address().port}`},
            {name: 'two', type: 'external', publish: {host: 'two.test'}, upstream: `127.0.0.1:${site.address().port}`},
        ],
    });
    const agent = agent_start(running.control_port, TOKEN, [], {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_HTTP_SOCKET_MODE: '0600'});
    const file = path.join(dir, 'http.sock');
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');
        await wait_until(() => fs.existsSync(file), 5000);

        // A name under the one it was given, answered by the service the rule names — and that
        // service publishes one.internal, which is not this name at all
        const allowed = await fetch_socket(file, 'echo.example.com', '/');
        assert.strictEqual(allowed.status, 200);
        assert.match(allowed.body, /a site behind the host/);

        // A service this host serves, which that machine was not given: the door is on a
        // public address, so what may be reached through it is said here and not out there
        const refused = await fetch_socket(file, 'two.test', '/');
        assert.strictEqual(refused.status, 404);
        assert.strictEqual(refused.body, '404 Not Found\n');
        assert.strictEqual(running.app.log_lines.some(v => v.includes('inbound_refused] remote=ui1 host=two.test')), true);

        // The bare name a wildcard stands over is not one of its names
        const bare = await fetch_socket(file, 'example.com', '/');
        assert.strictEqual(bare.status, 404);

        // And what the door does not carry is untouched: the service answers its own address
        // here the way it always did
        const own = await fetch_host({port: running.port, host: 'one.internal', path: '/'});
        assert.strictEqual(own.status, 200);

        // A rule set aside is still written down and still not answering — and an exact name
        // is read before the wildcard that would otherwise have carried it
        // — refused by the machine's own door, which has the rule in its table
        const aside = await fetch_socket(file, 'off.example.com', '/');
        assert.strictEqual(aside.status, 404);
        assert.strictEqual(aside.body, '404 Not Found\n');

        // Put back on: the names a door answers are read on this end, so the machine keeps the
        // link it is on and the name answers at once
        const socket = running.app.remote_by_name.ui1.state.socket;
        const config = config_from_json({
            listen: {host: '127.0.0.1', port: running.app.config.listen.port},
            control: {host: 'serviceman.localhost', port: running.app.config.control.port},
            remotes: [{name: 'ui1', token: TOKEN, inbound: {'*.example.com': 'one', 'off.example.com': 'one'}}],
            services: [
                {name: 'one', type: 'external', publish: {host: 'one.internal'}, upstream: `127.0.0.1:${site.address().port}`},
                {name: 'two', type: 'external', publish: {host: 'two.test'}, upstream: `127.0.0.1:${site.address().port}`},
            ],
        }, __dirname);
        const applied = await app_apply_config(running.app, config);
        assert.deepStrictEqual(applied.notes, ['remote ui1: the names its door answers changed']);
        assert.strictEqual(running.app.remote_by_name.ui1.state.socket, socket);
        // The machine's table follows a moment later, sent over that same link
        let back = null;
        for (let i = 0; i < 100; i++) {
            back = await fetch_socket(file, 'off.example.com', '/');
            if (back.status === 200) {
                break;
            }
            await timers.setTimeout(50);
        }
        assert.strictEqual(back.status, 200);
    }
    finally {
        agent.kill('SIGKILL');
        site.close();
        await running.close();
    }
});

test('a wall is asked before anything behind it is touched, and one wall stands in front of many names', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-wall-'));
    // The wall, answering the one door authwall keeps for this: a cookie it knows is a yes,
    // and it says who they are; anything else is a no. Its own pages answer on the same name.
    const asked = [];
    let allow = false;
    const wall = http.createServer(function (req, res) {
        asked.push(`${req.url} host=${req.headers.host} uri=${req.headers['x-original-uri'] || ''} cookie=${req.headers.cookie || ''}`);
        if (req.url === '/auth/sidecar') {
            if (allow === false) {
                res.writeHead(401);
                res.end();
                return;
            }
            res.writeHead(200, {'x-auth-user': 'someone@example.com'});
            res.end();
            return;
        }
        res.end('the sign-in page');
    });
    await new Promise(v => wall.listen(0, '127.0.0.1', v));
    const kept = http.createServer(function (req, res) {
        res.end(`the service, for ${req.headers['x-auth-user']}`);
    });
    await new Promise(v => kept.listen(0, '127.0.0.1', v));
    const rules = {'sam.test': {service: 'notes', auth: 'wall'}, '*.walled.test': {service: 'notes', auth: 'wall'}};
    const running = await serviceman_start([{name: 'ui1', token: TOKEN, inbound: rules}], {
        services: [
            {name: 'notes', type: 'external', publish: {host: 'notes.internal'}, upstream: `127.0.0.1:${kept.address().port}`},
            {name: 'wall', type: 'external', publish: {host: 'wall.internal'}, upstream: `127.0.0.1:${wall.address().port}`},
        ],
    });
    const agent = agent_start(running.control_port, TOKEN, [], {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_HTTP_SOCKET_MODE: '0600'});
    const file = path.join(dir, 'http.sock');
    try {
        await wait_until(() => running.app.remote_by_name.ui1.state.phase === 'online');
        await wait_until(() => fs.existsSync(file), 5000);

        // Nobody signed in: the wall says no, and the visitor is sent to sign in on the name
        // they asked for, with where they were going kept
        const away = await fetch_socket(file, 'sam.test', '/notes/one');
        assert.strictEqual(away.status, 302);
        assert.strictEqual(away.headers.location, '/auth/sign-in?return=%2Fnotes%2Fone');
        assert.strictEqual(running.app.log_lines.some(v => v.includes('wall_refused] wall=wall host=sam.test')), true);

        // The wall was asked the way its own sidecar wants: the name asked for, the whole
        // address, and the cookie as it came
        assert.match(asked[0], /^\/auth\/sidecar host=sam\.test uri=http:\/\/sam\.test\/notes\/one/);

        // The wall's own pages answer on that name too, without being asked about themselves
        const sign_in = await fetch_socket(file, 'sam.test', '/auth/sign-in?return=%2F');
        assert.strictEqual(sign_in.status, 200);
        assert.strictEqual(sign_in.body, 'the sign-in page');

        // Signed in: the service answers, and reads who it was from the wall's own word
        allow = true;
        const through = await fetch_socket(file, 'sam.test', '/', {cookie: 'authwall=abc'});
        assert.strictEqual(through.status, 200);
        assert.strictEqual(through.body, 'the service, for someone@example.com');

        // The same wall stands in front of another name — as many as point at it
        const other = await fetch_socket(file, 'one.walled.test', '/');
        assert.strictEqual(other.status, 200);
        assert.strictEqual(other.body, 'the service, for someone@example.com');

        // And what a visitor claims about themselves is not what the service reads
        const forged = await fetch_socket(file, 'sam.test', '/', {'x-auth-user': 'root@example.com'});
        assert.strictEqual(forged.body, 'the service, for someone@example.com');
    }
    finally {
        agent.kill('SIGKILL');
        wall.close();
        kept.close();
        await running.close();
    }
});

test('a wall a rule names has to be a service, and not the one it is standing in front of', function () {
    const services = [
        {name: 'notes', type: 'external', publish: {host: 'notes.internal'}, upstream: '127.0.0.1:9001'},
        {name: 'wall', type: 'external', publish: {host: 'wall.internal'}, upstream: '127.0.0.1:9002'},
    ];
    function bad(inbound) {
        return function () {
            config_from_json({
                listen: {host: '127.0.0.1', port: 0},
                control: {host: 'serviceman.localhost', port: 0},
                remotes: [{name: 'ui1', token: TOKEN, inbound}],
                services,
            }, __dirname);
        };
    }
    assert.throws(bad({'sam.test': {service: 'notes', auth: 'nothing'}}), /no service has that name/);
    assert.throws(bad({'sam.test': {service: 'notes', auth: 'notes'}}), /behind itself/);
    // One wall, as many names as point at it
    bad({'sam.test': {service: 'notes', auth: 'wall'}, 'other.test': {service: 'notes', auth: 'wall'}})();
});

test('a machine may not open a stream this host would be using, and the link lives on', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-inbound-odd-'));
    const running = await serviceman_start([{name: 'ui1', token: TOKEN}]);
    const agent = agent_start(running.control_port, TOKEN, [], {SERVICEMAN_AGENT_DIR: dir});
    try {
        const remote = running.app.remote_by_name.ui1;
        await wait_until(() => remote.state.phase === 'online');

        // An even number is this host's to hand out, and a target this host does not serve is
        // no stream either. Both are refused as one dead stream, never a dead link.
        link_send_stream(remote.state.socket, 'o', 4, Buffer.from(JSON.stringify({http: {}})));
        link_send_stream(remote.state.socket, 'o', 7, Buffer.from(JSON.stringify({shell: {}})));
        await timers.setTimeout(200);
        assert.strictEqual(remote.state.phase, 'online');
        assert.strictEqual(remote.state.streams[4], undefined);
        assert.strictEqual(remote.state.streams[7], undefined);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
    }
});

// fetch, with the owner's token the signed-in page brings
function control_fetch(url, init)
{
    const asked = Object.assign({}, init);
    asked.headers = Object.assign({authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}, asked.headers);
    return fetch(url, asked);
}

// A request into a socket file, the way whatever stands in front of that machine makes one
function fetch_socket(file, host, path_asked, headers)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({socketPath: file, path: path_asked, headers: Object.assign({host}, headers)}, function (answer) {
            const body = [];
            answer.on('data', v => body.push(v));
            answer.on('end', () => resolve({status: answer.statusCode, headers: answer.headers, body: Buffer.concat(body).toString('utf8')}));
        });
        request.on('error', reject);
        request.end();
    });
}

// Something already running that answers one line, for a service of the external kind
function page_server(text)
{
    const server = http.createServer(function (req, res) {
        res.end(text);
    });
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            resolve(server);
        });
    });
}

async function serviceman_start(remotes, extra)
{
    const config = config_from_json(Object.assign({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes,
        services: [],
    }, (extra === undefined) ? {} : extra), __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    return {
        app,
        servers,
        port: servers.server.address().port,
        control_port: servers.control.address().port,
        close: function () {
            return serviceman_close(app, servers);
        },
    };
}

// The same serviceman, booted from a config file on disk — the remote forms need the file
async function serviceman_start_file(json)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-config-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify(json, null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    const servers = await server_start(app);
    return {
        app,
        servers,
        config_path,
        port: servers.server.address().port,
        control_port: servers.control.address().port,
        close: function () {
            return serviceman_close(app, servers);
        },
    };
}

function config_file_read(running)
{
    return JSON.parse(fs.readFileSync(running.config_path, 'utf8'));
}

// A file to a machine, the way the page sends one: the bytes are the body, and where they go
// is in the address
async function file_copy(running, name, dir, file, text)
{
    const where = `dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file)}`;
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/${name}/fs/upload?${where}`, method: 'POST', body: text});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

// One request about a file in parts: GET or POST upload/part, POST upload/finish or cancel
async function part_call(running, method, action, query, body)
{
    const where = Object.keys(query).map(v => `${v}=${encodeURIComponent(query[v])}`).join('&');
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/ui1/fs/upload/${action}?${where}`, method, body});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

// One copy between machines, as the transfers list says it is now
function item_of(running, id)
{
    return running.app.transfers.items.find(v => v.id === id);
}

async function control(running, method, path, value)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path, method, body: (value === null) ? undefined : JSON.stringify(value)});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

async function serviceman_close(app, servers)
{
    for (const remote of app.remotes) {
        if (remote.state.socket !== null) {
            remote.state.socket.destroy();
        }
    }
    for (const door of [servers.server, servers.control, servers.socket]) {
        if ((door !== null) && (door !== undefined)) {
            door.close();
            door.closeAllConnections();
        }
    }
}

// A link that is there but writes nowhere: what a socket looks like the moment it is lost
function fake_socket()
{
    return {
        destroyed: false,
        write: function () {
            throw new Error('the link is gone');
        },
        destroy: function () {
            this.destroyed = true;
        },
    };
}

// Every servermon running this file: node with it as its first argument
function servermon_stop(file)
{
    for (const name of fs.readdirSync('/proc').filter(v => /^\d+$/.test(v))) {
        try {
            if (fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0')[1] === file) {
                process.kill(Number(name), 'SIGKILL');
            }
        }
        catch {
            // gone already
        }
    }
}

function agent_start(control_port, token, extra, env)
{
    return agent_start_at(`http://127.0.0.1:${control_port}`, token, extra, env);
}

function agent_start_at(url, token, extra, env)
{
    const argv = [AGENT, '--url', url, '--token', token].concat((extra === undefined) ? [] : extra);
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env)});
    out.stdout.resume();
    out.stderr.resume();
    return out;
}

// One agent that dials in once and gives up: what it wrote before it left
function agent_output(control_port, token)
{
    return new Promise(function (resolve) {
        const agent = agent_start(control_port, token, ['--once']);
        let text = '';
        agent.stdout.on('data', function (chunk) {
            text += chunk.toString('utf8');
        });
        agent.on('close', function () {
            resolve(text);
        });
    });
}

async function state_read(running)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/status'});
    return JSON.parse(answer.body);
}

// One request to the control page through the socket file, the way ssh -L hands it over
function socket_get(socket_path, path)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({socketPath: socket_path, path, headers: {host: 'localhost', authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}}, function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('end', function () {
                resolve({status: answer.statusCode, body: Buffer.concat(chunks).toString('utf8')});
            });
        });
        request.on('error', reject);
        request.end();
    });
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + ((timeout_ms === undefined) ? 10000 : timeout_ms);
    for (;;) {
        if (ready()) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(25);
    }
}
