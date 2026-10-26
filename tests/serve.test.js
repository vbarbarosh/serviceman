const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const crypto = require('crypto');
const docker_api_start = require('./fixtures/docker_api_start');
const docker_spec_hash = require('../src/main/src/helpers/docker_spec_hash');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const image_prepull_start = require('../src/main/src/helpers/image_prepull_start');
const net = require('net');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const program_docker_argv = require('../src/helpers/program_docker_argv');
const reap_idle = require('../src/main/src/helpers/reap_idle');
const server_start = require('../src/main/src/helpers/server_start');
const service_ensure_running = require('../src/main/src/helpers/service_ensure_running');
const service_image_pull = require('../src/main/src/helpers/service_image_pull');
const service_inflight = require('../src/main/src/helpers/service_inflight');
const service_phase = require('../src/main/src/helpers/service_phase');
const service_probe = require('../src/main/src/helpers/service_probe');
const service_redir = require('../src/main/src/service_redir');
const service_stop = require('../src/main/src/helpers/service_stop');
const test = require('node:test');
const timers = require('timers/promises');
const view_from_service = require('../src/main/src/helpers/view_from_service');
const volume_text = require('../src/helpers/volume_text');
const ws = require('ws');
const zip_bytes = require('./fixtures/zip_bytes');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const DOCKER_BIN = path.join(__dirname, 'bin', 'docker');
const TOKEN = '0123456789abcdef0123456789abcdef';

test('a service that already runs is given an address, and nothing else is done to it', async function () {
    const far = await far_server();
    const running = await serviceman_start([
        {name: 'rockpool', title: 'Terminals', type: 'external', publish: {host: 'term.test'}, upstream: `127.0.0.1:${far.port}`},
    ]);
    const service = running.app.service_by_name.rockpool;
    try {
        assert.strictEqual(service_phase(service), 'running', 'it is up because somebody else keeps it up');

        const answer = await fetch_host({port: running.port, host: 'term.test', path: '/pane'});
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(answer.body, 'the other server answers /pane');
        assert.strictEqual(state_file_read(process.env.SERVICEMAN_TEST_STATE).containers.length, undefined, 'no container was made for it');

        // The idle policy leaves it alone, however quiet it is
        service.state.instances[0].last_activity_at = Date.now() - 3600000;
        reap_idle(running.app);
        await timers.setTimeout(50);
        assert.strictEqual(service_phase(service), 'running');

        const started = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/rockpool/start', method: 'POST'});
        assert.strictEqual(started.status, 400);
        assert.match(JSON.parse(started.body).error, /runs somewhere else; serviceman gives it an address, nothing more/);

        // It goes down: the address stays, because serviceman cannot bring it back
        far.close();
        const gone = await fetch_host({port: running.port, host: 'term.test', path: '/pane'});
        assert.strictEqual(gone.status, 502);
        assert.deepStrictEqual(service.state.instances[0].upstream, {host: '127.0.0.1', port: far.port});
        assert.strictEqual(service_phase(service), 'running');
    }
    finally {
        far.close();
        await running.close();
    }
});

