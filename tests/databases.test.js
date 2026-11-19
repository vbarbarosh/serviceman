const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const crypto = require('crypto');
const database_samples = require('../src/main/src/helpers/database_samples');
const fake_database_engine = require('./fake_database_engine');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const php_image_make = require('../src/main/src/helpers/php_image_make');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = 'token-of-the-laptop-0123456789';
const SAMPLE_SQL = 'CREATE SCHEMA tiny;\nUSE tiny;\nCREATE TABLE note (id INT PRIMARY KEY, text TEXT);\nINSERT INTO note VALUES (1, \'hello\');\n';

// A machine with its agent and a docker of the test's own: the page's requests go the whole way,
// through serviceman, the link and the agent's tunnel, to the Engine API the machine would answer
test('a MySQL is brought up filled with a sample, a database made in it, then removed; no password is ever said', async function (t) {
    const world = await world_start(t);
    const engine = world.docker.engine;

    const empty = await control(world, 'GET', '/api/v1/databases');
    assert.strictEqual(empty.status, 200);
    assert.deepStrictEqual(empty.body.servers, []);
    assert.deepStrictEqual(empty.body.machines, [{remote: 'laptop', title: 'laptop', online: true, docker: true}]);
    assert.deepStrictEqual(empty.body.engines[0].versions, ['8.4', '8.0']);
    assert.ok(empty.body.engines[0].samples.some(v => v.value === 'tiny'));

    for (const [value, status] of [[{name: 'My SQL', engine: 'mysql', version: '8.4', remote: 'laptop'}, 400], [{name: 'pg-1', engine: 'oracle', version: '8.4', remote: 'laptop'}, 400], [{name: 'mysql-1', engine: 'mysql', version: '5.7', remote: 'laptop'}, 400], [{name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', sample: 'nope'}, 400], [{name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'phone'}, 404]]) {
        const refused = await control(world, 'POST', '/api/v1/databases', value);
        assert.strictEqual(refused.status, status, JSON.stringify(value));
    }

    const made = await control(world, 'POST', '/api/v1/databases', {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', sample: 'tiny'});
    assert.strictEqual(made.status, 202, JSON.stringify(made.body));
    assert.strictEqual(made.body.servers[0].phase, 'starting');
    const twice = await control(world, 'POST', '/api/v1/databases', {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop'});
    assert.strictEqual(twice.status, 409);
    const up = await view_until(world, v => (v.servers[0].phase === 'up'));
    assert.strictEqual(up.servers[0].port, 41337);
    assert.deepStrictEqual(up.servers[0].databases.map(v => v.name), ['tiny']);

    // Made once, as said: on its network, its data in its own volume, restarting with docker,
    // its port on the machine's loopback alone
    const spec = engine.containers.get('serviceman-db-mysql-1').spec;
    assert.strictEqual(spec.Image, 'docker.io/library/mysql:8.4');
    assert.strictEqual(spec.HostConfig.NetworkMode, 'serviceman-databases');
    assert.deepStrictEqual(spec.HostConfig.Binds, ['serviceman-db-mysql-1:/var/lib/mysql']);
    assert.deepStrictEqual(spec.HostConfig.PortBindings['3306/tcp'], [{HostIp: '127.0.0.1', HostPort: ''}]);
    assert.strictEqual(spec.HostConfig.RestartPolicy.Name, 'unless-stopped');
    assert.ok(engine.networks.has('serviceman-databases'));

    const shop = await control(world, 'POST', '/api/v1/databases/mysql-1/databases', {name: 'shop'});
    assert.strictEqual(shop.status, 201, JSON.stringify(shop.body));
    assert.deepStrictEqual(shop.body.servers[0].databases.map(v => v.name), ['shop', 'tiny']);
    assert.strictEqual((await control(world, 'POST', '/api/v1/databases/mysql-1/databases', {name: 'shop'})).status, 409);
    assert.strictEqual((await control(world, 'POST', '/api/v1/databases/mysql-1/databases', {name: 'Shop!'})).status, 400);
    assert.strictEqual((await control(world, 'POST', '/api/v1/databases/mysql-9/databases', {name: 'shop'})).status, 404);

    // The attacker's story: the passwords are kept by serviceman at 0600; no answer to the page
    // carries one, and no command run on the machine has one in its argv; what a SQL file held
    // is gone from the container once it ran
    const kept_file = path.join(world.state_dir, 'databases.json');
    assert.strictEqual(fs.statSync(kept_file).mode & 0o777, 0o600);
    const kept = JSON.parse(fs.readFileSync(kept_file, 'utf8')).servers[0];
    const secrets = [kept.root].concat(Object.values(kept.users).map(v => v.password));
    assert.strictEqual(secrets.length, 3);
    const answers = JSON.stringify([made.body, up, shop.body]);
    assert.deepStrictEqual(secrets.filter(v => answers.includes(v)), []);
    const cmds = JSON.stringify([...engine.execs.values()].map(v => v.spec.Cmd));
    assert.deepStrictEqual(secrets.filter(v => cmds.includes(v)), []);
    assert.deepStrictEqual(Object.keys(engine.containers.get('serviceman-db-mysql-1').files), []);
    assert.strictEqual(fs.readFileSync(world.agent_log, 'utf8').includes(kept.root), false);

    const removed = await control(world, 'DELETE', '/api/v1/databases/mysql-1');
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    assert.deepStrictEqual(removed.body.servers, []);
    assert.strictEqual(engine.containers.has('serviceman-db-mysql-1'), false);
    assert.strictEqual(engine.volumes.has('serviceman-db-mysql-1'), false);
});

// PostgreSQL the same way: its image, its data, its port, its client; a sample loaded into a
// database made for it first, then each database's own user, the owner of it alone
test('a PostgreSQL is brought up filled with a sample, and a database made in it is its user\'s alone', async function (t) {
    const world = await world_start(t);
    const engine = world.docker.engine;
    const made = await control(world, 'POST', '/api/v1/databases', {name: 'postgresql-1', engine: 'postgresql', version: '17', remote: 'laptop', sample: 'tiny'});
    assert.strictEqual(made.status, 202, JSON.stringify(made.body));
    const up = await view_until(world, v => (v.servers[0].phase === 'up'));
    assert.deepStrictEqual(up.servers[0].databases.map(v => `${v.name} ${v.tables} ${v.user}`), ['tiny 2 tiny']);
    const spec = engine.containers.get('serviceman-db-postgresql-1').spec;
    assert.strictEqual(spec.Image, 'docker.io/library/postgres:17');
    assert.deepStrictEqual(spec.HostConfig.Binds, ['serviceman-db-postgresql-1:/var/lib/postgresql/data']);
    assert.deepStrictEqual(Object.keys(spec.HostConfig.PortBindings), ['5432/tcp']);
    assert.ok(spec.Env[0].startsWith('POSTGRES_PASSWORD='));
    assert.strictEqual(up.servers[0].port, 41337);

    // The sample ran in its own database, made afresh first, as root
    const ran = engine.sql.filter(v => v.container === 'serviceman-db-postgresql-1');
    assert.ok(ran.some(v => v.sql.startsWith('DROP DATABASE IF EXISTS "tiny" WITH (FORCE)')));
    assert.ok(ran.some(v => v.sql.includes('CREATE TABLE note') && v.cmd.includes("-d 'tiny'")));
    assert.ok(ran.every(v => v.cmd.startsWith('psql -v ON_ERROR_STOP=1')));

    const notes = await control(world, 'POST', '/api/v1/databases/postgresql-1/databases', {name: 'notes'});
    assert.strictEqual(notes.status, 201, JSON.stringify(notes.body));
    assert.deepStrictEqual(notes.body.servers[0].databases.map(v => v.name), ['notes', 'tiny']);
    const user = engine.sql.filter(v => v.sql.includes('CREATE DATABASE "notes"'))[0].sql;
    assert.match(user, /CREATE DATABASE "notes" OWNER "notes";/);
    assert.match(user, /REVOKE ALL ON DATABASE "notes" FROM PUBLIC;/);
    assert.match(user, /\\connect "notes"\nGRANT ALL ON SCHEMA public TO "notes";/);

    const kept = JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0];
    const cmds = JSON.stringify([...engine.execs.values()].map(v => v.spec.Cmd));
    assert.deepStrictEqual([kept.root, kept.users.notes.password, kept.users.tiny.password].filter(v => cmds.includes(v)), [], 'no password on a command line');
    assert.ok([...engine.execs.values()].every(v => (v.spec.Env.length === 0) || (v.spec.Env[0] === `PGPASSWORD=${kept.root}`)));
});

// A sample whose file is not the one pinned is refused, and the server says why; brought up
// again, it keeps the password its volume was made with
test('a sample that is not the one pinned fails the server, and it can be brought up again', async function (t) {
    const world = await world_start(t);
    world.sample_bytes = Buffer.from('DROP DATABASE mysql;\n');
    const made = await control(world, 'POST', '/api/v1/databases', {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', sample: 'tiny'});
    assert.strictEqual(made.status, 202);
    const failed = await view_until(world, v => (v.servers[0].phase === 'failed'));
    assert.match(failed.servers[0].error, /^Tiny at http:\/\/127\.0\.0\.1:\d+\/tiny\.sql is not the one pinned: its sha256 is [0-9a-f]{64}/);
    const sql = [...world.docker.engine.execs.values()].filter(v => v.spec.Cmd[0] === 'sh');
    assert.deepStrictEqual(sql, [], 'nothing of it was run');
    const root = JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0].root;

    world.sample_bytes = Buffer.from(SAMPLE_SQL);
    const again = await control(world, 'POST', '/api/v1/databases', {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', sample: 'tiny'});
    assert.strictEqual(again.status, 202);
    const up = await view_until(world, v => (v.servers[0].phase === 'up'));
    assert.deepStrictEqual(up.servers[0].databases.map(v => v.name), ['tiny']);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0].root, root);
});

// A PHP file dropped on Apps: an app folder on the machine, run in serviceman's PHP image, an
// Adminer's with its login beside it; the image made once through the machine's docker
test('a PHP file becomes an app folder on the machine, an Adminer with its login; its image is made once', async function (t) {
    const world = await world_start(t);
    const adminer = Buffer.from('<?php\n/** Adminer - Compact database management */namespace\nAdminer;echo 1;\n');
    const made = await put_php(world, 'admin', 'adminer.php', adminer, 'laptop');
    assert.strictEqual(made.status, 201, JSON.stringify(made.body));
    const folder = path.join(world.agent_dir, 'services', 'admin');
    assert.deepStrictEqual(fs.readdirSync(folder).sort(), ['adminer-plugins.php', 'adminer.php', 'bin', 'serviceman_database.php']);
    assert.deepStrictEqual(fs.readFileSync(path.join(folder, 'adminer.php')), adminer);
    assert.match(fs.readFileSync(path.join(folder, 'bin', 'run'), 'utf8'), /exec php -S "0\.0\.0\.0:\$PORT" adminer\.php/);
    assert.strictEqual(fs.statSync(path.join(folder, 'bin', 'run')).mode & 0o111, 0o111, 'bin/run runs');
    assert.match(fs.readFileSync(path.join(folder, 'adminer-plugins.php'), 'utf8'), /require __DIR__ \. '\/serviceman_database\.php'/);
    const entry = JSON.parse(fs.readFileSync(world.config_path, 'utf8')).services.find(v => v.name === 'admin');
    assert.deepStrictEqual(entry, {name: 'admin', type: 'shell', remote: 'laptop', image: 'serviceman-php:8.4', command: 'bin/run', cwd: folder, publish: {host: 'admin.localhost', port: 8080}});

    const plain = await put_php(world, 'hello', 'hello.php', Buffer.from('<?php echo "hi";\n'), 'laptop');
    assert.strictEqual(plain.status, 201);
    assert.deepStrictEqual(fs.readdirSync(path.join(world.agent_dir, 'services', 'hello')).sort(), ['bin', 'hello.php'], 'no login for what is not Adminer');

    assert.strictEqual((await put_php(world, 'admin', 'adminer.php', adminer, 'laptop')).status, 409, 'a name taken');
    assert.strictEqual((await put_php(world, 'other', 'my file.php', adminer, 'laptop')).status, 400, 'a file name with a space');
    assert.strictEqual((await put_php(world, 'Other', 'adminer.php', adminer, 'laptop')).status, 400, 'a name in capitals');
    assert.strictEqual((await put_php(world, 'other', 'adminer.php', adminer, 'phone')).status, 400, 'a machine that is not there');

    const remote = world.app.remote_by_name.laptop;
    const service = world.app.service_by_name.admin;
    assert.strictEqual(await php_image_make(world.app, remote, service), true);
    assert.strictEqual(await php_image_make(world.app, remote, service), false, 'made once');
    const builds = world.docker.engine.requests.filter(v => v.url.startsWith('/build'));
    assert.strictEqual(builds.length, 1);
    assert.match(builds[0].url, /t=serviceman-php%3A8\.4/);
    assert.ok(builds[0].body.includes('docker-php-ext-install mysqli pdo_mysql pgsql pdo_pgsql'));
    world.docker.engine.images.clear();
    world.docker.engine.fail_build = true;
    await assert.rejects(php_image_make(world.app, remote, service), /could not make serviceman-php:8\.4: no space left on device/);
});

// A file browser: serviceman's own File Manager put on the machine as an app folder, over the
// folder picked; a system folder refused before anything is sent
test('a file browser is the File Manager on the machine, over the folder picked', async function (t) {
    const world = await world_start(t);
    const made = await control(world, 'PUT', '/api/v1/apps/files/file-browser', {remote: 'laptop', path: null});
    assert.strictEqual(made.status, 201, JSON.stringify(made.body));
    const folder = path.join(world.agent_dir, 'services', 'files');
    for (const file of ['bin/run', 'modules/file_manager/app/index.js', 'LICENSE', 'node_modules/@vbarbarosh/node-helpers/LICENSE']) {
        assert.ok(fs.existsSync(path.join(folder, file)), file);
    }
    assert.match(fs.readFileSync(path.join(folder, 'bin', 'run'), 'utf8'), /exec node modules\/file_manager\/app\/index\.js/);
    assert.strictEqual(fs.statSync(path.join(folder, 'bin', 'run')).mode & 0o111, 0o111, 'bin/run runs');
    const entry = JSON.parse(fs.readFileSync(world.config_path, 'utf8')).services.find(v => v.name === 'files');
    assert.deepStrictEqual([entry.type, entry.remote, entry.command, entry.cwd], ['shell', 'laptop', 'bin/run', folder]);
    assert.deepStrictEqual(entry.folders, [{path: null, env: 'FILES_DIR'}]);
    assert.ok(entry.publish.port >= 8080, String(entry.publish.port));

    const photos = await control(world, 'PUT', '/api/v1/apps/photos/file-browser', {remote: 'laptop', path: '/srv/photos'});
    assert.strictEqual(photos.status, 201);
    const second = JSON.parse(fs.readFileSync(world.config_path, 'utf8')).services.find(v => v.name === 'photos');
    assert.deepStrictEqual(second.folders, [{path: '/srv/photos', env: 'FILES_DIR'}]);
    assert.notStrictEqual(second.publish.port, entry.publish.port, 'a port of its own on the machine');

    const system = await control(world, 'PUT', '/api/v1/apps/etc/file-browser', {remote: 'laptop', path: '/etc'});
    assert.strictEqual(system.status, 400);
    assert.match(system.body.error, /a folder of the system's own/);
    assert.strictEqual(fs.existsSync(path.join(world.agent_dir, 'services', 'etc')), false, 'nothing sent');
    assert.strictEqual((await control(world, 'PUT', '/api/v1/apps/files/file-browser', {remote: 'laptop', path: null})).status, 409);
    assert.strictEqual((await control(world, 'PUT', '/api/v1/apps/other/file-browser', {remote: 'phone', path: null})).status, 400);
});

async function put_php(world, name, file, bytes, remote)
{
    const answer = await fetch_host({port: world.control_port, host: '127.0.0.1', path: `/api/v1/apps/${name}/php?remote=${remote}&file=${encodeURIComponent(file)}`, method: 'PUT', headers: {'content-length': String(bytes.length)}, body: bytes});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

async function world_start(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'databases-'));
    const state_dir = path.join(dir, 'state');
    const out = {dir, state_dir, sample_bytes: Buffer.from(SAMPLE_SQL), agent_log: path.join(dir, 'agent.log')};
    // The sample, served here and pinned for this test alone
    const samples = http.createServer(function (req, res) {
        res.end(out.sample_bytes);
    });
    await new Promise(v => samples.listen(0, '127.0.0.1', v));
    const pinned = [{url: `http://127.0.0.1:${samples.address().port}/tiny.sql`, sha256: crypto.createHash('sha256').update(SAMPLE_SQL).digest('hex')}];
    database_samples.mysql.tiny = {label: 'Tiny', about: 'one table', database: 'tiny', files: pinned};
    database_samples.postgresql.tiny = {label: 'Tiny', about: 'one table', database: 'tiny', into: 'tiny', files: pinned};
    out.docker = await fake_database_engine(path.join(dir, 'docker.sock'));
    // The docker command says a version, which is all the agent asks of it here
    const docker = path.join(dir, 'docker');
    fs.writeFileSync(docker, '#!/bin/sh\necho 27.3.1\n', {mode: 0o755});
    // In a file, as serviceman runs: a new app is written into it
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: TOKEN}],
        services: [],
    }, null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    app.state_dir = state_dir;
    out.config_path = config_path;
    out.agent_dir = path.join(dir, 'agent');
    const servers = await server_start(app);
    Object.assign(out, {app, servers, control_port: servers.control.address().port});
    const log = fs.openSync(out.agent_log, 'w');
    const argv = [AGENT, '--url', `http://127.0.0.1:${out.control_port}`, '--token', TOKEN, '--docker', docker, '--peer-port', '0'];
    const env = Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(dir, 'agent'), SERVICEMAN_LOG_TIME: 'off', DOCKER_HOST: `unix://${path.join(dir, 'docker.sock')}`});
    out.agent = child_process.spawn(process.execPath, argv, {stdio: ['ignore', log, log], env});
    t.after(async function () {
        out.agent.kill();
        delete database_samples.mysql.tiny;
        delete database_samples.postgresql.tiny;
        samples.close();
        await out.docker.close();
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
        fs.closeSync(log);
        fs.rmSync(dir, {recursive: true, force: true});
    });
    await wait_until(() => app.remotes.every(v => (v.state.phase === 'online') && (v.state.resources !== null) && (v.state.resources.docker !== null)), 15000);
    return out;
}

async function control(world, method, path_asked, value)
{
    // With its length, as a browser sends it: node sends a DELETE's body with none
    const body = (value === undefined) ? undefined : JSON.stringify(value);
    const headers = (body === undefined) ? {} : {'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body))};
    const answer = await fetch_host({port: world.control_port, host: '127.0.0.1', path: path_asked, method, headers, body});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

// The page's view, read until it shows what the test waits for
async function view_until(world, ready)
{
    let last = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        last = (await control(world, 'GET', '/api/v1/databases')).body;
        try {
            if (ready(last)) {
                return last;
            }
        }
        catch {
            // A view that does not have the part asked about yet
        }
        await timers.setTimeout(100);
    }
    throw new Error(`the view never came to it: ${JSON.stringify(last)}`);
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
