const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const docker_api_start = require('./fixtures/docker_api_start');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const reap_idle = require('../src/main/src/helpers/reap_idle');
const remote_tags = require('../src/main/src/helpers/remote_tags');
const remotes_update = require('../src/main/src/helpers/remotes_update');
const server_start = require('../src/main/src/helpers/server_start');
const service_phase = require('../src/main/src/helpers/service_phase');
const service_probe = require('../src/main/src/helpers/service_probe');
const service_stop = require('../src/main/src/helpers/service_stop');
const service_waits_for_remote = require('../src/main/src/helpers/service_waits_for_remote');
const test = require('node:test');
const timers = require('timers/promises');
const ws = require('ws');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const DOCKER_BIN = path.join(__dirname, 'bin', 'docker');
const TOKEN = '0123456789abcdef0123456789abcdef';
const TOKEN2 = 'fedcba9876543210fedcba9876543210';

// Every agent this file spawns keeps its state here — never beside its own file in src/
process.env.SERVICEMAN_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'));

test('a docker service on a remote is started over there and answered through the link', async function () {
    const running = await serviceman_start([
        {name: 'whoami', type: 'docker', remote: 'vps1', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami', policy: {stop_after_idle: '1s'}},
    ]);
    const service = running.app.service_by_name.whoami;
    try {
        await running.agent_start();
        assert.strictEqual(service_phase(service), 'stopped');
        assert.strictEqual(running.app.remote_by_name.vps1.state.resources.docker, 'docker 28.0.0-fake', 'the agent asked the docker it was given');

        const first = await fetch_host({port: running.port, host: 'whoami.test', path: '/hello'});
        assert.strictEqual(first.status, 200);
        assert.match(first.body, /hello from serviceman-whoami at whoami.test\/hello/);
        assert.strictEqual(service_phase(service), 'running');
        assert.strictEqual(running.app.log_lines.some(v => /\[docker_run\] service=whoami image=demo\/whoami remote=vps1/.test(v)), true);
        assert.strictEqual(running.app.log_lines.some(v => /\[service_start_end_ok\] \d+\.\d{3}s service=whoami instance=1 remote=vps1 upstream=127\.0\.0\.1:\d+ inside=8080/.test(v)), true);
        assert.strictEqual(service.state.instances[0].remote, 'vps1', 'the copy remembers the machine it was reserved on');
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_reserved\] service=whoami instance=1 remote=vps1 of=\["vps1"\]/.test(v)), true);

        service.state.instances[0].last_activity_at = Date.now() - 5000;
        reap_idle(running.app);
        await service.state.stop_promise;
        assert.strictEqual(service_phase(service), 'stopped');

        const again = await fetch_host({port: running.port, host: 'whoami.test', path: '/back'});
        assert.strictEqual(again.status, 200);
        assert.strictEqual(service_phase(service), 'running');
    }
    finally {
        await running.close();
    }
});

test('a service waits for its remote, comes up when the agent dials in, and is out of reach when the link drops', async function () {
    const running = await serviceman_start([
        {name: 'kept', type: 'docker', remote: 'vps1', publish: {host: 'kept.test', port: 8080}, image: 'demo/kept', policy: {start: 'always'}},
    ]);
    const service = running.app.service_by_name.kept;
    const remote = running.app.remote_by_name.vps1;
    try {
        const away = await fetch_host({port: running.port, host: 'kept.test', path: '/'});
        assert.strictEqual(away.status, 502);
        assert.match(away.body, /kept: remote vps1 is offline — no machine to start it on/);

        await running.agent_start();
        await wait_until(() => service_phase(service) === 'running');
        const upstream = service.state.instances[0].upstream;
        const started_at = Date.now() - 60000;
        const last_activity_at = Date.now() - 5000;
        service.state.instances[0].started_at = started_at;
        service.state.instances[0].last_activity_at = last_activity_at;

        remote.state.socket.destroy();
        await wait_until(() => remote.state.phase === 'offline');
        assert.strictEqual(service_phase(service), 'lost', 'nobody stopped it; this host simply cannot see it');
        assert.deepStrictEqual(service.state.instances[0].upstream, upstream, 'the last address it answered on is kept');
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_service_lost\] service=kept remote=vps1/.test(v)), true);

        await wait_until(() => remote.state.phase === 'online', 15000);
        await wait_until(() => service_phase(service) === 'running');
        assert.deepStrictEqual(service.state.instances[0].upstream, upstream, 'the container over there was adopted, not started again');
        assert.strictEqual(running.app.log_lines.some(v => /\[service_adopt_ok\] service=kept instance=1 remote=vps1 upstream=/.test(v)), true);
        assert.strictEqual(service.state.instances[0].started_at, started_at, 'the container never stopped, so it is as old as it was');
        assert.strictEqual(service.state.instances[0].last_activity_at, last_activity_at, 'a blink of the link is not a visit: the idle clock goes on');

        const answer = await fetch_host({port: running.port, host: 'kept.test', path: '/still-here'});
        assert.strictEqual(answer.status, 200);
    }
    finally {
        await running.close();
    }
});