test('the control door serves everything that has an address as a NavPlace collection', async function () {
    const running = await serviceman_start([
        {name: 'whoami', title: 'who am I', type: 'docker', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'},
        {name: 'far', type: 'external', publish: {host: 'far.test/docs'}, upstream: '127.0.0.1:1'},
        {name: 'quiet', type: 'shell', command: 'node -e "setInterval(function () {}, 1000);"', policy: {start: 'always'}},
    ]);
    try {
        // The plain text NavPlace reads: meta, a section per kind, the address last on every
        // line — on the service door, whichever door asked — and a service with no address is
        // not on it
        const collection = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/navplace'});
        assert.strictEqual(collection.status, 200);
        assert.match(collection.headers['content-type'], /text\/plain/);
        assert.deepStrictEqual(collection.body.split('\n').filter(v => v !== ''), [
            '% design: github',
            '% title: serviceman',
            '# docker',
            `who am I ⚪ #whoami #docker  http://whoami.test:${running.port}`,
            '# external',
            `far 🟢 #external  http://far.test:${running.port}/docs`,
        ]);

        // The same list by the control hostname on the service door
        const by_host = await fetch_host({port: running.port, host: 'serviceman.localhost', path: '/navplace'});
        assert.strictEqual(by_host.status, 200);
        assert.strictEqual(by_host.body, collection.body);

        // Nothing is started by reading the list, and the door is the control page's: a
        // hostname nobody serves gets nothing on the service port
        assert.strictEqual(service_phase(running.app.service_by_name.whoami), 'stopped');
        const stranger = await fetch_host({port: running.port, host: 'ghost.test', path: '/navplace'});
        assert.strictEqual(stranger.status, 404);
    }
    finally {
        await running.close();
    }
});

test('restart stops it and starts it again as one ask, and waits for its own stop', async function () {
    const running = await serviceman_start([
        {name: 'quiet', type: 'shell', command: 'node -e "setInterval(function () {}, 1000);"', policy: {start: 'always'}},
        {name: 'elsewhere', type: 'external', publish: {host: 'far.test'}, upstream: '127.0.0.1:1'},
    ]);
    const service = running.app.service_by_name.quiet;
    try {
        await service_ensure_running(running.app, service);
        assert.strictEqual(service_phase(service), 'running');
        const was = service.state.instances[0].started_at;
        await timers.setTimeout(5);

        const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/quiet/restart', method: 'POST'});
        assert.strictEqual(answer.status, 202);

        // The ask is answered before the work is done, so the test waits for the work
        await settled(() => (service_phase(service) === 'running') && (service.state.instances[0].started_at > was));
        assert.strictEqual(service_phase(service), 'running', 'it is up again, not left stopped');
        assert.strictEqual(service.state.instances[0].started_at > was, true, 'it is a new one, not the one that was there');
        assert.strictEqual(running.app.log_lines.some(v => /\[service_restart_begin\] service=quiet was=running/.test(v)), true);
        assert.strictEqual(running.app.log_lines.some(v => /\[service_restart_end_ok\] service=quiet/.test(v)), true);

        // The kinds serviceman does not run are refused the same way start and stop are
        const refused = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/elsewhere/restart', method: 'POST'});
        assert.strictEqual(refused.status, 400);
        assert.match(JSON.parse(refused.body).error, /runs somewhere else/);

        const wrong = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/quiet/restart'});
        assert.strictEqual(wrong.status, 405);
        assert.match(JSON.parse(wrong.body).error, /restart is a POST/);
    }
    finally {
        await running.close();
    }
});

test('the first request starts the container, the idle policy stops it, the next request starts it again', async function () {
    const running = await serviceman_start([
        {name: 'whoami', type: 'docker', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami', policy: {stop_after_idle: '1s'}},
    ]);
    const service = running.app.service_by_name.whoami;
    const instance = service.state.instances[0];
    try {
        assert.strictEqual(service_phase(service), 'stopped');

        const first = await fetch_host({port: running.port, host: 'whoami.test', path: '/hello'});
        assert.strictEqual(first.status, 200);
        assert.match(first.body, /hello from serviceman-whoami at whoami.test\/hello/);
        assert.strictEqual(first.headers['x-service'], 'serviceman-whoami');
        assert.strictEqual(service_phase(service), 'running');
        const upstream = instance.upstream;

        const second = await fetch_host({port: running.port, host: 'whoami.test', path: '/again'});
        assert.strictEqual(second.status, 200);
        assert.deepStrictEqual(instance.upstream, upstream);
        assert.strictEqual(service.state.requests, 2);

        instance.last_activity_at = Date.now() - 5000;
        reap_idle(running.app);
        await service.state.stop_promise;
        assert.strictEqual(service_phase(service), 'stopped');
        assert.strictEqual(instance.upstream, null);
        assert.strictEqual(await port_answers(upstream), false);

        const third = await fetch_host({port: running.port, host: 'whoami.test', path: '/back'});
        assert.strictEqual(third.status, 200);
        assert.match(third.body, /hello from serviceman-whoami/);
        assert.strictEqual(service_phase(service), 'running');
    }
    finally {
        await running.close();
    }
});

test('a busy service is not stopped, and an always-on service is never stopped', async function () {
    const running = await serviceman_start([
        {name: 'busy', type: 'docker', publish: {host: 'busy.test', port: 8080}, image: 'demo/busy', policy: {stop_after_idle: '1s'}},
        {name: 'kept', type: 'docker', publish: {host: 'kept.test', port: 8080}, image: 'demo/kept', policy: {start: 'always'}},
    ]);
    const busy = running.app.service_by_name.busy;
    const kept = running.app.service_by_name.kept;
    try {
        await fetch_host({port: running.port, host: 'busy.test', path: '/'});
        await fetch_host({port: running.port, host: 'kept.test', path: '/'});

        busy.state.instances[0].last_activity_at = Date.now() - 5000;
        busy.state.instances[0].inflight = 1;
        kept.state.instances[0].last_activity_at = Date.now() - 5000;
        reap_idle(running.app);
        await timers.setTimeout(50);
        assert.strictEqual(service_phase(busy), 'running');
        assert.strictEqual(service_phase(kept), 'running');

        busy.state.instances[0].inflight = 0;
        reap_idle(running.app);
        await busy.state.stop_promise;
        assert.strictEqual(service_phase(busy), 'stopped');
        assert.strictEqual(service_phase(kept), 'running');
    }
    finally {
        await running.close();
    }
});

test('a websocket wakes the service and stays connected', async function () {
    const running = await serviceman_start([
        {name: 'socket', type: 'docker', publish: {host: 'socket.test', port: 8080}, image: 'demo/socket'},
    ]);
    try {
        const answer = await upgrade_request(running.port, 'socket.test');
        assert.match(answer.head, /^HTTP\/1.1 101 Switching Protocols/);
        assert.match(answer.head, /x-service: serviceman-socket/);
        assert.strictEqual(answer.echo, 'ping');
        assert.strictEqual(service_phase(running.app.service_by_name.socket), 'running');
    }
    finally {
        await running.close();
    }
});

test('a slow start answers with the waiting page, then with the service', async function () {
    process.env.SERVICEMAN_TEST_BOOT_MS = '3500';
    const running = await serviceman_start([
        {name: 'slow', type: 'docker', publish: {host: 'slow.test', port: 8080}, image: 'demo/slow'},
    ]);
    try {
        const waiting = await fetch_host({port: running.port, host: 'slow.test', path: '/', headers: {accept: 'text/html'}});
        assert.strictEqual(waiting.status, 503);
        assert.match(waiting.body, /Starting slow/);
        assert.strictEqual(waiting.headers['retry-after'], '2');

        const status = await fetch_host({port: running.port, host: 'slow.test', path: '/__serviceman__/status.json'});
        assert.strictEqual(JSON.parse(status.body).phase, 'starting');

        await running.app.service_by_name.slow.state.instances[0].start_promise;
        const page = await fetch_host({port: running.port, host: 'slow.test', path: '/', headers: {accept: 'text/html'}});
        assert.strictEqual(page.status, 200);
        assert.match(page.body, /hello from serviceman-slow/);
    }
    finally {
        delete process.env.SERVICEMAN_TEST_BOOT_MS;
        await running.close();
    }
});

test('the control page lists the services and starts and stops them', async function () {
    const running = await serviceman_start([
        {name: 'one', type: 'docker', publish: {host: 'one.test', port: 8080}, image: 'demo/one'},
        {name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'},
    ]);
    try {
        const page = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/'});
        assert.strictEqual(page.status, 200);
        assert.match(page.body, /<title>serviceman<\/title>/);
        assert.strictEqual(page.headers['content-security-policy'], 'frame-ancestors \'none\'', 'the control page is nobody\'s to frame');

        // The page answers on the addresses it has, and a mistyped one is a 404 — not the
        // front page opening whatever it opens first
        for (const known of ['/services/one', '/services/one/settings', '/services/new', '/remotes/vps1/files', '/remotes/vps1/shell/work-2', '/secrets', '/storage', '/logline', '/authwall', '/load-tests']) {
            const opened = await fetch_host({port: running.control_port, host: '127.0.0.1', path: known});
            assert.strictEqual(opened.status, 200, known);
            assert.match(opened.body, /<title>serviceman<\/title>/, known);
        }
        for (const wrong of ['/nothing-here', '/routes', '/log', '/services/ghost', '/services/one/nothing', '/remotes/ghost', '/services/one/settings/more', '/remotes/vps1/files/more', '/remotes/ghost/shell/work', '/remotes/vps1/shell/a.b', '/remotes/vps1/shell/work/more']) {
            const missing = await fetch_host({port: running.control_port, host: '127.0.0.1', path: wrong});
            assert.strictEqual(missing.status, 404, wrong);
            assert.match(missing.body, /No such page/, wrong);
        }

        const before = await state_read(running);
        assert.deepStrictEqual(before.services.map(v => v.name), ['one', 'site']);
        assert.strictEqual(before.services[0].phase, 'stopped');
        assert.strictEqual(before.services[1].phase, 'running');

        const started = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/one/start', method: 'POST'});
        assert.strictEqual(started.status, 202);
        await running.app.service_by_name.one.state.instances[0].start_promise;
        const up = await state_read(running);
        assert.strictEqual(up.services[0].phase, 'running');
        assert.match(up.services[0].upstream, /^127.0.0.1:\d+$/);

        const stopped = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/one/stop', method: 'POST'});
        assert.strictEqual(stopped.status, 202);
        await running.app.service_by_name.one.state.stop_promise;
        const down = await state_read(running);
        assert.strictEqual(down.services[0].phase, 'stopped');

        const refused = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/site/start', method: 'POST'});
        assert.strictEqual(refused.status, 400);

        const missing = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/ghost/start', method: 'POST'});
        assert.strictEqual(missing.status, 404);

        const by_host = await fetch_host({port: running.port, host: 'serviceman.localhost', path: '/api/v1/status'});
        assert.strictEqual(by_host.status, 200);
    }
    finally {
        await running.close();
    }
});

test('a container that already runs is adopted, not started again', async function () {
    const first = await serviceman_start([
        {name: 'kept', type: 'docker', publish: {host: 'kept.test', port: 8080}, image: 'demo/kept'},
    ]);
    const state_file = process.env.SERVICEMAN_TEST_STATE;
    await fetch_host({port: first.port, host: 'kept.test', path: '/'});
    const upstream = first.app.service_by_name.kept.state.instances[0].upstream;
    await first.close(false);

    process.env.SERVICEMAN_TEST_STATE = state_file;
    const second = await serviceman_start([
        {name: 'kept', type: 'docker', publish: {host: 'kept.test', port: 8080}, image: 'demo/kept'},
    ], {state_file});
    try {
        await service_probe(second.app, second.app.service_by_name.kept);
        assert.strictEqual(service_phase(second.app.service_by_name.kept), 'running');
        assert.deepStrictEqual(second.app.service_by_name.kept.state.instances[0].upstream, upstream);
    }
    finally {
        await second.close();
    }
});

test('a container that names a path keeps it, in a folder the agent makes for it', async function () {
    const running = await serviceman_start([
        // A path and nothing else: the same line a program of the shell kind writes
        {name: 'notes', type: 'docker', publish: {host: 'notes.test', port: 3000}, image: 'vbarbarosh/notes', volumes: [':/app/data']},
    ]);
    try {
        await fetch_host({port: running.port, host: 'notes.test', path: '/'});
        const kept = path.join(running.agent_dir, 'data', 'notes', 'app-data');
        assert.strictEqual(fs.existsSync(kept), true, 'the folder is there before the container is, or docker would make it as root');
        const created = state_file_read(process.env.SERVICEMAN_TEST_STATE).containers['serviceman-notes'];
        assert.deepStrictEqual(created.volumes, [`${kept}:/app/data`], 'and the container is given the path, not a name of anybody\'s');

        const view = (await state_read(running)).services.find(v => v.name === 'notes');
        assert.deepStrictEqual(view.storage, [{kind: 'kept', source: '', target: '/app/data', readonly: false}]);
    }
    finally {
        await running.close();
    }
});

test('a folder for storage is made before the container starts, and a changed definition recreates it', async function () {
    const storage = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-storage-')), 'uploads');
    const running = await serviceman_start([
        {name: 'app', type: 'docker', publish: {host: 'app.test', port: 8080}, image: 'demo/app', volumes: [`${storage}:/uploads`]},
    ]);
    const state_file = process.env.SERVICEMAN_TEST_STATE;
    try {
        assert.strictEqual(fs.existsSync(storage), false);
        await fetch_host({port: running.port, host: 'app.test', path: '/'});
        assert.strictEqual(fs.existsSync(storage), true);
        const created = state_file_read(state_file).containers['serviceman-app'];
        assert.deepStrictEqual(created.volumes, [`${storage}:/uploads`]);

        // What a visitor may ask is whether it is up, what step it is on, and what was said
        // while it came up; the storage is on the control page
        const seen = await fetch_host({port: running.port, host: 'app.test', path: '/__serviceman__/status.json'});
        const status = JSON.parse(seen.body);
        assert.strictEqual(status.phase, 'running');
        assert.strictEqual(status.error, null);
        assert.strictEqual(status.doing, null);
        assert.ok(status.said.includes('making the container from demo/app'));

        const view = (await state_read(running)).services.find(v => v.name === 'app');
        assert.deepStrictEqual(view.storage, [
            {kind: 'path', source: storage, target: '/uploads', readonly: false},
        ]);
    }
    finally {
        await running.close();
    }

    const changed = await serviceman_start([
        {name: 'app', type: 'docker', publish: {host: 'app.test', port: 8080}, image: 'demo/app', volumes: [`${storage}:/uploads`, `${storage}:/backup:ro`]},
    ], {state_file});
    try {
        await fetch_host({port: changed.port, host: 'app.test', path: '/'});
        const again = state_file_read(state_file).containers['serviceman-app'];
        assert.deepStrictEqual(again.volumes, [`${storage}:/uploads`, `${storage}:/backup:ro`]);
        assert.ok(changed.app.log_lines.some(v => /\[docker_recreate\] service=app container=serviceman-app/.test(v)));
    }
    finally {
        await changed.close();
    }
});

test('concurrency 1 serves two requests one after the other on one instance', async function () {
    const running = await serviceman_start([
        {name: 'lane', type: 'docker', publish: {host: 'lane.test', port: 8080}, image: 'demo/lane', policy: {concurrency: 1, warmup: {queue: 9, wait: '10s'}}},
    ]);
    try {
        const time0 = Date.now();
        const both = await Promise.all([
            fetch_host({port: running.port, host: 'lane.test', path: '/slow/300'}),
            fetch_host({port: running.port, host: 'lane.test', path: '/slow/300'}),
        ]);
        assert.strictEqual(both[0].status, 200);
        assert.strictEqual(both[1].status, 200);
        assert.ok(Date.now() - time0 >= 600, 'the second request waited for the first');
        assert.strictEqual(state_file_read(process.env.SERVICEMAN_TEST_STATE).containers['serviceman-lane-2'], undefined);
    }
    finally {
        await running.close();
    }
});

test('a full instance warms a second one, and both answer', async function () {
    const running = await serviceman_start([
        {name: 'pair', type: 'docker', publish: {host: 'pair.test', port: 8080}, image: 'demo/pair', policy: {concurrency: 1, instances: {max: 2}, warmup: {queue: 1, wait: '5s'}}},
    ]);
    const service = running.app.service_by_name.pair;
    try {
        const both = await Promise.all([
            fetch_host({port: running.port, host: 'pair.test', path: '/slow/800'}),
            fetch_host({port: running.port, host: 'pair.test', path: '/slow/800'}),
        ]);
        assert.strictEqual(both[0].status, 200);
        assert.strictEqual(both[1].status, 200);
        // Two answers from two containers is what tells "they overlapped" from "they queued":
        // a clock would have to allow for two starts over the link, on a machine that may be busy
        assert.notStrictEqual(both[0].headers['x-service'], both[1].headers['x-service'], 'the second request rode the second instance');
        assert.strictEqual(service.state.instances[1].phase, 'running');
        assert.ok(state_file_read(process.env.SERVICEMAN_TEST_STATE).containers['serviceman-pair-2'] !== undefined);
    }
    finally {
        await running.close();
    }
});

test('the pool grows while the work is there, and shrinks when it is not', async function () {
    const running = await serviceman_start([
        {name: 'crew', type: 'docker', publish: {host: 'crew.test', port: 8080}, image: 'demo/crew', policy: {
            concurrency: 1,
            instances: {min: 1, max: 3},
            autoscale: {busy_up: 0.7, up_for: '0s', busy_down: 0.2, down_for: '0s', cool_down: '0s'},
        }},
    ]);
    const service = running.app.service_by_name.crew;
    try {
        // One copy, one request in flight: the pool is full, and full is over the threshold
        const slow = fetch_host({port: running.port, host: 'crew.test', path: '/slow/1500'});
        await wait_until(() => service.state.instances[0].phase === 'running');
        await wait_until(() => service_inflight(service) === 1);

        reap_idle(running.app);
        await wait_until(() => service.state.instances.filter(v => (v.phase === 'running') || (v.phase === 'starting')).length === 2);
        assert.strictEqual(running.app.log_lines.some(v => /\[service_scale_up\] service=crew instance=2 of=3 reason="busy 1\.00 of 0\.\d+ for /.test(v)), true);
        assert.strictEqual((await slow).status, 200);

        // The work is done, so the copy that is not needed goes; the floor of one stays
        await wait_until(() => service_inflight(service) === 0);
        reap_idle(running.app);
        await wait_until(() => service.state.instances.filter(v => v.phase === 'running').length === 1, 8000);
        assert.strictEqual(running.app.log_lines.some(v => /\[service_scale_down\] service=crew instance=\d+ left=1 reason="busy 0\.00 for /.test(v)), true);
    }
    finally {
        await running.close();
    }
});

test('an image that is not on the machine is pulled before anyone asks for it', async function () {
    const running = await serviceman_start([
        {name: 'fresh', type: 'docker', publish: {host: 'fresh.test', port: 8080}, image: 'far/fresh:1'},
        {name: 'here', type: 'docker', publish: {host: 'here.test', port: 8080}, image: 'demo/here'},
        {name: 'left', type: 'docker', publish: {host: 'left.test', port: 8080}, image: 'far/left:1', policy: {prepull: false}},
    ]);
    try {
        image_prepull_start(running.app);
        await wait_until(() => running.app.log_lines.some(v => /\[image_pull_end_ok\] service=fresh image=far\/fresh:1 remote=vps1 took=\d+\.\d{3}s/.test(v)));
        assert.strictEqual(running.app.log_lines.some(v => /\[image_pull_begin\] service=fresh image=far\/fresh:1 remote=vps1/.test(v)), true);
        assert.strictEqual(running.app.log_lines.some(v => /\[image_pull_begin\] service=here/.test(v)), false, 'the image is already on the machine');
        assert.strictEqual(running.app.log_lines.some(v => /\[image_pull_begin\] service=left/.test(v)), false, 'prepull: false is left for the first visitor');

        // Asked again, it pulls nothing: what is there is never fetched a second time, so a
        // :latest tag cannot change under a service that is already running
        const before = running.app.log_lines.filter(v => v.includes('[image_pull_begin]')).length;
        image_prepull_start(running.app);
        await timers.setTimeout(300);
        assert.strictEqual(running.app.log_lines.filter(v => v.includes('[image_pull_begin]')).length, before);
    }
    finally {
        await running.close();
    }
});

test('the download of an image is a step with a name, and the page waiting says so', async function () {
    const running = await serviceman_start([
        // Not on the machine, and not fetched ahead of time: the visitor pays for the download
        {name: 'heavy', type: 'docker', publish: {host: 'heavy.test', port: 8080}, image: 'far/slow:1', policy: {prepull: false}},
    ]);
    const service = running.app.service_by_name.heavy;
    try {
        const visit = fetch_host({port: running.port, host: 'heavy.test', path: '/'});
        // The percentage the page shows is read off docker's own lines, layer by layer
        await wait_until(() => /so far/.test(service.state.progress_text || ''));
        const status = await fetch_host({port: running.port, host: 'heavy.test', path: '/__serviceman__/status.json'});
        const seen = JSON.parse(status.body);
        assert.match(seen.doing, /^Downloading far\/slow:1 — \d+%$/, 'the step, and how far it is — not `starting` for four minutes');
        assert.match(seen.progress_text, /layers left · [0-9.]+MB so far/, 'and the numbers behind it, counted in layers docker has named');
        assert.ok((seen.progress > 0) && (seen.progress <= 1), `a bar can be drawn from ${seen.progress}`);
        assert.ok(seen.said.includes('the image far/slow:1 is not on this machine yet — downloading it'));
        assert.ok(seen.said.some(v => /Downloading \[/.test(v)) === false, 'and the layer lines themselves are not shown: they are a wall, not a status');

        assert.strictEqual((await visit).status, 200);
        assert.strictEqual(service.state.doing, null, 'the step is over when the download is');
        assert.strictEqual(service.state.progress, null);
        assert.ok(service.state.said.includes('making the container from far/slow:1'));
        assert.ok(running.app.log_lines.some(v => /\[image_pull_end_ok\] service=heavy image=far\/slow:1 remote=vps1/.test(v)));
        assert.ok(running.app.log_lines.some(v => /\[agent_call_stdout\] a1b2c3d4e5f6: Downloading/.test(v)), 'every line docker printed over there is in the log here, as it printed it');
    }
    finally {
        await running.close();
    }
});

test('every container serviceman makes gets an init, and the ones from before are replaced', async function () {
    const state_file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-init-')), 'docker.json');
    const running = await serviceman_start([
        {name: 'whoami', type: 'docker', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'},
    ], {state_file});
    const service = running.app.service_by_name.whoami;
    try {
        await fetch_host({port: running.port, host: 'whoami.test', path: '/'});
        const asked = state_file_read(state_file).commands.find(v => v.startsWith('run '));
        assert.match(asked, /^run -d --init /, 'pid 1 of the container is an init, not the program itself');

        // A program that runs in an image of its own is built by the other door, and gets it too
        const inside = program_docker_argv({
            container: 'serviceman-writer', service: 'writer', spec: 'x', dir: '/srv/writer',
            image: 'node:24', command: 'bin/run', port: 8090, volumes: [],
        });
        assert.deepStrictEqual(inside.slice(0, 3), ['run', '-d', '--init']);
    }
    finally {
        await running.close();
    }

    // A container made before the flag existed: its spec carries the old run line. Nobody
    // deletes it by hand — the version in the spec hash makes it old, and the next start
    // replaces it with one that has the init.
    const state = state_file_read(state_file);
    state.containers['serviceman-whoami'].spec = 'made-by-an-older-serviceman';
    fs.writeFileSync(state_file, JSON.stringify(state));
    const again = await serviceman_start([
        {name: 'whoami', type: 'docker', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'},
    ], {state_file});
    try {
        assert.strictEqual((await fetch_host({port: again.port, host: 'whoami.test', path: '/'})).status, 200);
        assert.ok(again.app.log_lines.some(v => /\[docker_recreate\] service=whoami container=serviceman-whoami/.test(v)));
        assert.strictEqual(state_file_read(state_file).containers['serviceman-whoami'].spec, docker_spec_hash(again.app.service_by_name.whoami), 'and what runs now carries the current spec');
    }
    finally {
        await again.close();
    }
});

test('a program that drops the signal is stopped anyway, and the whole chain goes with it', async function () {
    const port = await free_port();
    // What bin/run does in real life: a shell that starts a server and passes nothing on. The
    // server here also ignores SIGTERM, which is what npm looks like from the outside.
    const deaf = `${process.execPath} -e "process.on('SIGTERM', function () {}); require('http').createServer(function (req, res) { res.end('still here'); }).listen(${port}, '127.0.0.1');"`;
    const running = await serviceman_start([
        {name: 'chain', type: 'shell', publish: {host: 'chain.test', port}, command: `${deaf} & wait`},
    ]);
    const service = running.app.service_by_name.chain;
    try {
        assert.strictEqual((await fetch_host({port: running.port, host: 'chain.test', path: '/'})).body, 'still here');
        const pid = service.state.instances[0].pid;

        const time0 = Date.now();
        await service_stop(running.app, service, 'the test asked');
        const took = Date.now() - time0;
        assert.ok(took >= 1000, `it was given its time to stop by itself, not killed at once (${took}ms)`);

        // The point of it: nothing of the chain is left, and the port is free the moment the
        // stop says it is over — not five seconds later
        assert.strictEqual(await port_free(port), true, 'the server under the shell went too');
        assert.strictEqual(group_alive(pid), false, 'and so did everything else in its group');
        assert.ok(running.app.log_lines.some(v => /\[program_killed\] \d+\.\d{3}s service=chain pid=\d+ note="it was asked to stop and did not"/.test(v)), 'and the log says which program had to be killed');
    }
    finally {
        await running.close();
    }
});

test('a service that stopped is not still up: no machine, no address, no clock', async function () {
    const running = await serviceman_start([
        {name: 'notes', type: 'docker', publish: {host: 'notes.test', port: 8080}, image: 'demo/notes'},
    ]);
    const service = running.app.service_by_name.notes;
    const instance = service.state.instances[0];
    try {
        assert.strictEqual((await fetch_host({port: running.port, host: 'notes.test', path: '/'})).status, 200);
        assert.ok(view_from_service(service).uptime_ms >= 0, 'while it runs, it has been up for a while');
        assert.strictEqual(view_from_service(service).instances[0].container, 'serviceman-notes', 'its container, by the name its Files tab finds it by');
        assert.strictEqual(view_from_service(service).folder, null, 'a folder is a program\'s');

        // The container goes without serviceman being told — the machine was rebooted, or
        // somebody stopped it by hand. The next request finds nothing at the address.
        child_process.spawnSync(DOCKER_BIN, ['rm', '--force', 'serviceman-notes']);
        const gone = await fetch_host({port: running.port, host: 'notes.test', path: '/'});
        assert.strictEqual(gone.status, 502);

        const view = view_from_service(service);
        assert.strictEqual(view.phase, 'stopped');
        assert.strictEqual(view.uptime_ms, null, 'a stopped service is not up for anything');
        assert.strictEqual(view.started_at, null);
        assert.strictEqual(view.upstream, null);
        assert.strictEqual(instance.remote, null, 'and it holds no machine');
        assert.ok(instance.stopped_at !== null);
    }
    finally {
        await running.close();
    }
});

test('a service with no autoscale in its policy is left exactly as it was', async function () {
    const running = await serviceman_start([
        {name: 'plain', type: 'docker', publish: {host: 'plain.test', port: 8080}, image: 'demo/plain', policy: {concurrency: 1, instances: {min: 1, max: 3}}},
    ]);
    const service = running.app.service_by_name.plain;
    try {
        const slow = fetch_host({port: running.port, host: 'plain.test', path: '/slow/600'});
        await wait_until(() => service_inflight(service) === 1);
        reap_idle(running.app);
        reap_idle(running.app);
        assert.strictEqual(service.state.instances.filter(v => (v.phase === 'running') || (v.phase === 'starting')).length, 1, 'nothing grows on its own without autoscale');
        assert.strictEqual((await slow).status, 200);
        assert.strictEqual(running.app.log_lines.some(v => /\[service_scale_(up|down)\] service=plain/.test(v)), false);
    }
    finally {
        await running.close();
    }
});

test('a request that waits longer than request_timeout is answered with 504', async function () {
    const running = await serviceman_start([
        {name: 'jam', type: 'docker', publish: {host: 'jam.test', port: 8080}, image: 'demo/jam', policy: {concurrency: 1, request_timeout: '400ms', warmup: {queue: 9, wait: '10s'}}},
    ]);
    try {
        const answers = await Promise.all([
            fetch_host({port: running.port, host: 'jam.test', path: '/slow/300'}),
            fetch_host({port: running.port, host: 'jam.test', path: '/slow/300'}),
        ]);
        const codes = answers.map(v => v.status).sort();
        assert.deepStrictEqual(codes, [200, 504]);
    }
    finally {
        await running.close();
    }
});

test('a slow answer of the service itself is cut at request_timeout', async function () {
    const running = await serviceman_start([
        {name: 'drag', type: 'docker', publish: {host: 'drag.test', port: 8080}, image: 'demo/drag', policy: {request_timeout: '300ms'}},
    ]);
    try {
        const quick = await fetch_host({port: running.port, host: 'drag.test', path: '/'});
        assert.strictEqual(quick.status, 200);
        const cut = await fetch_host({port: running.port, host: 'drag.test', path: '/slow/2000'});
        assert.strictEqual(cut.status, 504);
        assert.match(cut.body, /did not answer in time/);
    }
    finally {
        await running.close();
    }
});

test('an extra instance is stopped when its work dries up, the first one stays', async function () {
    const running = await serviceman_start([
        {name: 'tide', type: 'docker', publish: {host: 'tide.test', port: 8080}, image: 'demo/tide', policy: {concurrency: 1, instances: {max: 2}, scale_down_after: '1s', warmup: {queue: 1, wait: '5s'}}},
    ]);
    const service = running.app.service_by_name.tide;
    try {
        await Promise.all([
            fetch_host({port: running.port, host: 'tide.test', path: '/slow/300'}),
            fetch_host({port: running.port, host: 'tide.test', path: '/slow/300'}),
        ]);
        // Both requests can finish on the first instance while the extra one is still coming up;
        // it was asked for either way
        await wait_until(() => service.state.instances[1].phase === 'running');

        service.state.instances[1].last_activity_at = Date.now() - 5000;
        reap_idle(running.app);
        await service.state.instances[1].stop_promise;
        assert.strictEqual(service.state.instances[1].phase, 'stopped');
        assert.strictEqual(service.state.instances[0].phase, 'running');
        assert.strictEqual(service_phase(service), 'running');
    }
    finally {
        await running.close();
    }
});

test('instances.min starts the whole floor at the first visit', async function () {
    const running = await serviceman_start([
        {name: 'crew', type: 'docker', publish: {host: 'crew.test', port: 8080}, image: 'demo/crew', policy: {instances: {min: 2, max: 3}}},
    ]);
    const service = running.app.service_by_name.crew;
    try {
        const first = await fetch_host({port: running.port, host: 'crew.test', path: '/'});
        assert.strictEqual(first.status, 200);
        if (service.state.instances[1].start_promise !== null) {
            await service.state.instances[1].start_promise;
        }
        assert.strictEqual(service.state.instances[0].phase, 'running');
        assert.strictEqual(service.state.instances[1].phase, 'running');
        assert.strictEqual(service.state.instances[2].phase, 'stopped');
    }
    finally {
        await running.close();
    }
});

test('an upstream that cuts the answer mid-stream leaves serviceman serving', async function () {
    const running = await serviceman_start([
        {name: 'flaky', type: 'docker', publish: {host: 'flaky.test', port: 8080}, image: 'demo/flaky'},
    ]);
    try {
        const warm = await fetch_host({port: running.port, host: 'flaky.test', path: '/'});
        assert.strictEqual(warm.status, 200);
        const time0 = Date.now();
        await socket_burn(running.port, 'GET /cut HTTP/1.1\r\nhost: flaky.test\r\n\r\n', null);
        assert.ok(Date.now() - time0 < 2000, 'the cut answer reaches the client as a cut, not as a hang');
        const after = await fetch_host({port: running.port, host: 'flaky.test', path: '/'});
        assert.strictEqual(after.status, 200);
    }
    finally {
        await running.close();
    }
});

test('a client that vanishes mid-request leaves serviceman serving', async function () {
    const running = await serviceman_start([
        {name: 'flaky', type: 'docker', publish: {host: 'flaky.test', port: 8080}, image: 'demo/flaky'},
    ]);
    const service = running.app.service_by_name.flaky;
    try {
        const warm = await fetch_host({port: running.port, host: 'flaky.test', path: '/'});
        assert.strictEqual(warm.status, 200);
        await socket_burn(running.port, 'GET /slow/400 HTTP/1.1\r\nhost: flaky.test\r\n\r\n', 100);
        await timers.setTimeout(600);
        assert.strictEqual(service.state.instances[0].phase, 'running');
        const after = await fetch_host({port: running.port, host: 'flaky.test', path: '/'});
        assert.strictEqual(after.status, 200);
    }
    finally {
        await running.close();
    }
});

test('a websocket client that vanishes during the wake leaves serviceman serving', async function () {
    process.env.SERVICEMAN_TEST_BOOT_MS = '1200';
    const running = await serviceman_start([
        {name: 'slowsock', type: 'docker', publish: {host: 'slowsock.test', port: 8080}, image: 'demo/slowsock'},
    ]);
    const service = running.app.service_by_name.slowsock;
    try {
        await socket_burn(running.port, 'GET /echo HTTP/1.1\r\nhost: slowsock.test\r\nconnection: Upgrade\r\nupgrade: echo\r\n\r\n', 200);
        for (const instance of service.state.instances) {
            if (instance.start_promise !== null) {
                await instance.start_promise.catch(function () {});
            }
        }
        delete process.env.SERVICEMAN_TEST_BOOT_MS;
        const after = await fetch_host({port: running.port, host: 'slowsock.test', path: '/'});
        assert.strictEqual(after.status, 200);
    }
    finally {
        delete process.env.SERVICEMAN_TEST_BOOT_MS;
        await running.close();
    }
});

test('a scale-up aimed at an instance that is still stopping does not spin', async function () {
    const running = await serviceman_start([
        {name: 'crew', type: 'docker', publish: {host: 'crew.test', port: 8080}, image: 'demo/crew', policy: {instances: {min: 2, max: 2}}},
    ]);
    const service = running.app.service_by_name.crew;
    const state = service.state;
    try {
        state.instances[0].phase = 'running';
        state.instances[0].upstream = {host: '127.0.0.1', port: 1};
        state.instances[1].phase = 'stopping';
        state.instances[1].stop_promise = new Promise(function () {});
        await service_ensure_running(running.app, service);
        assert.notStrictEqual(state.instances[1].start_promise, null);
        const lines = running.app.log_lines.filter(v => v.includes('[service_scale_up] service=crew instance=2'));
        assert.strictEqual(lines.length, 1);
    }
    finally {
        await running.close();
    }
});

test('one hostname is shared by services on different path prefixes', async function () {
    const running = await serviceman_start([
        {name: 'one', type: 'docker', publish: {host: 'tools.test/one', port: 8080}, image: 'demo/one'},
        {name: 'two', type: 'docker', publish: {host: 'tools.test/two', port: 8080, strip_prefix: true}, image: 'demo/two'},
    ]);
    try {
        const kept = await fetch_host({port: running.port, host: 'tools.test', path: '/one/report?q=1'});
        assert.strictEqual(kept.status, 200);
        assert.match(kept.body, /hello from serviceman-one at tools.test\/one\/report\?q=1/);

        const stripped = await fetch_host({port: running.port, host: 'tools.test', path: '/two/report?q=1'});
        assert.strictEqual(stripped.status, 200);
        assert.match(stripped.body, /hello from serviceman-two at tools.test\/report\?q=1/);

        const bare = await fetch_host({port: running.port, host: 'tools.test', path: '/two'});
        assert.strictEqual(bare.status, 200);
        assert.match(bare.body, /hello from serviceman-two at tools.test\/\n/);

        const status = await fetch_host({port: running.port, host: 'tools.test', path: '/one/__serviceman__/status.json'});
        assert.strictEqual(status.status, 200);
        const said = JSON.parse(status.body);
        assert.strictEqual(said.phase, 'running');
        // The story of that start, kept for the page that waited on it. What follows depends
        // on how long it took — a slow one also carries what it was waiting for.
        assert.ok(said.said.includes('making the container from demo/one'));
        assert.ok(said.said.includes('serviceman-one'));

        const stranger = await fetch_host({port: running.port, host: 'tools.test', path: '/three'});
        assert.strictEqual(stranger.status, 404);
    }
    finally {
        await running.close();
    }
});

test('the waiting page of a path-scoped service polls under its own prefix', async function () {
    process.env.SERVICEMAN_TEST_BOOT_MS = '4000';
    const running = await serviceman_start([
        {name: 'app', type: 'docker', publish: {host: 'tools.test/app', port: 8080}, image: 'demo/app'},
    ]);
    const service = running.app.service_by_name.app;
    try {
        const waiting = await fetch_host({port: running.port, host: 'tools.test', path: '/app/', headers: {accept: 'text/html'}});
        assert.strictEqual(waiting.status, 503);
        assert.match(waiting.body, /const prefix = "\/app";/);

        const status = await fetch_host({port: running.port, host: 'tools.test', path: '/app/__serviceman__/status.json'});
        assert.strictEqual(JSON.parse(status.body).phase, 'starting');

        for (const instance of service.state.instances) {
            if (instance.start_promise !== null) {
                await instance.start_promise.catch(function () {});
            }
        }
        delete process.env.SERVICEMAN_TEST_BOOT_MS;
        const after = await fetch_host({port: running.port, host: 'tools.test', path: '/app/', headers: {accept: 'text/html'}});
        assert.strictEqual(after.status, 200);
    }
    finally {
        delete process.env.SERVICEMAN_TEST_BOOT_MS;
        await running.close();
    }
});

test('the config is read, checked, saved and applied from the control page', async function () {
    const far = await far_server();
    const running = await serviceman_start_file({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [
            {name: 'edit', type: 'docker', remote: 'vps1', publish: {host: 'edit.test', port: 8080}, image: 'demo/edit'},
            {name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: `127.0.0.1:${far.port}`},
        ],
    });
    try {
        // The file is the operator's alone, every machine's token in it; a save keeps it so
        fs.chmodSync(running.config_path, 0o600);
        const loaded = await fetch_host({port: running.control_port, path: '/api/v1/config'});
        assert.strictEqual(loaded.status, 200);
        const editor = JSON.parse(loaded.body);
        assert.strictEqual(editor.text, fs.readFileSync(running.config_path, 'utf8'));

        const nonsense = await fetch_host({port: running.control_port, path: '/api/v1/config/check', method: 'POST', body: JSON.stringify({text: '{"services": [{"name": "x"}]}'})});
        assert.strictEqual(JSON.parse(nonsense.body).ok, false);
        assert.match(JSON.parse(nonsense.body).error, /hostname/);

        const fine = await fetch_host({port: running.control_port, path: '/api/v1/config/check', method: 'POST', body: JSON.stringify({text: editor.text})});
        assert.strictEqual(JSON.parse(fine.body).ok, true);

        const warm = await fetch_host({port: running.port, host: 'edit.test', path: '/'});
        assert.strictEqual(warm.status, 200);
        const kept_instance = running.app.service_by_name.edit.state.instances[0];

        const next = JSON.parse(editor.text);
        next.services = [
            next.services[0],
            {name: 'extra', type: 'external', publish: {host: 'extra.test'}, upstream: `127.0.0.1:${far.port}`},
        ];
        const next_text = JSON.stringify(next, null, 4);
        const saved = await fetch_host({port: running.control_port, path: '/api/v1/config', method: 'POST', body: JSON.stringify({text: next_text, hash: editor.hash})});
        assert.strictEqual(saved.status, 200);
        const outcome = JSON.parse(saved.body);
        assert.strictEqual(outcome.ok, true);
        assert.strictEqual(outcome.restart_needed, false);
        assert.ok(outcome.notes.some(v => /extra: new service/.test(v)));
        assert.ok(outcome.notes.some(v => /site: removed from the config/.test(v)));
        assert.strictEqual(fs.readFileSync(running.config_path, 'utf8'), next_text);
        assert.strictEqual(fs.statSync(running.config_path).mode & 0o777, 0o600, 'the editor\'s save kept the mode');

        assert.strictEqual(running.app.service_by_name.edit.state.instances[0], kept_instance);
        assert.strictEqual(kept_instance.phase, 'running');

        const extra = await fetch_host({port: running.port, host: 'extra.test', path: '/'});
        assert.strictEqual(extra.status, 200);
        const gone = await fetch_host({port: running.port, host: 'site.test', path: '/'});
        assert.strictEqual(gone.status, 404);

        const stale = await fetch_host({port: running.control_port, path: '/api/v1/config', method: 'POST', body: JSON.stringify({text: next_text, hash: editor.hash})});
        assert.strictEqual(stale.status, 409);

        const broken = await fetch_host({port: running.control_port, path: '/api/v1/config', method: 'POST', body: JSON.stringify({text: 'not a json', hash: outcome.hash})});
        assert.strictEqual(broken.status, 400);
        assert.strictEqual(fs.readFileSync(running.config_path, 'utf8'), next_text);

        // A card's save goes through the other writer, and keeps the mode as well
        const added = await fetch_host({port: running.control_port, path: '/api/v1/services', method: 'POST', body: JSON.stringify({service: {name: 'added', type: 'external', publish: {host: 'added.test'}, upstream: `127.0.0.1:${far.port}`}})});
        assert.strictEqual(added.status, 200, added.body);
        assert.strictEqual(fs.statSync(running.config_path).mode & 0o777, 0o600, 'the card\'s save kept the mode');
    }
    finally {
        far.close();
        await running.close();
    }
});

test('a service is created, reshaped and removed through the control api', async function () {
    const far = await far_server();
    const running = await serviceman_start_file({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [
            {name: 'keeper', type: 'docker', remote: 'vps1', publish: {host: 'keeper.test', port: 8080}, image: 'demo/keeper'},
        ],
    });
    function file_json() {
        return JSON.parse(fs.readFileSync(running.config_path, 'utf8'));
    }
    try {
        const created = await fetch_host({port: running.control_port, path: '/api/v1/services', method: 'POST', body: JSON.stringify({
            service: {name: 'pages', type: 'external', publish: {host: 'pages.test'}, upstream: `127.0.0.1:${far.port}`},
        })});
        assert.strictEqual(created.status, 200);
        assert.ok(JSON.parse(created.body).notes.some(v => /pages: new service/.test(v)));
        assert.deepStrictEqual(file_json().services.map(v => v.name), ['keeper', 'pages']);
        const page = await fetch_host({port: running.port, host: 'pages.test', path: '/'});
        assert.strictEqual(page.status, 200);

        const twice = await fetch_host({port: running.control_port, path: '/api/v1/services', method: 'POST', body: JSON.stringify({
            service: {name: 'pages', type: 'external', publish: {host: 'other.test'}, upstream: '127.0.0.1:1'},
        })});
        assert.strictEqual(twice.status, 400);
        assert.match(JSON.parse(twice.body).error, /already exists/);

        const reshaped = await fetch_host({port: running.control_port, path: '/api/v1/services/keeper', method: 'PUT', body: JSON.stringify({
            service: {name: 'keeper', type: 'docker', remote: 'vps1', publish: {host: 'keeper.test', port: 8080}, image: 'demo/keeper', policy: {stop_after_idle: '30m'}},
        })});
        assert.strictEqual(reshaped.status, 200);
        assert.ok(JSON.parse(reshaped.body).notes.some(v => /keeper: the definition changed/.test(v)));
        assert.strictEqual(file_json().services[0].policy.stop_after_idle, '30m');

        const nonsense = await fetch_host({port: running.control_port, path: '/api/v1/services/keeper', method: 'PUT', body: JSON.stringify({
            service: {name: 'keeper', type: 'docker', remote: 'vps1', publish: {host: 'keeper.test', port: 8080}},
        })});
        assert.strictEqual(nonsense.status, 400);
        assert.match(JSON.parse(nonsense.body).error, /image/);
        assert.strictEqual(file_json().services[0].policy.stop_after_idle, '30m');

        const ghost = await fetch_host({port: running.control_port, path: '/api/v1/services/ghost', method: 'PUT', body: JSON.stringify({
            service: {name: 'ghost', type: 'external', publish: {host: 'ghost.test'}, upstream: '127.0.0.1:1'},
        })});
        assert.strictEqual(ghost.status, 404);

        const removed = await fetch_host({port: running.control_port, path: '/api/v1/services/pages', method: 'DELETE'});
        assert.strictEqual(removed.status, 200);
        assert.deepStrictEqual(file_json().services.map(v => v.name), ['keeper']);
        const gone = await fetch_host({port: running.port, host: 'pages.test', path: '/'});
        assert.strictEqual(gone.status, 404);

        const again = await fetch_host({port: running.control_port, path: '/api/v1/services/pages', method: 'DELETE'});
        assert.strictEqual(again.status, 404);
    }
    finally {
        far.close();
        await running.close();
    }
});

test('the daily file shows every request and every decision', async function () {
    const far = await far_server();
    const running = await serviceman_start([
        {name: 'whoami', type: 'docker', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'},
        {name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: `127.0.0.1:${far.port}`},
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logs-'));
    running.app.file_log = {dir, day: null, stream: null, dead: false};
    try {
        const hello = await fetch_host({port: running.port, host: 'whoami.test', path: '/hello'});
        assert.strictEqual(hello.status, 200);
        const page = await fetch_host({port: running.port, host: 'site.test', path: '/'});
        assert.strictEqual(page.status, 200);
        const ghost = await fetch_host({port: running.port, host: 'ghost.test', path: '/x'});
        assert.strictEqual(ghost.status, 404);
        await timers.setTimeout(150);

        const now = new Date();
        const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const text = fs.readFileSync(path.join(dir, `${day}.log`), 'utf8');
        assert.match(text, /\[docker_run\] service=whoami image=demo\/whoami/);
        assert.match(text, /\[service_start_end_ok\] \d+\.\d{3}s service=whoami instance=1 remote=vps1 upstream=127\.0\.0\.1:\d+ inside=8080 answered=200/);
        assert.match(text, /\[request_begin\] GET \/hello {"from":"","host":"whoami\.test","ip":"127\.0\.0\.1"}/);
        assert.match(text, /\[request_end\] 200 \d+\.\d{3}s/);
        assert.match(text, /\[request_begin\] GET \/ {"from":"","host":"site\.test","ip":"127\.0\.0\.1"}/);
        assert.match(text, /\[request_end\] 404 \d+\.\d{3}s/);

        // The start of the container sits under the request that asked for it
        const asked = /\[(c[a-zA-Z0-9]+)\]\[request_begin\] GET \/hello {"from":"","host":"whoami\.test"/.exec(text);
        assert.notStrictEqual(asked, null);
        assert.match(text, new RegExp(`\\[c[a-zA-Z0-9]+\\]\\[group_spawn\\] parent=${asked[1]}`));
    }
    finally {
        far.close();
        await running.close();
    }
});

test('a container whose port answers nothing never counts as ready, and the log names the port', async function () {
    process.env.SERVICEMAN_TEST_SLAM = '1';
    const running = await serviceman_start([
        {name: 'deaf', type: 'docker', publish: {host: 'deaf.test', port: 5000}, image: 'demo/deaf', policy: {start_timeout: '1s'}},
    ]);
    const service = running.app.service_by_name.deaf;
    try {
        const answer = await fetch_host({port: running.port, host: 'deaf.test', path: '/'});
        assert.strictEqual(answer.status, 502);
        assert.strictEqual(service_phase(service), 'failed', 'the port opened, so a socket probe would have called it ready');
        assert.match(service.state.last_error, /nothing answered on 127\.0\.0\.1:\d+ — .* — is publish.port \(5000\) the port it listens on inside\?/);
        assert.ok(running.app.log_lines.some(v => /\[service_start_end_error\] \d+\.\d{3}s service=deaf instance=1 failures=\d+ reason="nothing answered on /.test(v)));
    }
    finally {
        delete process.env.SERVICEMAN_TEST_SLAM;
        await running.close();
    }
});

test('a container that accepts before the app inside listens is waited for, not handed a visitor', async function () {
    process.env.SERVICEMAN_TEST_DEAF_MS = '900';
    const running = await serviceman_start([
        {name: 'slowboot', type: 'docker', publish: {host: 'slowboot.test', port: 8080}, image: 'demo/slowboot'},
    ]);
    try {
        const answer = await fetch_host({port: running.port, host: 'slowboot.test', path: '/hello'});
        assert.strictEqual(answer.status, 200, 'the first visitor is answered by the service, not by a reset');
        assert.match(answer.body, /hello from serviceman-slowboot/);
        assert.ok(running.app.log_lines.some(v => /\[service_start_end_ok\] \d+\.\d{3}s service=slowboot instance=1 remote=vps1 upstream=127\.0\.0\.1:\d+ inside=8080 answered=200/.test(v)));
    }
    finally {
        delete process.env.SERVICEMAN_TEST_DEAF_MS;
        await running.close();
    }
});

test('the form asks the image which port it exposes', async function () {
    const running = await serviceman_start([
        {name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'},
    ]);
    try {
        const known = await fetch_host({port: running.control_port, path: '/api/v1/image-ports?image=demo/whoami'});
        assert.deepStrictEqual(JSON.parse(known.body), {ports: [8080]});
        const stranger = await fetch_host({port: running.control_port, path: '/api/v1/image-ports?image=ghcr.io/nobody/nothing'});
        assert.deepStrictEqual(JSON.parse(stranger.body), {ports: []});
        const empty = await fetch_host({port: running.control_port, path: '/api/v1/image-ports'});
        assert.strictEqual(empty.status, 400);
    }
    finally {
        await running.close();
    }
});

test('a page of a failed service asks again by itself, a page of a wrong address does not', async function () {
    process.env.SERVICEMAN_TEST_SLAM = '1';
    const running = await serviceman_start([
        // A port that only ever resets is waited for until start_timeout, then the start fails
        {name: 'deaf', type: 'docker', publish: {host: 'deaf.test', port: 5000}, image: 'demo/deaf', policy: {start_timeout: '1s'}},
    ]);
    try {
        const browser = await fetch_host({port: running.port, host: 'deaf.test', path: '/', headers: {accept: 'text/html'}});
        assert.strictEqual(browser.status, 502);
        assert.match(browser.body, /Asking again in 2s/);
        assert.match(browser.body, /id="now"/);
        assert.match(browser.body, /localStorage.getItem\('serviceman.theme'\)/);
        assert.match(browser.body, /id="theme"/);

        const curl = await fetch_host({port: running.port, host: 'deaf.test', path: '/'});
        assert.strictEqual(curl.status, 502);
        assert.doesNotMatch(curl.body, /Asking again/);

        const stranger = await fetch_host({port: running.port, host: 'ghost.test', path: '/', headers: {accept: 'text/html'}});
        assert.strictEqual(stranger.status, 404);
        assert.doesNotMatch(stranger.body, /Asking again/);
        assert.match(stranger.body, /id="theme"/);
    }
    finally {
        delete process.env.SERVICEMAN_TEST_SLAM;
        await running.close();
    }
});

test('the Docker tab lists a machine\'s containers, starts and stops one, opens a shell in one, and updates a compose project', async function () {
    const socket_path = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-api-')), 'docker.sock');
    const api = await docker_api_start(socket_path);
    api.state.containers = [
        {Id: 'a'.repeat(64), Names: ['/shop-web-1'], Image: 'shop/web', State: 'running', Status: 'Up 2 hours', Created: 1759400000, Ports: [], Labels: {'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web', 'com.docker.compose.project.working_dir': '/srv/shop', 'com.docker.compose.project.config_files': '/srv/shop/compose.yml'}},
        {Id: 'b'.repeat(64), Names: ['/serviceman-boxy'], Image: 'demo/boxy', State: 'running', Status: 'Up 1 minute', Created: 1759410000, Ports: [], Labels: {}},
    ];
    const running = await serviceman_start([], {agent_env: {DOCKER_HOST: `unix://${socket_path}`}});
    try {
        const listed = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/remotes/vps1/docker/containers'});
        assert.strictEqual(listed.status, 200);
        assert.deepStrictEqual(JSON.parse(listed.body).items.map(v => [v.name, v.project, v.own]), [['shop-web-1', 'shop', false], ['serviceman-boxy', null, true]]);

        const stopped = await fetch_host({port: running.control_port, host: '127.0.0.1', path: `/api/v1/remotes/vps1/docker/containers/${'a'.repeat(64)}/stop`, method: 'POST'});
        assert.strictEqual(stopped.status, 200);
        assert.deepStrictEqual(api.state.asked, [`stop ${'a'.repeat(64)}`]);

        // A shell in any container of the machine, the one the Docker tab picked
        const shell = await shell_talk(running.control_port, null, ['ls\n'], `remote=vps1&container=${'a'.repeat(64)}`);
        assert.match(shell.notes[0], /^a shell in container aaaaaaaaaaaa on vps1$/);
        assert.match(shell.text, /# a{64} \$ ls/);
        const odd = await shell_talk(running.control_port, null, [], 'remote=vps1&container=nope');
        assert.match(odd.notes[0], /is not a container id/);

        // compose runs as the machine's docker command, in the project's own folder; the answer
        // is a stream serviceman keeps, read at its own address, from the start, to the end
        const update = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/remotes/vps1/docker/projects/shop/update', method: 'POST'});
        assert.strictEqual(update.status, 202);
        const started = JSON.parse(update.body);
        assert.strictEqual(started.url, `/api/v1/streams/${started.stream}`);
        const read = await fetch_host({port: running.control_port, host: '127.0.0.1', path: started.url});
        assert.strictEqual(read.status, 200);
        const steps = read.body.trim().split('\n').map(v => JSON.parse(v));
        assert.deepStrictEqual(steps.map(v => v.text || v.end), ['$ docker compose -p shop -f /srv/shop/compose.yml pull', 'compose pull', '$ docker compose -p shop -f /srv/shop/compose.yml up -d', 'compose -d', 'done']);
        const again = await fetch_host({port: running.control_port, host: '127.0.0.1', path: started.url});
        assert.strictEqual(again.body, read.body, 'read again once it ended, it is the same from the start');
        const listed_streams = JSON.parse((await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/streams?base=%2Fapi%2Fv1%2Fremotes%2Fvps1%2Fdocker'})).body).items;
        assert.deepStrictEqual(listed_streams.map(v => [v.id, v.title, v.state]), [[started.stream, 'shop · update', 'done']]);
        assert.strictEqual(running.app.log_lines.some(v => /\[docker_project_end_ok\] remote=vps1 project=shop action=update/.test(v)), true);
    }
    finally {
        await running.close();
        api.close();
    }
});

test('a shell is opened in the container of a running service', async function () {
    const socket_path = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-api-')), 'docker.sock');
    const api = await docker_api_start(socket_path);
    const running = await serviceman_start([
        {name: 'boxy', type: 'docker', publish: {host: 'boxy.test', port: 8080}, image: 'demo/boxy'},
        {name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'},
    ], {agent_env: {DOCKER_HOST: `unix://${socket_path}`}});
    try {
        const cold = await shell_talk(running.control_port, 'boxy', []);
        assert.match(cold.notes[0], /not running — start it first/);

        const warm = await fetch_host({port: running.port, host: 'boxy.test', path: '/'});
        assert.strictEqual(warm.status, 200);

        const shell = await shell_talk(running.control_port, 'boxy', ['whoami\n']);
        assert.match(shell.notes[0], /a shell in serviceman-boxy/);
        assert.match(shell.text, /# serviceman-boxy \$ /);
        assert.match(shell.text, /whoami/);
        assert.strictEqual(Object.keys(api.state.execs).length, 1);
        const created = api.state.execs.exec1.created;
        assert.strictEqual(created.Tty, true);
        assert.strictEqual(created.AttachStdin, true);
        assert.ok(created.Cmd.join(' ').includes('exec bash'));
        assert.ok(api.state.resizes.some(v => /h=30&w=100/.test(v)));

        const flat = await shell_talk(running.control_port, 'site', []);
        assert.match(flat.notes[0], /has no container of its own/);

        const ghost = await shell_talk(running.control_port, 'ghost', []);
        assert.match(ghost.notes[0], /no service named ghost/);
    }
    finally {
        api.close();
        await running.close();
    }
});

test('the shell door is closed when the config says so', async function () {
    const socket_path = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-api-')), 'docker.sock');
    const api = await docker_api_start(socket_path);
    const running = await serviceman_start([
        {name: 'boxy', type: 'docker', publish: {host: 'boxy.test', port: 8080}, image: 'demo/boxy'},
    ], {agent_env: {DOCKER_HOST: `unix://${socket_path}`}, config: {control: {host: 'serviceman.localhost', port: 0, shell: false}}});
    try {
        const warm = await fetch_host({port: running.port, host: 'boxy.test', path: '/'});
        assert.strictEqual(warm.status, 200);
        const shell = await shell_talk(running.control_port, 'boxy', []);
        assert.strictEqual(shell.closed_without_answer, true);
    }
    finally {
        api.close();
        await running.close();
    }
});

test('a program without a port is kept running, and stopped when asked', async function () {
    const running = await serviceman_start([
        {
            name: 'socket',
            type: 'shell',
            command: `${process.execPath} -e "console.log('the socket is open'); setInterval(function () {}, 1000);"`,
            policy: {start: 'always'},
        },
    ]);
    const service = running.app.service_by_name.socket;
    try {
        await service_ensure_running(running.app, service);
        assert.strictEqual(service_phase(service), 'running');
        assert.strictEqual(service.state.instances[0].upstream, null);
        const pid = service.state.instances[0].pid;
        assert.ok(pid > 0, 'the agent holds the child, and says which one');
        await timers.setTimeout(250);

        await service_stop(running.app, service, 'the test asked');
        assert.strictEqual(service_phase(service), 'stopped');
        assert.strictEqual(pid_alive(pid), false, 'and ended it');
    }
    finally {
        await running.close();
    }
});

test('a program with a port is proxied like any other service', async function () {
    const port = await free_port();
    const running = await serviceman_start([
        {
            name: 'tiny',
            type: 'shell',
            publish: {host: 'tiny.test', port},
            command: `${process.execPath} -e "require('http').createServer(function (req, res) { res.end('hello from the program at ' + req.url); }).listen(${port}, '127.0.0.1');"`,
            policy: {stop_after_idle: '1s'},
        },
    ]);
    const service = running.app.service_by_name.tiny;
    try {
        assert.strictEqual(service_phase(service), 'stopped');
        const answer = await fetch_host({port: running.port, host: 'tiny.test', path: '/now'});
        assert.strictEqual(answer.status, 200);
        assert.match(answer.body, /hello from the program at \/now/);

        service.state.instances[0].last_activity_at = Date.now() - 5000;
        reap_idle(running.app);
        await service.state.stop_promise;
        assert.strictEqual(service_phase(service), 'stopped');

        const again = await fetch_host({port: running.port, host: 'tiny.test', path: '/back'});
        assert.strictEqual(again.status, 200);
    }
    finally {
        await running.close();
    }
});

test('a program with an install line puts its folder in place once, and runs from there', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const running = await serviceman_start([
        {
            name: 'writer',
            type: 'shell',
            publish: {host: 'writer.test', port},
            cwd: path.join(dir, 'writer'),
            lifecycle: {install: `cp ${path.join(__dirname, 'fixtures', 'app_server.js')} server.js`},
            command: `${process.execPath} server.js ${port}`,
            policy: {stop_after_idle: '1s'},
        },
    ]);
    const service = running.app.service_by_name.writer;
    try {
        assert.strictEqual(service_phase(service), 'stopped', 'nothing is installed until somebody asks');

        const answer = await fetch_host({port: running.port, host: 'writer.test', path: '/now'});
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(answer.body, 'the app answers /now');
        assert.ok(fs.existsSync(path.join(dir, 'writer', 'server.js')), 'the install line put it there');
        assert.ok(running.app.log_lines.some(v => /\[program_step_end_ok\] \d+\.\d{3}s service=writer step=install cwd=/.test(v)));

        // Stopped and asked for again: the folder is already the app, so the line does not run
        service.state.instances[0].last_activity_at = Date.now() - 5000;
        reap_idle(running.app);
        await service.state.stop_promise;
        assert.strictEqual(service_phase(service), 'stopped');

        function step_lines() {
            return running.app.log_lines.filter(v => /step=install/.test(v)).length;
        }
        const installs = step_lines();
        const again = await fetch_host({port: running.port, host: 'writer.test', path: '/back'});
        assert.strictEqual(again.status, 200);
        assert.strictEqual(step_lines(), installs, 'the folder was already the program, so nothing was said about installing it');
    }
    finally {
        await running.close();
    }
});

// An app as a folder: bin/configure sets it up, bin/run serves it on the port it is given. The
// port is written once, as publish.port, and the program finds it as PORT
test('an app folder is configured once and served on the PORT it is given', async function () {
    const port = await free_port();
    const running = await serviceman_start([
        {
            name: 'appdir',
            type: 'shell',
            publish: {host: 'appdir.test', port},
            lifecycle: {install: `cp -R ${path.join(__dirname, 'fixtures', 'app_folder')}/. . && bin/configure`},
            command: 'bin/run',
        },
    ]);
    try {
        const answer = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(answer.body, `configured on ${port}`);
    }
    finally {
        await running.close();
    }
});

// An app folder takes a new version: the files sent to <folder>.new become the folder,
// bin/configure runs in it, and data/ comes over from the old one, over any data/ they brought
test('an app folder takes a new version and keeps its data/', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    app_version_write(folder, 'v1');
    fs.mkdirSync(path.join(folder, 'data'));
    fs.writeFileSync(path.join(folder, 'data', 'kept.txt'), 'written by v1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: 'bin/configure'}, command: 'bin/run'},
    ]);
    try {
        const first = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(first.body, 'v1 configured, data: written by v1');

        app_version_write(`${folder}.new`, 'v2');
        fs.mkdirSync(path.join(`${folder}.new`, 'data'));
        fs.writeFileSync(path.join(`${folder}.new`, 'data', 'kept.txt'), 'the zip\'s own, to be replaced');
        const replaced = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(replaced.status, 200, replaced.body);
        assert.strictEqual(JSON.parse(replaced.body).phase, 'running', 'it was running, so it runs again');
        assert.strictEqual(JSON.parse(replaced.body).data_dropped, true, 'the data/ the new files brought is said to be left out');

        const second = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(second.body, 'v2 configured, data: written by v1');
        assert.strictEqual(fs.existsSync(`${folder}.new`), false);
        assert.strictEqual(fs.existsSync(`${folder}.old`), false);
        assert.ok(running.app.log_lines.some(v => /\[service_replace_end_ok\] service=appdir data_dropped=true/.test(v)));

        // Nothing waits beside it: refused, and nothing touched
        const nothing = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(nothing.status, 409);
        assert.match(JSON.parse(nothing.body).error, /no new version waits at/);
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// From a script, the same in one call: the zip as the body of a PUT, read on this side, its
// own data/ left out and counted, its files sent beside the folder and put in its place
test('an app folder takes a new version as a zip sent by PUT, and keeps its data/', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    app_version_write(folder, 'v1');
    fs.mkdirSync(path.join(folder, 'data'));
    fs.writeFileSync(path.join(folder, 'data', 'kept.txt'), 'written by v1');
    // A second machine, with no agent, for a token that sees it alone; a second app folder,
    // never started, for a token kept to it alone
    const notes = path.join(dir, 'notes');
    app_version_write(notes, 'n1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: 'bin/configure'}, command: 'bin/run'},
        {name: 'notes', type: 'shell', publish: {host: 'notes.test', port: await free_port()}, cwd: notes, command: 'bin/run'},
    ], {config: {remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps2', token: 'fedcba9876543210fedcba9876543210'}]}});
    try {
        const first = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(first.body, 'v1 configured, data: written by v1');

        // Zipped as a working copy is: one top folder, its own data/ in it
        const v2 = path.join(dir, 'v2');
        app_version_write(v2, 'v2');
        fs.mkdirSync(path.join(v2, 'data'));
        fs.writeFileSync(path.join(v2, 'data', 'kept.txt'), 'the zip\'s own, never sent');
        const zip = folder_zip(v2, 'app-v2');
        const replaced = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: zip});
        assert.strictEqual(replaced.status, 200, replaced.body);
        const said = JSON.parse(replaced.body);
        assert.strictEqual(said.phase, 'running', 'it was running, so it runs again');
        assert.strictEqual(said.files, 3, 'bin/configure, bin/run and server.js went');
        assert.strictEqual(said.data_files, 1, 'the zip\'s own data/ was left out on this side');
        assert.strictEqual(said.data_dropped, false, 'so none of it reached the machine');

        const second = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(second.body, 'v2 configured, data: written by v1');
        assert.strictEqual(fs.existsSync(`${folder}.new`), false);
        assert.strictEqual(fs.existsSync(`${folder}.old`), false);
        assert.ok(running.app.log_lines.some(v => /\[service_zip_end_ok\] service=appdir files=3 bytes=\d+ data_files=1/.test(v)));

        // Refused before anything is sent, and said with the page's words: no app in it, not a
        // zip at all, nothing at all, and the wrong verb
        const no_run = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: folder_zip(path.join(v2, 'data'), 'notes')});
        assert.strictEqual(no_run.status, 400, no_run.body);
        assert.match(JSON.parse(no_run.body).error, /appdir\.zip has no bin\/run/);
        const not_zip = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: Buffer.from('not a zip at all')});
        assert.strictEqual(not_zip.status, 400);
        assert.match(JSON.parse(not_zip.body).error, /is not a zip/);
        const empty = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT'});
        assert.strictEqual(empty.status, 400);
        assert.match(JSON.parse(empty.body).error, /the body is empty/);
        const posted = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'POST', body: zip});
        assert.strictEqual(posted.status, 405);
        assert.strictEqual(fs.existsSync(`${folder}.new`), false, 'nothing was sent');
        const third = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(third.body, 'v2 configured, data: written by v1', 'the app is as it was');

        // A token sends one with the versions right, to the machines it sees and no other
        const reader = await token_make(running, {label: 'a reader', remotes: ['vps1'], rights: ['status']});
        const no_right = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: zip, token: reader});
        assert.deepStrictEqual([no_right.status, JSON.parse(no_right.body).error], [403, 'the token "a reader" may not send a new version of an app']);
        const away = await token_make(running, {label: 'the deployer of vps2', remotes: ['vps2'], rights: ['versions']});
        const not_seen = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: zip, token: away});
        assert.deepStrictEqual([not_seen.status, JSON.parse(not_seen.body).error], [403, 'the token "the deployer of vps2" may not see vps1']);
        assert.strictEqual(fs.existsSync(`${folder}.new`), false, 'refused before anything is sent');
        const deployer = await token_make(running, {label: 'the deployer', remotes: ['vps1'], rights: ['versions']});
        const v3 = path.join(dir, 'v3');
        app_version_write(v3, 'v3');
        const sent = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: folder_zip(v3, 'app-v3'), token: deployer});
        assert.strictEqual(sent.status, 200, sent.body);
        assert.strictEqual(JSON.parse(sent.body).data_files, null, 'this one brought no data/');
        const fourth = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(fourth.body, 'v3 configured, data: written by v1');

        // A token kept to one app folder sends to it alone, as the service page makes one
        const kept = await token_make(running, {label: 'the notes deployer', remotes: ['vps1'], rights: ['versions'], services: ['notes']});
        const other = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: zip, token: kept});
        assert.deepStrictEqual([other.status, JSON.parse(other.body).error], [403, 'the token "the notes deployer" may not send a new version of appdir: it is for notes']);
        const own = await token_make(running, {label: 'appdir: new versions', remotes: ['vps1'], rights: ['versions'], services: ['appdir']});
        const v4 = path.join(dir, 'v4');
        app_version_write(v4, 'v4');
        // A build bigger than one frame of the link carries: the tar goes to the machine in pieces
        fs.mkdirSync(path.join(v4, 'build'));
        fs.writeFileSync(path.join(v4, 'build', 'blob.bin'), Buffer.alloc(17*1024*1024, 7));
        const sent_own = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: folder_zip(v4, 'app-v4'), token: own});
        assert.strictEqual(sent_own.status, 200, sent_own.body);
        assert.ok(JSON.parse(sent_own.body).bytes > 17*1024*1024, 'the whole build went');
        const fifth = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(fifth.body, 'v4 configured, data: written by v1');
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// Two deploys at once: the second is refused while the first is still sending, instead of
// clearing <folder>.new under it, which left the first a folder with half its files
test('a zip sent while another is on its way is refused, and the first goes in whole', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    app_version_write(folder, 'v1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: 'bin/configure'}, command: 'bin/run'},
    ]);
    try {
        const first = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(first.body, 'v1 configured, data: none');
        const zips = [];
        for (const version of ['v2', 'v3']) {
            const source = path.join(dir, version);
            app_version_write(source, version);
            // Big enough that the tar is still being written when the other one comes
            fs.mkdirSync(path.join(source, 'build'));
            fs.writeFileSync(path.join(source, 'build', 'blob.bin'), Buffer.alloc(8*1024*1024, 7));
            zips.push(folder_zip(source, version));
        }
        const answers = await Promise.all(zips.map(v => fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: v})));
        const statuses = answers.map(v => v.status);
        assert.deepStrictEqual(statuses.slice().sort(), [200, 409], answers.map(v => v.body).join('\n'));
        const refused = answers.find(v => v.status === 409);
        assert.match(JSON.parse(refused.body).error, /^appdir is busy (checking its new version|sending its new version to \S+|taking its new version): try again when it is done$/);
        const won = (statuses[0] === 200) ? 'v2' : 'v3';
        const now = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(now.body, `${won} configured, data: none`);
        assert.strictEqual(fs.statSync(path.join(folder, 'build', 'blob.bin')).size, 8*1024*1024, 'the build came whole');
        assert.strictEqual(fs.existsSync(`${folder}.new`), false);
        assert.strictEqual(fs.existsSync(`${folder}.old`), false);

        // Once it is in, the next one goes
        const again = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: zips[(won === 'v2') ? 1 : 0]});
        assert.strictEqual(again.status, 200, again.body);
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// Ctrl+C on a deploy: the zip came in whole, and the sender hangs up while it goes to the
// machine. It stops there: no swap, the app as it was, and the next zip goes at once, where it
// was refused with 409 until the hung-up one had gone all the way
test('a sender that hangs up while its zip goes to the machine stops it, and the app stays as it was', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    app_version_write(folder, 'v1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: 'bin/configure'}, command: 'bin/run'},
    ]);
    try {
        const first = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(first.body, 'v1 configured, data: none');
        const source = path.join(dir, 'v2');
        app_version_write(source, 'v2');
        // Big enough that the tar is still on its way when the sender hangs up
        fs.mkdirSync(path.join(source, 'build'));
        fs.writeFileSync(path.join(source, 'build', 'blob.bin'), crypto.randomBytes(48*1024*1024));
        const zip = folder_zip(source, 'v2');
        const service = running.app.service_by_name.appdir;
        const req = http.request({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', headers: {host: '127.0.0.1', authorization: `Bearer ${fetch_host.OWNER_TOKEN}`, 'content-length': zip.length}});
        req.on('error', function () {});
        req.end(zip);
        while (/^sending/.test(String(service.state.work)) === false) {
            await timers.setTimeout(2);
        }
        req.destroy();
        while ((service.state.work !== null) || running.app.log_lines.every(v => /\[service_zip_end_/.test(v) === false)) {
            await timers.setTimeout(10);
        }
        assert.ok(running.app.log_lines.some(v => /\[service_zip_end_error\] service=appdir reason=.*the sender hung up/.test(v)), running.app.log_lines.filter(v => /zip/.test(v)).join('\n'));
        const still = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(still.body, 'v1 configured, data: none', 'never swapped');
        assert.strictEqual(fs.existsSync(path.join(folder, 'build')), false);

        // The next one goes at once, and clears what the stopped one left
        const again = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/zip', method: 'PUT', body: zip});
        assert.strictEqual(again.status, 200, again.body);
        const now = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(now.body, 'v2 configured, data: none');
        assert.strictEqual(fs.statSync(path.join(folder, 'build', 'blob.bin')).size, 48*1024*1024, 'the build came whole');
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// A name a request brings is looked up in tables with no prototype: a word of the language is
// a name that is not there, never Object's own, and a secret under it is a secret like another
test('a service, a machine, a host or a secret\'s owner named constructor is a name and nothing more', async function () {
    const running = await serviceman_start([]);
    try {
        for (const [method, asked] of [['GET', '/api/v1/remotes/constructor/ports'], ['GET', '/api/v1/remotes/__proto__/ports'], ['GET', '/api/v1/remotes/toString/metrics'], ['POST', '/api/v1/services/constructor/start'], ['POST', '/api/v1/services/hasOwnProperty/stop'], ['PUT', '/api/v1/services/constructor/zip']]) {
            const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: asked, method});
            assert.strictEqual(answer.status, 404, `${method} ${asked}: ${answer.status} ${answer.body.slice(0, 120)}`);
        }
        const host = await fetch_host({port: running.port, host: 'constructor', path: '/'});
        assert.strictEqual(host.status, 404);

        // A secret under the service name constructor: kept, listed, taken away; the host goes on
        const written = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/secrets', method: 'POST', body: JSON.stringify({service: 'constructor', name: 'keys', value: 'x'})});
        assert.strictEqual(written.status, 200, written.body);
        assert.deepStrictEqual(JSON.parse(written.body).services, [{service: 'constructor', name: 'keys', length: 1}]);
        assert.strictEqual(typeof Object.keys, 'function', 'Object.keys is still itself');
        assert.strictEqual((await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/status'})).status, 200);
        const removed = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/secrets', method: 'POST', body: JSON.stringify({service: 'constructor', name: 'keys', value: ''})});
        assert.deepStrictEqual(JSON.parse(removed.body).services, []);
    }
    finally {
        await running.close();
    }
});

// There is no way back once the folders are swapped: a new version whose bin/configure fails
// is the app from then on, data/ in it, the old one gone, and the service says why; it is not
// started, by a request either, until somebody asks
test('an app folder whose new version cannot be configured keeps the new version, not set up', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    app_version_write(folder, 'v1');
    fs.mkdirSync(path.join(folder, 'data'));
    fs.writeFileSync(path.join(folder, 'data', 'kept.txt'), 'written by v1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: 'bin/configure'}, command: 'bin/run'},
    ]);
    const service = running.app.service_by_name.appdir;
    try {
        app_version_write(`${folder}.new`, 'v2');
        fs.writeFileSync(path.join(`${folder}.new`, 'bin', 'configure'), '#!/bin/sh\necho "v2 cannot be set up here" >&2\nexit 1\n', {mode: 0o755});
        await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        const replaced = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(replaced.status, 502);
        assert.match(JSON.parse(replaced.body).error, /v2 cannot be set up here/);
        assert.strictEqual(service_phase(service), 'stopped', 'not started: bin/run in a folder that is not set up is a crash');
        const view = view_from_service(service);
        assert.strictEqual(view.gave_up, true, 'the page shows it failed');
        assert.match(view.error, /v2 cannot be set up here.*the new version is in place, but not set up/);

        assert.ok(fs.existsSync(path.join(folder, 'server.js')));
        assert.match(fs.readFileSync(path.join(folder, 'server.js'), 'utf8'), /'v2 '/, 'the new version is the folder');
        assert.strictEqual(fs.readFileSync(path.join(folder, 'data', 'kept.txt'), 'utf8'), 'written by v1', 'data/ is in it');
        assert.strictEqual(fs.existsSync(`${folder}.new`), false);
        assert.strictEqual(fs.existsSync(`${folder}.old`), false, 'the old version is gone');

        const asked = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(asked.status, 502, 'a request is told why, and runs nothing');
        assert.strictEqual(service_phase(service), 'stopped');
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// The New service form's line for an app folder sets it up as the rules have a fresh checkout
// made ready: bin/configure, then bin/build, each when the folder has it. A new version that
// brings bin/build is built; one whose bin/build fails leaves the version it had running.
test('an app folder is configured, then built, before it runs, and so is its new version', async function () {
    const app_setup_line = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'app_setup_line.js'))).default;
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    app_version_write(folder, 'v1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: app_setup_line}, command: 'bin/run'},
    ]);
    try {
        const first = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(first.body, 'v1 configured, data: none', 'no bin/build: configured only');

        // v2 brings a data/ to an app that has none yet: it is the app's from now on
        app_version_write(`${folder}.new`, 'v2', 'test -e configured.txt && echo built > built.txt');
        fs.mkdirSync(path.join(`${folder}.new`, 'data'));
        fs.writeFileSync(path.join(`${folder}.new`, 'data', 'kept.txt'), 'brought by v2');
        const replaced = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(replaced.status, 200, replaced.body);
        assert.strictEqual(JSON.parse(replaced.body).data_dropped, false, 'the app had no data/, so the one brought is taken');
        const second = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(second.body, 'v2 configured, built, data: brought by v2', 'bin/build runs, after bin/configure');

        app_version_write(`${folder}.new`, 'v3', 'echo "v3 does not build" >&2; exit 1');
        const failed = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(failed.status, 502);
        assert.match(JSON.parse(failed.body).error, /v3 does not build/);
        assert.strictEqual(service_phase(running.app.service_by_name.appdir), 'stopped', 'v3 is in place, not built, and not started');
        assert.ok(fs.existsSync(path.join(folder, 'configured.txt')), 'v3 was configured before its build failed');
        assert.match(fs.readFileSync(path.join(folder, 'server.js'), 'utf8'), /'v3 '/);
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// An app folder made before the form's line ran bin/build has bin/configure alone as its
// line: a new version that brings bin/build is built after it all the same
test('an app folder with bin/configure as its line is built when its new version has bin/build', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    app_version_write(folder, 'v1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: 'bin/configure'}, command: 'bin/run'},
    ]);
    try {
        await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        app_version_write(`${folder}.new`, 'v2', 'test -e configured.txt && echo built > built.txt');
        const replaced = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(replaced.status, 200, replaced.body);
        const second = await fetch_host({port: running.port, host: 'appdir.test', path: '/'});
        assert.strictEqual(second.body, 'v2 configured, built, data: none');
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// The app is stopped whatever it is doing, and nothing starts it before its new version is set
// up: not the restart of a bin/run that falls over at once, not a request. The new version is
// started after bin/configure, and data/ comes across.
test('an app folder in its restart pause takes a new version, and bin/run waits for bin/configure', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    const story = path.join(dir, 'story.txt');
    app_version_write(folder, 'v1');
    fs.writeFileSync(path.join(folder, 'bin', 'run'), `#!/bin/sh\necho "run v1" >> ${story}\nexit 3\n`, {mode: 0o755});
    fs.mkdirSync(path.join(folder, 'data'));
    fs.writeFileSync(path.join(folder, 'data', 'kept.txt'), 'written by v1');
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', publish: {host: 'appdir.test', port}, cwd: folder, lifecycle: {install: 'bin/configure'}, command: 'bin/run', policy: {restart: 'on_failure'}},
    ]);
    const service = running.app.service_by_name.appdir;
    try {
        // v1 falls over at once, and waits to be started again
        service_ensure_running(running.app, service).catch(function () {});
        await wait_until(() => running.app.log_lines.some(v => /\[program_restart_wait\] service=appdir/.test(v)), 10000);

        app_version_write(`${folder}.new`, 'v2');
        fs.writeFileSync(path.join(`${folder}.new`, 'bin', 'configure'), [
            '#!/bin/sh',
            `echo "configure begin" >> ${story}`,
            'sleep 2.5',
            'echo configured > configured.txt',
            `echo "configure end" >> ${story}`,
            '',
        ].join('\n'), {mode: 0o755});
        fs.writeFileSync(path.join(`${folder}.new`, 'bin', 'run'), `#!/bin/sh\necho "run v2" >> ${story}\nexec ${process.execPath} server.js\n`, {mode: 0o755});
        const replaced = fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        await wait_until(() => fs.readFileSync(story, 'utf8').includes('configure begin'), 10000);
        assert.strictEqual(service.state.doing, 'taking its new version');
        const again = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(again.status, 409, 'a second replace waits for the first');
        // A visitor while it is set up waits for it, and gets the new version
        const visit = fetch_host({port: running.port, host: 'appdir.test', path: '/'});

        const answer = await replaced;
        assert.strictEqual(answer.status, 200, answer.body);
        assert.strictEqual(JSON.parse(answer.body).phase, 'running', 'the new one is started');
        assert.strictEqual((await visit).body, 'v2 configured, data: written by v1');

        const lines = fs.readFileSync(story, 'utf8').trim().split('\n');
        const begin = lines.indexOf('configure begin');
        const end = lines.indexOf('configure end');
        assert.ok((begin !== -1) && (end > begin), lines.join(' | '));
        assert.deepStrictEqual(lines.slice(begin + 1, end), [], 'nothing ran while bin/configure did');
        assert.deepStrictEqual(lines.slice(end + 1), ['run v2'], 'v2 is started once, after it');
        assert.strictEqual(service.state.doing, null);
        assert.strictEqual(fs.existsSync(`${folder}.old`), false);
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// The same with nothing to wait an answer from: a program with no port is up as soon as it
// runs, so between two falls there is no start on the way, only the timer of the next one
test('an app folder with no port, between two restarts, takes a new version, and bin/run waits for bin/configure', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-'));
    const folder = path.join(dir, 'appdir');
    const story = path.join(dir, 'story.txt');
    fs.mkdirSync(path.join(folder, 'bin'), {recursive: true});
    fs.writeFileSync(path.join(folder, 'bin', 'run'), `#!/bin/sh\necho "run v1" >> ${story}\nexit 3\n`, {mode: 0o755});
    const running = await serviceman_start([
        {name: 'appdir', type: 'shell', cwd: folder, command: 'bin/run', policy: {start: 'always', restart: 'on_failure'}},
    ]);
    const service = running.app.service_by_name.appdir;
    try {
        // It starts with serviceman, falls over, and waits to be started again
        await wait_until(() => service.state.instances[0].restart_timer !== null, 10000);
        assert.strictEqual(service.state.instances[0].start_promise, null, 'nothing on the way: only the timer');

        fs.mkdirSync(path.join(`${folder}.new`, 'bin'), {recursive: true});
        fs.writeFileSync(path.join(`${folder}.new`, 'bin', 'configure'), `#!/bin/sh\necho "configure begin" >> ${story}\nsleep 2.5\necho "configure end" >> ${story}\n`, {mode: 0o755});
        fs.writeFileSync(path.join(`${folder}.new`, 'bin', 'run'), `#!/bin/sh\necho "run v2" >> ${story}\nexec sleep 30\n`, {mode: 0o755});
        const replaced = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/appdir/replace', method: 'POST'});
        assert.strictEqual(replaced.status, 200, replaced.body);
        assert.strictEqual(service_phase(service), 'running');

        const lines = fs.readFileSync(story, 'utf8').trim().split('\n');
        const begin = lines.indexOf('configure begin');
        const end = lines.indexOf('configure end');
        assert.ok((begin !== -1) && (end > begin), lines.join(' | '));
        assert.deepStrictEqual(lines.slice(begin + 1), ['configure end', 'run v2'], 'no v1 restart during or after bin/configure, and v2 once after it');
    }
    finally {
        await running.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test('a service that keeps data may name one machine, and its volumes are mounted where it runs', function () {
    const remotes = [{name: 'laptop', token: '0123456789abcdef0123456789abcdef'}, {name: 'aaa', token: 'fedcba9876543210fedcba9876543210'}];
    const one = config_from_json({remotes, services: [{
        name: 'writer', type: 'shell', remote: 'laptop', image: 'node:24',
        publish: {host: 'writer.test', port: 8090}, command: 'bin/run', volumes: ['writer-data:/app/data'],
    }]}, '/srv');
    assert.deepStrictEqual(one.services[0].volumes, [{kind: 'volume', source: 'writer-data', target: '/app/data', readonly: false, create: false}]);

    // A path with no name is one the service keeps: a folder under the folder of whoever runs
    // it, so everything the agent made is in one place and goes with it
    const own = config_from_json({remotes, services: [{
        name: 'writer', type: 'shell', remote: 'laptop', image: 'node:24',
        publish: {host: 'writer.test', port: 8090}, command: 'bin/run', volumes: [':/app/data', ':/app/cache'],
    }]}, '/srv');
    assert.deepStrictEqual(own.services[0].volumes.map(v => v.keep), ['writer/app-data', 'writer/app-cache']);
    assert.deepStrictEqual(own.services[0].volumes.map(v => volume_text(v, '/home/user/serviceman-agent')), [
        '/home/user/serviceman-agent/data/writer/app-data:/app/data',
        '/home/user/serviceman-agent/data/writer/app-cache:/app/cache',
    ]);

    // Where it would be mounted, in the container that runs the program
    const argv = program_docker_argv({
        container: 'serviceman-writer', service: 'writer', spec: 'abc', dir: '/home/user/x',
        image: 'node:24', command: 'bin/run', env: {}, port: 8090,
        volumes: one.services[0].volumes,
    });
    assert.ok(argv.join(' ').includes('--volume writer-data:/app/data'), argv.join(' '));

    // A volume is on one machine, so a list and a tag are both refused
    function bad(asked) {
        return function () {
            return config_from_json({remotes, services: [{
                name: 'writer', type: 'shell', remotes: asked, image: 'node:24',
                publish: {host: 'writer.test', port: 8090}, command: 'bin/run', volumes: ['writer-data:/app/data'],
            }]}, '/srv');
        };
    }
    assert.throws(bad(['laptop', 'aaa']), /names one machine; its volumes are there and go nowhere/);
    assert.throws(bad(['#gpu']), /a tag stands for any machine carrying it/);
});

test('a shell service that names an image runs its lines and its command inside one', async function () {
    const running = await serviceman_start([{
        name: 'writer',
        type: 'shell',
        image: 'node:24-alpine',
        publish: {host: 'writer.test', port: 8080},
        command: 'node server.js',
        lifecycle: {install: 'npm install'},
    }]);
    const service = running.app.service_by_name.writer;
    try {
        const answer = await fetch_host({port: running.port, host: 'writer.test', path: '/hello'});
        assert.strictEqual(answer.status, 200, 'it answers through the container docker made');

        // The install line ran in the image, with the folder mounted — npm is the image's to have
        const ran = state_file_read(process.env.SERVICEMAN_TEST_STATE);
        const install = ran.commands.find(v => v.includes('npm install'));
        assert.match(install, /run --rm --volume .*writer\.[0-9a-f]{8}:\/app --workdir \/app --user \d+:\d+ --env HOME=\/app --env PORT=8080 node:24-alpine \/bin\/sh -c npm install/, install);

        // And the program itself is a container of ours, with the same folder and the command
        const container = ran.commands.find(v => v.includes('--name serviceman-writer'));
        assert.match(container, /run -d --init --name serviceman-writer --label serviceman\.service=writer/, container);
        assert.match(container, /--volume .*writer\.[0-9a-f]{8}:\/app --workdir \/app --user \d+:\d+ --env HOME=\/app --publish 127\.0\.0\.1::8080 --env PORT=8080 node:24-alpine \/bin\/sh -c node server\.js/, container);

        // Stopping it is docker's to do, because by then it is an ordinary container of ours
        await service_stop(running.app, service, 'the test asked');
        const after = state_file_read(process.env.SERVICEMAN_TEST_STATE);
        assert.ok(after.commands.some(v => /^stop .*serviceman-writer$/.test(v)), after.commands.join('\n'));
    }
    finally {
        await running.close();
    }
});

test('a service that cannot start is tried twice, and then left alone until something changes', async function () {
    const port = await free_port();
    const running = await serviceman_start([
        {
            name: 'broken',
            type: 'shell',
            publish: {host: 'broken.test', port},
            command: `${process.execPath} -e "process.exit(1)"`,
            policy: {start_timeout: '1s'},
        },
    ]);
    const service = running.app.service_by_name.broken;
    try {
        const first = await fetch_host({port: running.port, host: 'broken.test', path: '/'});
        assert.strictEqual(first.status, 502);
        assert.strictEqual(service.state.failures, 1, 'one start, one failure');

        const second = await fetch_host({port: running.port, host: 'broken.test', path: '/'});
        assert.strictEqual(second.status, 502);
        assert.strictEqual(service.state.failures, 2);
        assert.ok(service.state.gave_up_at !== null, 'twice is enough');
        assert.match(service.state.last_error, /stopped trying after 2 starts in a row that failed/);
        assert.ok(running.app.log_lines.some(v => /\[service_gave_up\] service=broken tries=2/.test(v)));

        // A third request costs nothing: no start, no work, the same answer
        const tried = running.app.log_lines.filter(v => /\[service_start_begin\] service=broken/.test(v)).length;
        const third = await fetch_host({port: running.port, host: 'broken.test', path: '/'});
        assert.strictEqual(third.status, 502);
        assert.strictEqual(running.app.log_lines.filter(v => /\[service_start_begin\] service=broken/.test(v)).length, tried, 'it was not started again');

        // Asking is a change
        const asked = await fetch_host({port: running.control_port, host: 'serviceman.localhost', path: '/api/v1/services/broken/start', method: 'POST'});
        assert.strictEqual(asked.status, 202);
        assert.ok(running.app.log_lines.some(v => /\[service_try_again\] service=broken/.test(v)));
    }
    finally {
        await running.close();
    }
});

test('an install that fails leaves no folder behind, and the next one starts from nothing', async function () {
    const port = await free_port();
    const flag = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-fresh-')), 'let-it-work');
    const running = await serviceman_start([{
        name: 'writer',
        type: 'shell',
        publish: {host: 'writer.test', port},
        command: `${process.execPath} server.js ${port}`,
        // Writes half of itself, then fails — until the flag is there
        lifecycle: {install: `cp ${path.join(__dirname, 'fixtures', 'app_server.js')} server.js && test -f ${flag}`},
    }]);
    const service = running.app.service_by_name.writer;
    const dir = path.join(running.agent_dir, 'services', service.cwd);
    try {
        const cold = await fetch_host({port: running.port, host: 'writer.test', path: '/'});
        assert.strictEqual(cold.status, 502);
        assert.match(service.state.last_error, /the install line failed/);
        assert.strictEqual(fs.existsSync(dir), false, 'half an install is worse than none: the folder went');

        // The reason it failed is gone; the next try starts from nothing and works
        fs.writeFileSync(flag, 'yes');
        const warm = await fetch_host({port: running.port, host: 'writer.test', path: '/again'});
        assert.strictEqual(warm.status, 200);
        assert.strictEqual(warm.body, 'the app answers /again');
        assert.ok(fs.existsSync(path.join(dir, '.serviceman-app')), 'and this time it is marked as installed');
    }
    finally {
        await running.close();
    }
});

test('what was made for a program goes with the program; what it was pointed at stays', async function () {
    const port = await free_port();
    const other = await free_port();
    const kept = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-kept-'));
    const install = `cp ${path.join(__dirname, 'fixtures', 'app_server.js')} server.js`;
    const running = await serviceman_start([
        {name: 'made', type: 'shell', publish: {host: 'made.test', port}, command: `${process.execPath} server.js ${port}`, lifecycle: {install}},
        {name: 'kept', type: 'shell', publish: {host: 'kept.test', port: other}, cwd: kept, command: `${process.execPath} server.js ${other}`, lifecycle: {install}},
    ]);
    try {
        const folder = running.app.service_by_name.made.cwd;
        assert.match(folder, /^made\.[0-9a-f]{8}$/, 'serviceman chose the folder, and gave it a suffix of its own');
        assert.strictEqual((await fetch_host({port: running.port, host: 'made.test', path: '/'})).status, 200);
        assert.strictEqual((await fetch_host({port: running.port, host: 'kept.test', path: '/'})).status, 200);
        assert.ok(fs.existsSync(path.join(running.agent_dir, 'services', folder, 'server.js')), 'the agent put it under its own folder');
        assert.ok(fs.existsSync(path.join(kept, 'server.js')));

        await app_apply_config(running.app, config_from_json(config_json([]), __dirname));
        assert.strictEqual(fs.existsSync(path.join(running.agent_dir, 'services', folder)), false, 'the folder made for it is gone');
        assert.ok(running.app.log_lines.some(v => /\[program_folder_removed\] service=made cwd=made\.[0-9a-f]{8}/.test(v)));
        assert.ok(fs.existsSync(path.join(kept, 'server.js')), 'the folder it was pointed at is untouched');
        assert.ok(running.app.log_lines.some(v => /\[service_stop_begin\] service=kept .*removed from the config/.test(v)), 'a program that is removed is stopped, never left as an orphan');
    }
    finally {
        await running.close();
    }
});

test('the lifecycle lines run at their moments: install, stop, uninstall', async function () {
    const port = await free_port();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-life-'));
    const said = path.join(dir, 'said.log');
    const running = await serviceman_start([
        {
            name: 'writer',
            type: 'shell',
            publish: {host: 'writer.test', port},
            cwd: path.join(dir, 'writer'),
            command: `${process.execPath} server.js ${port}`,
            lifecycle: {
                install: `cp ${path.join(__dirname, 'fixtures', 'app_server.js')} server.js && echo installed >> ${said}`,
                stop: `echo "stop \$SERVICEMAN_REASON" >> ${said}`,
                uninstall: `echo uninstalled >> ${said} && rm -rf ${path.join(dir, 'writer')}`,
            },
        },
    ]);
    const service = running.app.service_by_name.writer;
    try {
        const answer = await fetch_host({port: running.port, host: 'writer.test', path: '/now'});
        assert.strictEqual(answer.status, 200);

        await service_stop(running.app, service, 'the test asked');
        assert.strictEqual(fs.readFileSync(said, 'utf8'), 'installed\nstop the test asked\n', 'the stop line knows why');

        // The service leaves the config: it is stopped, and the line for that moment runs
        await app_apply_config(running.app, config_from_json(config_json([]), __dirname));
        assert.strictEqual(fs.readFileSync(said, 'utf8'), 'installed\nstop the test asked\nuninstalled\n');
        assert.strictEqual(fs.existsSync(path.join(dir, 'writer')), false, 'the folder went with it');
        assert.ok(running.app.log_lines.some(v => /\[program_step_end_ok\] \d+\.\d{3}s service=writer step=uninstall/.test(v)));
    }
    finally {
        await running.close();
    }
});

test('a program that moved on is fetched again: new code, same folder, same storage', async function () {
    const port = await free_port();
    // What the install line fetches — the repository, as far as this test is concerned
    const source = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-again-')), 'source.js');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'app_server.js'), source);
    const running = await serviceman_start([{
        name: 'writer',
        type: 'shell',
        publish: {host: 'writer.test', port},
        command: `${process.execPath} server.js ${port}`,
        volumes: [':/app/data'],
        lifecycle: {install: `cp ${source} server.js`},
    }]);
    const service = running.app.service_by_name.writer;
    try {
        assert.strictEqual((await fetch_host({port: running.port, host: 'writer.test', path: '/'})).body, 'the app answers /');
        const folder = service.cwd;
        // What it keeps lives beside its folder, not inside it — under the agent, in both cases
        const kept = path.join(running.agent_dir, 'data', 'writer', 'app-data');
        fs.mkdirSync(kept, {recursive: true});
        fs.writeFileSync(path.join(kept, 'notes.txt'), 'what the program wrote');

        // The program moved on, and is asked for again
        fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('the app answers', 'the new one answers'));
        const asked = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/writer/update', method: 'POST'});
        assert.strictEqual(asked.status, 202);
        await wait_until(() => running.app.log_lines.some(v => /\[service_update_end_ok\] service=writer/.test(v)), 20000);

        const warm = await fetch_host({port: running.port, host: 'writer.test', path: '/now'});
        assert.strictEqual(warm.body, 'the new one answers /now', 'the install line ran again and what it fetched is what runs');
        assert.strictEqual(service.cwd, folder, 'the same folder: nothing was renumbered');
        assert.strictEqual(fs.readFileSync(path.join(kept, 'notes.txt'), 'utf8'), 'what the program wrote', 'storage is not part of what is fetched');
        assert.deepStrictEqual(service.volumes.map(v => v.keep), ['writer/app-data']);
        assert.ok(running.app.log_lines.some(v => /\[program_step_end_ok\] \d+\.\d{3}s service=writer step=install/.test(v)));
    }
    finally {
        await running.close();
    }
});

test('while a program is being fetched the page is told so, and reads what the fetching prints', async function () {
    const port = await free_port();
    const source = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-slow-')), 'source.js');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'app_server.js'), source);
    const running = await serviceman_start([{
        name: 'writer',
        type: 'shell',
        publish: {host: 'writer.test', port},
        command: `${process.execPath} server.js ${port}`,
        lifecycle: {install: `echo "Cloning into ." && sleep 1 && cp ${source} server.js && echo done`},
    }]);
    const service = running.app.service_by_name.writer;
    try {
        assert.strictEqual((await fetch_host({port: running.port, host: 'writer.test', path: '/'})).status, 200);
        assert.strictEqual(view_from_service(service).doing, null, 'nothing is being done to it');

        const asked = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/writer/update', method: 'POST'});
        assert.strictEqual(JSON.parse(asked.body).doing, 'fetching the program', 'the answer to the click already says what is happening');

        // The phase is `stopped` the whole way through, which is why the page has this to read
        await wait_until(() => view_from_service(service).said.includes('Cloning into .'), 20000);
        const mid = view_from_service(service);
        assert.strictEqual(mid.doing, 'fetching the program');
        assert.strictEqual(mid.phase, 'stopped');

        await wait_until(() => view_from_service(service).doing === null, 20000);
        await wait_until(() => view_from_service(service).phase === 'running', 20000);
        // Everything it printed is in the log; what the page reads is the story of what is
        // happening now, and by now that is the start, which cleared it
        assert.ok(running.app.log_lines.some(v => /\[agent_call_stdout\] done$/.test(v)));
    }
    finally {
        await running.close();
    }
});

test('a service with nothing to fetch says so, and nothing happens to it', async function () {
    const running = await serviceman_start([
        {name: 'whoami', type: 'docker', publish: {host: 'whoami.test', port: 8080}, image: 'demo/whoami'},
    ]);
    try {
        const asked = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/whoami/update', method: 'POST'});
        assert.strictEqual(asked.status, 400);
        assert.match(JSON.parse(asked.body).error, /no install line: there is nothing to fetch again/);
    }
    finally {
        await running.close();
    }
});

test('serviceman keeps an address of its own for each service, and sends what arrives there on', async function () {
    const port = await free_port();
    const running = await serviceman_start([
        {
            name: 'writer',
            type: 'shell',
            publish: {host: 'writer.test', port},
            command: `${process.execPath} -e "require('http').createServer(function (req, res) { res.end('the app answers ' + req.url); }).listen(${port}, '127.0.0.1');"`,
        },
    ]);
    const service = running.app.service_by_name.writer;
    try {
        const kept = service_redir(service);
        assert.match(kept, /^\/redir\/[0-9a-f]{8}$/);

        // What an OAuth callback looks like when it comes back: a name the rules allow, on
        // serviceman's own address, carrying the code and the state
        const answer = await fetch_host({port: running.port, host: 'localhost', path: `${kept}/auth/callback?code=abc&state=xyz`});
        assert.strictEqual(answer.status, 302);
        assert.strictEqual(answer.headers.location, `http://writer.test:${running.port}/auth/callback?code=abc&state=xyz`);
        assert.strictEqual(answer.headers['cache-control'], 'no-store');
        assert.strictEqual(service_phase(service), 'stopped', 'the service is not woken to be pointed at');

        // The bare address goes to its root
        const bare = await fetch_host({port: running.port, host: 'localhost', path: kept});
        assert.strictEqual(bare.headers.location, `http://writer.test:${running.port}/`);

        // A uid nobody keeps is nothing at all
        const nothing = await fetch_host({port: running.port, host: 'localhost', path: '/redir/deadbeef/auth/callback'});
        assert.strictEqual(nothing.status, 404);
    }
    finally {
        await running.close();
    }
});

test('a bootstrap address wakes the service and hands the visitor over to its own address', async function () {
    const port = await free_port();
    const running = await serviceman_start([
        {
            name: 'writer',
            title: 'Google Docs writer',
            type: 'shell',
            publish: {host: 'writer.test', port},
            command: `${process.execPath} -e "require('http').createServer(function (req, res) { res.end('the app itself answers ' + req.url); }).listen(${port}, '127.0.0.1');"`,
            redirect: `http://localhost:${port}`,
        },
    ]);
    const service = running.app.service_by_name.writer;
    try {
        assert.strictEqual(service_phase(service), 'stopped');

        const answer = await fetch_host({port: running.port, host: 'writer.test', path: '/docs?new=1'});
        assert.strictEqual(answer.status, 302);
        assert.strictEqual(answer.headers.location, `http://localhost:${port}/docs?new=1`);
        assert.strictEqual(answer.headers['cache-control'], 'no-store', 'the door must be knocked on every time');
        assert.strictEqual(service_phase(service), 'running', 'it was woken before anybody was sent there');

        // What the visitor's browser does next, and it has somebody to talk to
        const arrived = await fetch_host({port, path: '/docs?new=1'});
        assert.strictEqual(arrived.status, 200);
        assert.strictEqual(arrived.body, 'the app itself answers /docs?new=1');

        // serviceman sees nothing after the handover, so it does not pretend to know when the
        // service went idle
        assert.strictEqual(service.policy.stop_after_idle_ms, null);
    }
    finally {
        await running.close();
    }
});

test('a handover keeps the idle clock the service asked for, and the defaults do not give it one', function () {
    const config = config_from_json(config_json([
        {name: 'a', type: 'shell', publish: {host: 'a.test', port: 8090}, command: 'sleep 1', redirect: 'http://localhost:8090/'},
        {name: 'b', type: 'shell', publish: {host: 'b.test', port: 8091}, command: 'sleep 1', redirect: 'http://localhost:8091', policy: {stop_after_idle: '8h'}},
    ], {defaults: {stop_after_idle: '10m'}}), '/srv');
    assert.strictEqual(config.services[0].redirect, 'http://localhost:8090', 'the trailing slash is the request path\'s business');
    assert.strictEqual(config.services[0].policy.stop_after_idle_ms, null);
    assert.strictEqual(config.services[1].policy.stop_after_idle_ms, 8*60*60*1000);

    function bad(json) {
        return function () {
            return config_from_json(config_json([json]), '/srv');
        };
    }
    assert.throws(bad({name: 'a', type: 'external', publish: {host: 'a.test'}, upstream: '127.0.0.1:1', redirect: 'http://localhost:8090'}), /nothing to wake/);
    assert.throws(bad({name: 'a', type: 'shell', publish: {host: 'a.test', port: 8090}, command: 'sleep 1', redirect: 'localhost:8090'}), /an http address is required/);
});

test('the restart policy decides what follows a program that stops by itself', async function () {
    const running = await serviceman_start([
        {
            name: 'faller',
            type: 'shell',
            command: `${process.execPath} -e "console.log('up'); setTimeout(function () { process.exit(3); }, 150);"`,
            policy: {start: 'always', restart: 'on_failure'},
        },
        {
            name: 'quitter',
            type: 'shell',
            command: `${process.execPath} -e "console.log('done');"`,
            policy: {start: 'always', restart: 'never'},
        },
    ]);
    const faller = running.app.service_by_name.faller;
    const quitter = running.app.service_by_name.quitter;
    try {
        await service_ensure_running(running.app, faller);
        await service_ensure_running(running.app, quitter);
        await timers.setTimeout(400);
        assert.ok(running.app.log_lines.some(v => /\[program_end\] remote=vps1 service=faller slot=1 how="code 3"/.test(v)), 'the agent said so, and the line is here as it said it');
        assert.ok(running.app.log_lines.some(v => /\[program_restart_wait\] service=faller in=1\.000s restart=1/.test(v)));
        assert.ok(running.app.log_lines.some(v => /\[program_end\] remote=vps1 service=quitter slot=1 how="code 0"/.test(v)));
        assert.strictEqual(service_phase(quitter), 'stopped', 'a clean exit is a stopped service, not a running one nobody can reach');
        assert.ok(running.app.log_lines.every(v => /\[program_restart_wait\] service=quitter/.test(v) === false));
        await timers.setTimeout(900);
        assert.strictEqual(faller.state.instances[0].restarts >= 1, true);
    }
    finally {
        await running.close();
    }
});

test('a program that would only fail later is refused', function () {
    function bad(json) {
        return function () {
            return config_from_json(config_json([json]), '/srv');
        };
    }
    assert.throws(bad({name: 'a', type: 'shell'}), /command/);
    assert.throws(bad({name: 'a', type: 'shell', publish: {host: 'a.test'}, command: 'sleep 1'}), /needs the port the program listens on/);
    assert.throws(bad({name: 'a', type: 'shell', publish: {port: 8080}, command: 'sleep 1'}), /served on an address/);
    assert.throws(bad({name: 'a', type: 'shell', command: 'sleep 1'}), /starts with serviceman/);
    assert.throws(bad({name: 'a', type: 'shell', command: 'sleep 1', policy: {start: 'always', restart: 'sometimes'}}), /restart: expected/);
    const fine = config_from_json(config_json([{name: 'a', type: 'shell', command: 'sleep 1', policy: {start: 'always'}}]), '/srv');
    assert.deepStrictEqual(fine.services[0].hosts, []);
    assert.strictEqual(fine.services[0].policy.restart, 'on_failure');
});

// Waits for something the control page asked for to have happened, because the ask is answered
// before the work behind it is finished
async function settled(ready)
{
    for (let i = 0; i < 200; i++) {
        if (ready()) {
            return;
        }
        await timers.setTimeout(10);
    }
    throw new Error('it never happened');
}

test('a pull fetches the image again, and what is running is made from what came down', async function () {
    const running = await serviceman_start([
        {name: 'mover', type: 'docker', publish: {host: 'mover.test', port: 8080}, image: 'far/moved:1'},
        {name: 'still', type: 'docker', publish: {host: 'still.test', port: 8080}, image: 'far/still:1'},
    ]);
    const service = running.app.service_by_name.mover;
    try {
        // It is running from the image as it was when it started. The stand-in writes its note
        // as the container comes up, over the link, so the note is read once it is whole.
        await service_ensure_running(running.app, service);
        assert.strictEqual(service_phase(service), 'running');
        await wait_until(() => state_file_read(process.env.SERVICEMAN_TEST_STATE).image_ids !== undefined);
        const first = state_file_read(process.env.SERVICEMAN_TEST_STATE).image_ids['far/moved:1'];

        // Somebody pushes over the tag, and the pull is what asks for it. A tag is not a
        // version: nothing else in serviceman would ever ask again.
        const said = await service_image_pull(running.app, service);
        assert.strictEqual(said.fresh, true);
        assert.notStrictEqual(said.id, first);
        assert.strictEqual(running.app.log_lines.some(v => /\[service_pull_end_ok\] service=mover image=far\/moved:1 remote=vps1 fresh=true/.test(v)), true);

        // A newer image is no use in a container made from the older one, so the container is
        // taken away and made again — and the service is up at the end, as it was at the start
        const state = state_file_read(process.env.SERVICEMAN_TEST_STATE);
        assert.strictEqual(state.commands.some(v => v.startsWith('rm --force serviceman-mover')), true);
        assert.strictEqual(service_phase(service), 'running');

        // And an image nobody pushed over says so — with nothing taken away for it, because a
        // container of that image is a container of that image
        const still = running.app.service_by_name.still;
        await service_ensure_running(running.app, still);
        const before = state_file_read(process.env.SERVICEMAN_TEST_STATE).commands.filter(v => v.startsWith('rm --force serviceman-still')).length;
        const same = await service_image_pull(running.app, still);
        assert.strictEqual(same.fresh, false);
        assert.strictEqual(state_file_read(process.env.SERVICEMAN_TEST_STATE).commands.filter(v => v.startsWith('rm --force serviceman-still')).length, before);
        assert.strictEqual(service_phase(still), 'running');
    }
    finally {
        await running.close(true);
    }
});

test('a pull remakes a container made from an older image, even when the pull itself brings nothing', async function () {
    const running = await serviceman_start([
        {name: 'behind', type: 'docker', publish: {host: 'behind.test', port: 8080}, image: 'far/behind:1'},
    ]);
    const service = running.app.service_by_name.behind;
    try {
        await service_ensure_running(running.app, service);
        assert.strictEqual(service_phase(service), 'running');
        // The newer image comes down some other way — a docker pull by hand on that machine —
        // and the running container is still the one made from the older image
        const state = state_file_read(process.env.SERVICEMAN_TEST_STATE);
        state.image_ids = Object.assign({}, state.image_ids, {'far/behind:1': 'sha256:7'});
        fs.writeFileSync(process.env.SERVICEMAN_TEST_STATE, JSON.stringify(state));

        const said = await service_image_pull(running.app, service);
        assert.strictEqual(said.fresh, false);
        assert.strictEqual(said.remade, true);
        const after = state_file_read(process.env.SERVICEMAN_TEST_STATE);
        assert.strictEqual(after.commands.some(v => v.startsWith('rm --force serviceman-behind')), true);
        assert.strictEqual(after.containers['serviceman-behind'].image_id, 'sha256:7');
        assert.strictEqual(service_phase(service), 'running');
        assert.strictEqual(running.app.log_lines.some(v => /\[service_pull_end_ok\] service=behind .*fresh=false behind=true/.test(v)), true);

        // Pulled again, it is the newest and so is its container: nothing is taken away
        const removed = after.commands.filter(v => v.startsWith('rm --force serviceman-behind')).length;
        const again = await service_image_pull(running.app, service);
        assert.strictEqual(again.remade, false);
        assert.strictEqual(state_file_read(process.env.SERVICEMAN_TEST_STATE).commands.filter(v => v.startsWith('rm --force serviceman-behind')).length, removed);
    }
    finally {
        await running.close(true);
    }
});

test('a pull is refused for a service that is not made from an image', async function () {
    const running = await serviceman_start([
        {name: 'pages', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'},
        {name: 'quiet', type: 'shell', command: 'node -e "setInterval(function () {}, 1000);"', policy: {start: 'always'}},
    ]);
    try {
        const written = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/pages/pull', method: 'POST'});
        assert.strictEqual(written.status, 400);
        const shell = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/quiet/pull', method: 'POST'});
        assert.strictEqual(shell.status, 400);
        assert.match(JSON.parse(shell.body).error, /not made from an image/);
    }
    finally {
        await running.close(true);
    }
});

// The config every test starts from: one machine, vps1, which the agent this file spawns
// dials in as. A container or a program that names no machine runs there.
function config_json(services, extra)
{
    const out = Object.assign({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
    }, (extra === undefined) ? {} : extra);
    out.services = services.map(function (service) {
        if (((service.type === 'docker') || (service.type === 'shell')) && (service.remote === undefined) && (service.remotes === undefined)) {
            return Object.assign({remote: 'vps1'}, service);
        }
        return service;
    });
    return out;
}

// options: `state_file` is the docker stand-in's note of its containers, shared between two
// servicemans that must see the same ones; `config` is more of the config; `agent_env` is
// what the agent is started with
// An app folder of one version: bin/configure marks it, bin/run serves the version, whether it
// was configured and built, and what data/ holds; bin/build is there when built gives its line
function app_version_write(folder, version, built)
{
    fs.mkdirSync(path.join(folder, 'bin'), {recursive: true});
    if (built !== undefined) {
        fs.writeFileSync(path.join(folder, 'bin', 'build'), `#!/bin/sh\n${built}\n`, {mode: 0o755});
    }
    fs.writeFileSync(path.join(folder, 'bin', 'configure'), '#!/bin/sh\necho configured > configured.txt\n', {mode: 0o755});
    fs.writeFileSync(path.join(folder, 'bin', 'run'), `#!/bin/sh\nexec ${process.execPath} server.js\n`, {mode: 0o755});
    fs.writeFileSync(path.join(folder, 'server.js'), [
        'const fs = require(\'fs\');',
        'require(\'http\').createServer(function (req, res) {',
        '    const configured = fs.existsSync(\'configured.txt\') ? \'configured\' : \'not configured\';',
        '    const data = fs.existsSync(\'data/kept.txt\') ? fs.readFileSync(\'data/kept.txt\', \'utf8\') : \'none\';',
        '    const built = fs.existsSync(\'built.txt\') ? \', built\' : \'\';',
        `    res.end(\'${version} \' + configured + built + \', data: \' + data);`,
        '}).listen(Number(process.env.PORT), \'127.0.0.1\');',
        '',
    ].join('\n'));
}

// A token of the control door, made as the Tokens tab makes one; what comes back is the token
async function token_make(running, body)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/tokens', method: 'POST', body: JSON.stringify(body)});
    assert.strictEqual(answer.status, 200, answer.body);
    return JSON.parse(answer.body).token;
}

// A folder as a zip, as a working copy is zipped on unix: everything under one top folder,
// each file with its mode
function folder_zip(folder, top)
{
    const files = [{name: `${top}/`, bytes: null}];
    folder_walk(folder, `${top}/`, files);
    return zip_bytes(files);
}

function folder_walk(dir, prefix, files)
{
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            files.push({name: `${prefix}${name}/`, bytes: null});
            folder_walk(full, `${prefix}${name}/`, files);
            continue;
        }
        files.push({name: `${prefix}${name}`, bytes: fs.readFileSync(full), mode: stat.mode & 0o7777});
    }
}

async function serviceman_start(services, options)
{
    const given = (options === undefined) ? {} : options;
    process.env.SERVICEMAN_TEST_STATE = (given.state_file === undefined) ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-')), 'docker.json') : given.state_file;
    const config = config_from_json(config_json(services, given.config), __dirname);
    return await serviceman_serve(config, given.agent_env);
}

// The same serviceman, booted from a config file on disk — the config editor needs the file
async function serviceman_start_file(json)
{
    process.env.SERVICEMAN_TEST_STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-')), 'docker.json');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-config-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify(json, null, 4));
    const out = await serviceman_serve(await profile_from_db(config_path));
    out.config_path = config_path;
    return out;
}

// The doors, and the agent of vps1 dialled in on the control one: a folder of its own for what
// it installs and what its services keep, and the docker stand-in as its docker
async function serviceman_serve(config, agent_env)
{
    const app = app_from_config(config);
    const servers = await server_start(app);
    const out = {
        app,
        servers,
        port: servers.server.address().port,
        control_port: servers.control.address().port,
        agent_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-')),
        agent: null,
        close: function (kill) {
            return serviceman_close(this, kill);
        },
    };
    if (app.remote_by_name.vps1 !== undefined) {
        out.agent = agent_start(out, agent_env);
        await wait_until(() => app.remote_by_name.vps1.state.phase === 'online', 10000);
    }
    return out;
}

function agent_start(running, env)
{
    const argv = [AGENT, '--url', `http://127.0.0.1:${running.control_port}`, '--token', TOKEN, '--docker', DOCKER_BIN];
    const child = child_process.spawn(process.execPath, argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: running.agent_dir}, (env === undefined) ? {} : env),
    });
    child.stdout.resume();
    child.stderr.resume();
    return child;
}

async function serviceman_close(running, kill)
{
    const app = running.app;
    const servers = running.servers;
    // A program is the agent's child, and the agent is about to be killed where it stands: the
    // programs are stopped over the link first, so none of them outlives the test
    for (const service of app.services) {
        if ((service.type !== 'shell') || (service_phase(service) === 'stopped')) {
            continue;
        }
        await service_stop(app, service, 'the test is over').catch(function () {});
    }
    for (const service of app.services) {
        for (const instance of service.state.instances) {
            instance.agent.destroy();
            clearTimeout(instance.restart_timer);
        }
    }
    if (running.agent !== null) {
        running.agent.kill('SIGKILL');
    }
    for (const remote of app.remotes) {
        if (remote.state.socket !== null) {
            remote.state.socket.destroy();
        }
    }
    servers.server.close();
    servers.control.close();
    servers.server.closeAllConnections();
    servers.control.closeAllConnections();
    if ((app.file_log !== undefined) && (app.file_log !== null) && (app.file_log.stream !== null)) {
        app.file_log.stream.end();
    }
    if (kill === false) {
        return;
    }
    const state = state_file_read(process.env.SERVICEMAN_TEST_STATE);
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

// Waits for something the handlers do on their own clock, instead of guessing a sleep
async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + ((timeout_ms === undefined) ? 5000 : timeout_ms);
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

function state_file_read(state_file)
{
    try {
        return JSON.parse(fs.readFileSync(state_file, 'utf8'));
    }
    catch {
        return {containers: {}, commands: []};
    }
}

async function state_read(running)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/status'});
    return JSON.parse(answer.body);
}

function port_answers(upstream)
{
    return new Promise(function (resolve) {
        const socket = net.connect({host: upstream.host, port: upstream.port});
        socket.setTimeout(500);
        socket.once('connect', function () {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', function () {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', function () {
            socket.destroy();
            resolve(false);
        });
    });
}

function upgrade_request(port, host)
{
    return new Promise(function (resolve, reject) {
        const socket = net.connect({host: '127.0.0.1', port});
        const chunks = [];
        socket.on('error', reject);
        socket.on('connect', function () {
            socket.write(`GET /ws HTTP/1.1\r\nhost: ${host}\r\nconnection: Upgrade\r\nupgrade: echo\r\n\r\n`);
        });
        socket.on('data', function (chunk) {
            chunks.push(chunk);
            const text = Buffer.concat(chunks).toString('utf8');
            if (text.includes('\r\n\r\n') && (text.endsWith('ping') === false)) {
                socket.write('ping');
            }
            if (text.endsWith('ping')) {
                socket.destroy();
                const at = text.indexOf('\r\n\r\n');
                resolve({head: text.slice(0, at), echo: text.slice(at + 4)});
            }
        });
    });
}

// A raw client: sends one request, then either waits for the cut or vanishes with a reset itself
function socket_burn(port, request_text, reset_after_ms)
{
    return new Promise(function (resolve) {
        const socket = net.connect(port, '127.0.0.1', function () {
            socket.write(request_text);
            if (reset_after_ms !== null) {
                setTimeout(function () {
                    socket.resetAndDestroy();
                    resolve();
                }, reset_after_ms);
            }
        });
        socket.setTimeout(3000, function () {
            socket.destroy();
        });
        socket.resume();
        socket.on('error', function () {});
        socket.on('close', resolve);
    });
}

// One visit to the shell door: what it said, what the container wrote back. A query of its
// own opens another kind of shell — a container of a machine, say.
function shell_talk(control_port, name, lines, query)
{
    return new Promise(function (resolve) {
        const heard = {notes: [], text: '', closed_without_answer: true};
        const client = new ws.WebSocket(`ws://127.0.0.1:${control_port}/api/v1/shell?${(query === undefined) ? `service=${encodeURIComponent(name)}&slot=1` : query}`, {headers: {authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}});
        function done() {
            resolve(heard);
        }
        client.on('message', function (raw, binary) {
            heard.closed_without_answer = false;
            if (binary) {
                heard.text += raw.toString('utf8');
                return;
            }
            heard.notes.push(JSON.parse(raw.toString('utf8')).text);
            client.send(JSON.stringify({type: 'resize', cols: 100, rows: 30}));
            for (const line of lines) {
                client.send(JSON.stringify({type: 'input', data: line}));
            }
            setTimeout(function () {
                client.close();
            }, 250);
        });
        client.on('error', done);
        client.on('close', done);
    });
}

// Something already running that serviceman knows nothing about
function far_server()
{
    const server = http.createServer(function (req, res) {
        res.end(`the other server answers ${req.url}`);
    });
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            resolve({
                port: server.address().port,
                close: function () {
                    server.close();
                    server.closeAllConnections();
                },
            });
        });
    });
}

// A port nobody listens on yet, for a program that will
// Whether anything of a process group is left, asked the way a supervisor asks
function group_alive(pid)
{
    try {
        process.kill(-pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}

// Whether the port can be listened on again, which is the only thing a visitor cares about
function port_free(port)
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', function () {
            server.close(() => resolve(true));
        });
    });
}

function pid_alive(pid)
{
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}

function free_port()
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            server.close(function () {
                resolve(port);
            });
        });
    });
}
