const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const compose_mounts = require('../src/main/src/helpers/compose_mounts');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fake_docker_engine = require('./fake_docker_engine');
const fs = require('fs');
const logline_compare = require('../src/main/src/helpers/logline_compare');
const logline_files = require('../src/main/src/helpers/logline_files');
const logline_place = require('../src/main/src/helpers/logline_place');
const logline_update = require('../src/main/src/helpers/logline_update');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';
const PROJECT = 'clickstack-playground';

test('the compose file says which service mounts which of Logline\'s files', function () {
    const mounts = compose_mounts(fs.readFileSync(path.join(logline_files.dir, 'docker-compose.yml'), 'utf8'));
    assert.deepStrictEqual(mounts.clickstack, ['config/clickhouse.xml']);
    assert.deepStrictEqual(mounts['log-ui'].slice().sort(), ['config/nginx.conf', 'log-ui/app.js', 'log-ui/index.html', 'log-ui/styles.css']);
    assert.deepStrictEqual(mounts.lines, []);
});

test('Logline\'s files are its compose file, config, viewer and lines server, not its tests', function () {
    const paths = logline_files().map(v => v.path);
    assert.ok(paths.includes('docker-compose.yml'));
    assert.ok(paths.includes('lines/src/lines_serve.js'));
    assert.ok(paths.includes('log-ui/app.js'));
    assert.ok(paths.every(v => (v.startsWith('lines/tests/') === false) && (v.endsWith('.test.js') === false) && (v.includes('node_modules') === false)), paths.join(' '));
});

test('Update Logline puts what differs on its machine, builds, and starts again what mounts a changed file', async function (t) {
    const world = await world_make(t);
    // Logline there as it ran this morning: the compose file the same, the viewer's proxy older,
    // the viewer's script missing, and the machine's own .env
    const there = world.there;
    fs.mkdirSync(path.join(there, 'config'), {recursive: true});
    fs.copyFileSync(path.join(logline_files.dir, 'docker-compose.yml'), path.join(there, 'docker-compose.yml'));
    fs.writeFileSync(path.join(there, 'config', 'nginx.conf'), 'server { listen 80; }\n');
    fs.writeFileSync(path.join(there, '.env'), 'TAILSCALE_IP=100.64.0.20\n');

    const place = await logline_place(world.app);
    assert.strictEqual(place.dir, there);
    assert.strictEqual(place.project, PROJECT);
    const before = await logline_compare(world.app, place);
    assert.strictEqual(before.find(v => v.path === 'docker-compose.yml').state, 'same');
    assert.strictEqual(before.find(v => v.path === 'config/nginx.conf').state, 'differs');
    assert.strictEqual(before.find(v => v.path === 'log-ui/app.js').state, 'missing');

    const said = [];
    const done = await logline_update(world.app, v => said.push(v));
    assert.match(done.said, /files put, started again/);
    for (const item of logline_files()) {
        assert.strictEqual(fs.readFileSync(path.join(there, item.path), 'utf8'), fs.readFileSync(item.abs, 'utf8'), item.path);
    }
    assert.strictEqual(fs.readFileSync(path.join(there, '.env'), 'utf8'), 'TAILSCALE_IP=100.64.0.20\n', 'the machine\'s .env stays');
    const asked = world.docker_asked();
    assert.strictEqual(asked.length, 2);
    assert.deepStrictEqual(asked[0], ['compose', '-p', PROJECT, '-f', path.join(there, 'docker-compose.yml'), 'up', '-d', '--build']);
    assert.deepStrictEqual(asked[1].slice(-4), ['restart', 'clickstack', 'log-ui', 'log-agent'], 'every service that mounts a file that was put');
    assert.deepStrictEqual(said.filter(v => v.step !== undefined).map(v => v.step), [1, 2, 3, 4]);

    // Asked again, everything is the same: nothing put, nothing started
    const again = await logline_update(world.app, function () {});
    assert.match(again.said, /up to date/);
    assert.strictEqual(world.docker_asked().length, 2);
});

test('Logline\'s machine not found is said in words', async function (t) {
    const world = await world_make(t, {services: []});
    await assert.rejects(logline_place(world.app), /no service is named logline/);
});

async function world_make(t, over)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logline-update-'));
    const there = path.join(dir, 'logline');
    fs.mkdirSync(there);
    const engine = await fake_docker_engine(path.join(dir, 'docker.sock'));
    engine.add('clickstack-playground-lines-1', {labels: {'com.docker.compose.project': PROJECT, 'com.docker.compose.project.working_dir': there, 'com.docker.compose.project.config_files': path.join(there, 'docker-compose.yml')}});
    // docker as the agent runs it: says what it was asked, one line of JSON each time
    const asked_file = path.join(dir, 'docker-asked');
    const docker = path.join(dir, 'docker');
    fs.writeFileSync(docker, `#!/bin/sh\nnode -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)) + "\\n")' ${JSON.stringify(asked_file)} "$@"\n`, {mode: 0o755});
    const config = config_from_json(Object.assign({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [{name: 'logline', type: 'external', remote: 'vps1', publish: {host: 'logline.test'}, upstream: '127.0.0.1:9'}],
    }, over), __dirname);
    const app = app_from_config(config);
    app.state_dir = path.join(dir, 'state');
    fs.mkdirSync(app.state_dir);
    const servers = await server_start(app);
    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${servers.control.address().port}`, '--token', TOKEN], {
        stdio: 'ignore',
        env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(dir, 'agent'), DOCKER_HOST: `unix://${path.join(dir, 'docker.sock')}`, SERVICEMAN_DOCKER: docker, SERVICEMAN_LOG_DIR: 'none'}),
    });
    t.after(function () {
        agent.kill('SIGKILL');
        for (const remote of app.remotes) {
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
        engine.close();
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const remote = app.remote_by_name.vps1;
    for (let i = 0; (remote.state.phase !== 'online') || (remote.state.resources === null); i++) {
        assert.ok(i < 400, 'the agent dials in');
        await timers.setTimeout(25);
    }
    return {
        app,
        there,
        // The compose commands it was asked; the agent asks docker its version on its own
        docker_asked: () => fs.existsSync(asked_file) ? fs.readFileSync(asked_file, 'utf8').split('\n').filter(v => v !== '').map(v => JSON.parse(v)).filter(v => v[0] === 'compose') : [],
    };
}