test('a service asks for a tag, and the machine that carries it takes the work', async function () {
    const running = await serviceman_start([
        {name: 'tagged', type: 'docker', remotes: ['#gpu'], publish: {host: 'tagged.test', port: 8080}, image: 'demo/tagged'},
    ], [{name: 'vps1', token: TOKEN, tags: ['eu']}, {name: 'vps2', token: TOKEN2, tags: ['gpu', 'eu']}]);
    const service = running.app.service_by_name.tagged;
    try {
        // The tag names one machine of the two, and nothing runs until that one is there
        assert.strictEqual(service_waits_for_remote(running.app, service), true);
        await running.agent_start('vps1', TOKEN);
        assert.strictEqual(service_waits_for_remote(running.app, service), true, 'the machine that dialled in carries the wrong tag');

        await running.agent_start('vps2', TOKEN2);
        assert.strictEqual(service_waits_for_remote(running.app, service), false);

        const answer = await fetch_host({port: running.port, host: 'tagged.test', path: '/hello'});
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(service.state.instances[0].remote, 'vps2');
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_reserved\] service=tagged instance=1 remote=vps2 of=\["#gpu"\]/.test(v)), true);
    }
    finally {
        await running.close();
    }
});

test('a tag nothing carries yet is allowed, because a machine says what it is when it connects', function () {
    const config = {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN, tags: ['eu']}],
        services: [{name: 'far', type: 'docker', remotes: ['#gpu'], publish: {host: 'far.test', port: 80}, image: 'demo/far'}],
    };
    assert.deepStrictEqual(config_from_json(config, __dirname).services[0].remotes, ['#gpu']);
    config.services[0].remotes = ['#GPU'];
    assert.throws(() => config_from_json(config, __dirname), /services\[0\].remotes: a tag is lowercase letters, digits, - and _/);
});

test('a machine says what it is when it connects, and that is gone with its link', async function () {
    const running = await serviceman_start([
        {name: 'tagged', type: 'docker', remotes: ['#gpu'], publish: {host: 'tagged.test', port: 8080}, image: 'demo/tagged'},
    ], [{name: 'vps1', token: TOKEN, tags: ['eu']}]);
    const service = running.app.service_by_name.tagged;
    const remote = running.app.remote_by_name.vps1;
    try {
        // The config gives it "eu" and nothing else; the machine itself says it has a gpu
        await running.agent_start('vps1', TOKEN, {SERVICEMAN_TAGS: 'gpu'});
        assert.deepStrictEqual(remote_tags(remote), ['eu', 'gpu']);
        assert.strictEqual(service_waits_for_remote(running.app, service), false);
        assert.strictEqual(running.app.log_lines.some(v => /\[remote_online\] remote=vps1 from=127\.0\.0\.1 agent=\S+ tags=\["eu","gpu"\]/.test(v)), true);

        const answer = await fetch_host({port: running.port, host: 'tagged.test', path: '/hello'});
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(service.state.instances[0].remote, 'vps1');

        // The link goes, and with it everything the machine said about itself. What the config
        // gives it stays, because that is the host's word and not the machine's.
        remote.state.socket.destroy();
        await wait_until(() => remote.state.phase === 'offline');
        assert.deepStrictEqual(remote_tags(remote), ['eu']);
        assert.strictEqual(service_waits_for_remote(running.app, service), true);
    }
    finally {
        await running.close();
    }
});

test('a shell opens in a container on a remote, through the link its agent dialled', async function () {
    const socket_path = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-api-')), 'docker.sock');
    const api = await docker_api_start(socket_path);
    const running = await serviceman_start([
        {name: 'far', type: 'docker', remote: 'vps1', publish: {host: 'far.test', port: 8080}, image: 'demo/far'},
    ]);
    try {
        // The socket is on the agent's machine, and only the agent can reach it
        await running.agent_start({DOCKER_HOST: `unix://${socket_path}`});
        assert.strictEqual(running.app.remote_by_name.vps1.state.resources.docker_socket, socket_path);
        await fetch_host({port: running.port, host: 'far.test', path: '/'});

        const shell = await shell_talk(running.control_port, 'far', ['whoami\n']);
        assert.deepStrictEqual(shell.notes, ['a shell in serviceman-far on remote vps1']);
        assert.match(shell.text, /# serviceman-far \$ /);
        assert.match(shell.text, /whoami/);
        assert.strictEqual(Object.keys(api.state.execs).length, 1);
        assert.strictEqual(api.state.execs.exec1.container, 'serviceman-far');
        assert.strictEqual(api.state.execs.exec1.created.Tty, true);
        assert.ok(api.state.resizes.some(v => /h=30&w=100/.test(v)));
        assert.strictEqual(running.app.log_lines.some(v => /\[shell_begin\] service=far instance=1 container=serviceman-far remote=vps1/.test(v)), true);
    }
    finally {
        api.close();
        await running.close();
    }
});

test('a container found running by a new serviceman is as old as the last one wrote down', async function () {
    const running = await serviceman_start([
        {name: 'kept', type: 'docker', remote: 'vps1', publish: {host: 'kept.test', port: 8080}, image: 'demo/kept', policy: {start: 'always'}},
    ]);
    const service = running.app.service_by_name.kept;
    try {
        await running.agent_start();
        await wait_until(() => service_phase(service) === 'running');
        // What a serviceman that just started knows of it: nothing running, and the time it
        // came up as the counters file has it
        const started_at = Date.now() - 3600000;
        const instance = service.state.instances[0];
        instance.phase = 'stopped';
        instance.started_at = null;
        instance.started_before = started_at;
        await service_probe(running.app, service);
        assert.strictEqual(instance.phase, 'running');
        assert.strictEqual(instance.started_at, started_at, 'adopted, it keeps the hour it has been up');
        assert.strictEqual(instance.started_before, null, 'the time written down is used once');
    }
    finally {
        await running.close();
    }
});

test('a service that is found running again is not left wearing its last error', async function () {
    const running = await serviceman_start([
        {name: 'whoami', type: 'docker', remote: 'vps1', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'},
    ]);
    const service = running.app.service_by_name.whoami;
    try {
        // Asked for while its machine was away: the answer is an error, and it is remembered
        const cold = await fetch_host({port: running.port, host: 'whoami.test', path: '/'});
        assert.strictEqual(cold.status, 502);
        assert.match(service.state.last_error, /vps1 is offline/);

        // The machine dials in, and what is running there is found again
        await running.agent_start();
        const answer = await fetch_host({port: running.port, host: 'whoami.test', path: '/'});
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(service.state.last_error, null, 'a running service carries no error');
    }
    finally {
        await running.close();
    }
});

test('a machine whose definition changed carries its services again once its agent is back', async function () {
    const service_json = {name: 'whoami', type: 'docker', remote: 'vps1', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'};
    const running = await serviceman_start([service_json]);
    const service = running.app.service_by_name.whoami;
    try {
        await running.agent_start();
        assert.strictEqual((await fetch_host({port: running.port, host: 'whoami.test', path: '/'})).status, 200);
        const was = running.app.remote_by_name.vps1;

        // The machine is retitled: its link is dropped, the agent dials in again, and the
        // container it carries is found again — reached through the link that is there now,
        // not the one that went
        await app_apply_config(running.app, config_from_json({
            listen: {host: '127.0.0.1', port: 0},
            control: {host: 'serviceman.localhost', port: 0},
            remotes: [{name: 'vps1', title: 'the box, renamed', token: TOKEN}],
            services: [service_json],
        }, __dirname));
        assert.notStrictEqual(running.app.remote_by_name.vps1, was, 'a changed definition is a new machine object');
        assert.ok(running.app.log_lines.some(v => /\[remote_dropped\] remote=vps1 reason="the definition changed"/.test(v)), 'and the agent was told before the link went');
        await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'online', 15000);
        await wait_until(() => service_phase(service) === 'running', 15000);
        const again = await fetch_host({port: running.port, host: 'whoami.test', path: '/again'});
        assert.strictEqual(again.status, 200, 'the service answers through the new link');
        assert.ok(Object.prototype.hasOwnProperty.call(service.state.instances[0].agent, 'createConnection'), 'and it is reached through the link, never over the network');
    }
    finally {
        await running.close();
    }
});

test('an agent that hears nothing from the host hangs up and dials again by itself', async function () {
    const running = await serviceman_start([]);
    try {
        // A host that says nothing for a second and a half is, to this agent, a link that is
        // not there — a proxy in front can hold a dead one open for as long as it likes. The
        // agent's own beat, which the host would answer, is five seconds away.
        await running.agent_start({SERVICEMAN_HOST_GONE_MS: '1500', SERVICEMAN_BEAT_MS: '5000'});
        const first = running.app.log_lines.filter(v => /\[remote_online\] remote=vps1/.test(v)).length;
        await wait_until(() => running.app.log_lines.some(vv => /\[agent_host_quiet\] remote=vps1 silent=\d+\.\d{3}s then="dialling fresh"/.test(vv)), 15000);
        await wait_until(() => running.app.log_lines.filter(vv => /\[remote_online\] remote=vps1/.test(vv)).length > first, 15000);
    }
    finally {
        await running.close();
    }
});

test('an agent that hears the host answer its beats keeps the link', async function () {
    const running = await serviceman_start([]);
    try {
        await running.agent_start({SERVICEMAN_HOST_GONE_MS: '1500', SERVICEMAN_BEAT_MS: '200'});
        const remote = running.app.remote_by_name.vps1;
        await wait_until(() => remote.state.phase === 'online');
        // Long enough for the watchdog to have fired twice over, had the host stayed silent
        await new Promise(v => setTimeout(v, 3500));
        assert.strictEqual(remote.state.phase, 'online');
        assert.strictEqual(running.app.log_lines.filter(v => /\[remote_online\] remote=vps1/.test(v)).length, 1, 'one link, held the whole time');
        assert.strictEqual(running.app.log_lines.some(v => /\[agent_host_quiet\]/.test(v)), false);
    }
    finally {
        await running.close();
    }
});

test('a kept-alive tunnel does not collect a timeout listener on every request', async function () {
    const running = await serviceman_start([
        {name: 'whoami', type: 'docker', remote: 'vps1', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'},
    ]);
    const service = running.app.service_by_name.whoami;
    try {
        await running.agent_start();
        for (let i = 0; i < 12; i++) {
            const answer = await fetch_host({port: running.port, host: 'whoami.test', path: `/ask/${i}`});
            assert.strictEqual(answer.status, 200);
        }
        // node arms a request timeout on the socket and disarms it with setTimeout(0, fn); a
        // stream that does not take the listener off again grows one per request
        const held = [];
        const agent = service.state.instances[0].agent;
        for (const list of Object.values(agent.freeSockets).concat(Object.values(agent.sockets))) {
            for (const socket of list) {
                held.push(socket.listenerCount('timeout'));
            }
        }
        assert.ok(held.length > 0, 'the pool kept the stream it used');
        assert.deepStrictEqual(held.filter(v => v > 1), [], `timeout listeners left behind: ${held.join(', ')}`);
    }
    finally {
        await running.close();
    }
});

test('a machine that dials in with an older agent is asked to fetch the one this host serves', async function () {
    const running = await serviceman_start([]);
    try {
        await running.agent_start();
        const remote = running.app.remote_by_name.vps1;
        assert.strictEqual(remote.state.agent_built, null, 'an agent run from the repo carries no build date');

        // An agent that names no build at all is the oldest kind there is, and it is asked too
        await wait_until(() => running.app.log_lines.some(vv => /remote_update_asked/.test(vv)), 15000);
        assert.match(running.app.log_lines.find(v => /remote_update_asked/.test(v)), /\[remote_update_asked\] remote=vps1 serving=/);

        // This one runs from the repo: no bin/update beside it, and source is never overwritten
        // from a link — it says so, and the page can read the reason back
        await wait_until(() => running.app.log_lines.some(vv => /remote_update_refused/.test(vv)), 15000);
        assert.match(running.app.log_lines.find(v => /remote_update_refused/.test(v)), /is not a bundled agent — this one runs from the repo/);
        await wait_until(() => remote.state.update_refused !== null, 15000);
        assert.match(remote.state.update_refused, /is not a bundled agent/);

        // The machine dials in again, saying it is running something older
        remote.state.socket.destroy();
        await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'offline');
        remote.state.update_asked_at = null;
        const said = [];
        const child = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${running.control_port}`, '--token', TOKEN, '--docker', DOCKER_BIN], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, {SERVICEMAN_AGENT_BUILT: '2020-01-01T00:00:00.000Z'}),
        });
        child.stdout.on('data', v => said.push(v.toString('utf8')));
        child.stderr.on('data', v => said.push(v.toString('utf8')));
        running.children.push(child);
        await wait_until(() => running.app.log_lines.some(vv => /running=2020-01-01T00:00:00\.000Z serving=/.test(vv)), 15000);

        // A machine already connected hears about it too: the same check runs on a clock, and
        // asks again only after a while rather than on every tick
        const asked = running.app.log_lines.filter(v => /remote_update_asked/.test(v)).length;
        remotes_update(running.app);
        assert.strictEqual(running.app.log_lines.filter(v => /remote_update_asked/.test(v)).length, asked, 'it was asked a moment ago');
        running.app.remote_by_name.vps1.state.update_asked_at = Date.now() - 700000;
        remotes_update(running.app);
        assert.strictEqual(running.app.log_lines.filter(v => /remote_update_asked/.test(v)).length, asked + 1, 'and again once that while has passed');
    }
    finally {
        await running.close();
    }
});

test('a program is installed and run on the machine that carries it', async function () {
    const port = await free_port();
    const services = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-services-'));
    const running = await serviceman_start([
        {
            name: 'writer',
            type: 'shell',
            remote: 'vps1',
            publish: {host: 'writer.test', port},
            cwd: 'apps/writer',
            lifecycle: {install: `cp ${path.join(__dirname, 'fixtures', 'app_server.js')} server.js`},
            command: `${process.execPath} server.js ${port}`,
        },
    ]);
    const service = running.app.service_by_name.writer;
    try {
        // The agent's own services folder is where a folder written as a relative path lands
        await running.agent_start('vps1', TOKEN, {SERVICEMAN_SERVICES_DIR: services});
        assert.strictEqual(service_phase(service), 'stopped');

        const answer = await fetch_host({port: running.port, host: 'writer.test', path: '/now'});
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(answer.body, 'the app answers /now', 'the answer came back down the link');
        assert.ok(fs.existsSync(path.join(services, 'apps', 'writer', 'server.js')), 'the agent put it under its own services folder');
        assert.ok(fs.existsSync(path.join(services, 'apps', 'writer', '.serviceman-app')), 'and marked the folder');
        assert.ok(running.app.log_lines.some(v => /\[program_step_end_ok\] \d+\.\d{3}s service=writer step=install cwd=/.test(v)));
        assert.ok(running.app.log_lines.some(v => /\[service_start_end_ok\] \d+\.\d{3}s service=writer instance=1 remote=vps1/.test(v)));
        assert.strictEqual(service.state.instances[0].remote, 'vps1');

        // Stopping it is the agent's to do, and the app stops answering over there
        await service_stop(running.app, service, 'the test asked');
        assert.strictEqual(service_phase(service), 'stopped');
        await assert.rejects(fetch_direct(port), 'nothing answers on that port any more');
    }
    finally {
        await running.close();
    }
});

test('a websocket reaches a program on a remote through the link, as a request does', async function () {
    const port = await free_port();
    const running = await serviceman_start([
        {name: 'echo', type: 'shell', remote: 'vps1', publish: {host: 'echo.test', port}, command: `${process.execPath} ${path.join(__dirname, 'fixtures', 'ws_echo_server.js')} ${port}`},
    ]);
    const remote = running.app.remote_by_name.vps1;
    try {
        await running.agent_start();
        const client = new ws.WebSocket(`ws://127.0.0.1:${running.port}/`, {headers: {host: 'echo.test'}});
        const answer = new Promise(function (resolve, reject) {
            client.once('message', v => resolve(String(v)));
            client.once('error', reject);
            client.once('close', () => reject(new Error('closed before an answer')));
        });
        client.once('open', () => client.send('hi'));
        assert.strictEqual(await answer, 'echo hi');
        // The machine's loopback is not this one's: the socket is a stream inside the link, and
        // the link's streams ending, as they do when it drops, takes it with them
        const closed = new Promise(v => client.once('close', v));
        for (const id of Object.keys(remote.state.streams)) {
            remote.state.streams[id].tunnel_gone(new Error('the test cut the link'));
        }
        const went = await Promise.race([closed.then(() => 'closed'), timers.setTimeout(2000, 'open')]);
        client.terminate();
        assert.strictEqual(went, 'closed', 'the websocket went around the link');
    }
    finally {
        // A program outlives its agent; this one goes with the test
        await service_stop(running.app, running.app.service_by_name.echo, 'the test is over').catch(function () {
            // A test that failed before the program started has nothing to stop
        });
        await running.close();
    }
});

function fetch_direct(port)
{
    return new Promise(function (resolve, reject) {
        const req = require('http').request({host: '127.0.0.1', port, path: '/', agent: false}, function (res) {
            res.resume();
            resolve(res.statusCode);
        });
        req.on('error', reject);
        req.end();
    });
}

function free_port()
{
    return new Promise(function (resolve) {
        const server = require('net').createServer();
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            server.close(function () {
                resolve(port);
            });
        });
    });
}

async function serviceman_start(services, remotes)
{
    process.env.SERVICEMAN_TEST_STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-')), 'docker.json');
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: ((remotes === undefined) ? [{name: 'vps1', token: TOKEN}] : remotes),
        services,
    }, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const out = {
        app,
        servers,
        port: servers.server.address().port,
        control_port: servers.control.address().port,
        children: [],
        agent_start: async function (name, token, env) {
            const remote = ((typeof name === 'string') ? name : 'vps1');
            const secret = ((typeof name === 'string') ? token : TOKEN);
            const words = ((typeof name === 'string') ? env : name);
            const argv = [AGENT, '--url', `http://127.0.0.1:${out.control_port}`, '--token', secret, '--docker', DOCKER_BIN];
            const child = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, words)});
            child.stdout.resume();
            child.stderr.resume();
            out.children.push(child);
            await wait_until(() => app.remote_by_name[remote].state.phase === 'online');
        },
        close: async function () {
            for (const child of out.children) {
                child.kill('SIGKILL');
            }
            for (const remote of app.remotes) {
                if (remote.state.socket !== null) {
                    remote.state.socket.destroy();
                }
            }
            for (const service of app.services) {
                for (const instance of service.state.instances) {
                    instance.agent.destroy();
                }
            }
            servers.server.close();
            servers.control.close();
            servers.server.closeAllConnections();
            servers.control.closeAllConnections();
            containers_kill();
        },
    };
    return out;
}

// The stand-in docker keeps its containers as real little servers; the test leaves none behind
function containers_kill()
{
    let state;
    try {
        state = JSON.parse(fs.readFileSync(process.env.SERVICEMAN_TEST_STATE, 'utf8'));
    }
    catch {
        return;
    }
    for (const name of Object.keys(state.containers)) {
        const found = state.containers[name];
        if (found.pid === null) {
            continue;
        }
        try {
            process.kill(found.pid, 'SIGKILL');
        }
        catch {
            // already gone
        }
    }
}

// One visit to the shell door: what it said, what the container wrote back
function shell_talk(control_port, name, lines)
{
    const ws = require('ws');
    return new Promise(function (resolve) {
        const heard = {notes: [], text: ''};
        const client = new ws.WebSocket(`ws://127.0.0.1:${control_port}/api/v1/shell?service=${encodeURIComponent(name)}&slot=1`, {headers: {authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}});
        client.on('message', function (raw, binary) {
            if (binary) {
                heard.text += raw.toString('utf8');
                return;
            }
            heard.notes.push(JSON.parse(raw.toString('utf8')).text);
            client.send(JSON.stringify({type: 'resize', cols: 100, rows: 30}));
            for (const line of ((lines === undefined) ? [] : lines)) {
                client.send(JSON.stringify({type: 'input', data: line}));
            }
            setTimeout(function () {
                client.close();
            }, 250);
        });
        client.on('error', () => resolve(heard));
        client.on('close', () => resolve(heard));
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
