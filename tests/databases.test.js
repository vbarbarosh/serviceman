const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const crypto = require('crypto');
const database_env = require('../src/main/src/helpers/database_env');
const database_root_held = require('../src/main/src/helpers/database_root_held');
const database_samples = require('../src/main/src/helpers/database_samples');
const fake_database_engine = require('./fake_database_engine');
const fetch_host = require('./fetch_host');
const forwards_tell = require('../src/main/src/helpers/forwards_tell');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const php_image_make = require('../src/main/src/helpers/php_image_make');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');
const tls = require('tls');

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
    // With the unnamed volumes its image declares, a MongoDB's /data/configdb
    assert.strictEqual(engine.requests.filter(v => (v.method === 'DELETE') && v.url.includes('/containers/serviceman-db-mysql-1?')).map(v => new URL(v.url, 'http://docker').searchParams.get('v')).join(), '1');
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
    // Its data is not browsed yet: MongoDB's comes first
    const browsed = await control(world, 'GET', '/api/v1/databases/postgresql-1/notes/browse/collections');
    assert.deepStrictEqual([browsed.status, browsed.body.error], [501, 'postgresql-1 is a PostgreSQL: its data is browsed here once its engine is, MongoDB first']);

    const kept = JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0];
    const cmds = JSON.stringify([...engine.execs.values()].map(v => v.spec.Cmd));
    assert.deepStrictEqual([kept.root, kept.users.notes.password, kept.users.tiny.password].filter(v => cmds.includes(v)), [], 'no password on a command line');
    assert.ok([...engine.execs.values()].every(v => (v.spec.Env.length === 0) || (v.spec.Env[0] === `PGPASSWORD=${kept.root}`)));
});

// A CouchDB comes up with its admin and the ini that trusts a user name signed by its secret, laid
// in before it starts; it is one row, its admin, with the app's databases counted; + Database is
// refused; and neither its password nor its secret is ever said or put on a command line
test('a CouchDB is brought up with its admin and its secret, as one row an app picks as its admin', async function (t) {
    const world = await world_start(t);
    const engine = world.docker.engine;
    const made = await control(world, 'POST', '/api/v1/databases', {name: 'couch-1', engine: 'couchdb', version: '3', remote: 'laptop'});
    assert.strictEqual(made.status, 202, JSON.stringify(made.body));
    // A database the app made for a user it signed in, there before the page first asks
    await wait_until(() => engine.containers.has('serviceman-db-couch-1'), 10000);
    const container = engine.containers.get('serviceman-db-couch-1');
    container.databases.add('userdb-616c696365');
    const up = await view_until(world, v => (v.servers[0].phase === 'up'));
    assert.deepStrictEqual(up.servers[0].databases.map(v => `${v.name} ${v.tables} ${v.bytes} ${v.user}`), ['admin 1 16384 admin']);
    assert.strictEqual(up.engines.find(v => v.value === 'couchdb').samples.length, 0);

    const spec = container.spec;
    assert.strictEqual(spec.Image, 'docker.io/library/couchdb:3');
    assert.deepStrictEqual(spec.HostConfig.Binds, ['serviceman-db-couch-1:/opt/couchdb/data']);
    assert.deepStrictEqual(spec.HostConfig.PortBindings, {'5984/tcp': [{HostIp: '127.0.0.1', HostPort: ''}]});
    assert.strictEqual(spec.HostConfig.NetworkMode, 'serviceman-databases');
    const kept = JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0];
    assert.match(kept.secret, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(kept.users, {admin: {user: 'admin', password: kept.root}});
    assert.deepStrictEqual(spec.Env.sort(), [`COUCHDB_PASSWORD=${kept.root}`, 'COUCHDB_USER=admin']);
    const ini = container.files['/opt/couchdb/etc/local.d/authwall.ini'].toString('utf8');
    assert.match(ini, /^authentication_handlers = proxy, cookie, default$/m);
    assert.match(ini, /^proxy_use_secret = true$/m);
    assert.ok(ini.includes(`\nsecret = ${kept.secret}\n`));
    assert.match(ini, /^x_auth_username = X-Forwarded-User$/m);
    assert.match(ini, /^x_auth_token = X-Forwarded-User-Token$/m);
    assert.match(ini, /^single_node = true$/m);

    const refused = await control(world, 'POST', '/api/v1/databases/couch-1/databases', {name: 'notes'});
    assert.strictEqual(refused.status, 409);
    assert.match(refused.body.error, /its databases are made by the app given it, as its admin/);

    // An app whose store for each user it is shows on its page among the apps given it, and the
    // page knows when its databases were read, for while its machine is away
    const notes = await control(world, 'POST', '/api/v1/services', {service: {name: 'notes', type: 'external', remote: 'laptop', publish: {host: 'notes.localhost'}, upstream: '127.0.0.1:9', store: {server: 'couch-1'}}});
    assert.strictEqual(notes.status, 200, JSON.stringify(notes.body));
    const stored = (await control(world, 'GET', '/api/v1/databases')).body.servers[0];
    assert.deepStrictEqual(stored.stores, ['notes']);
    assert.ok((typeof stored.read_at === 'number') && (Date.now() - stored.read_at < 60000), JSON.stringify(stored.read_at));

    const said = JSON.stringify(up) + JSON.stringify(refused.body);
    assert.strictEqual(said.includes(kept.root) || said.includes(kept.secret), false, 'neither is ever in an answer');
    const cmds = JSON.stringify([...engine.execs.values()].map(v => v.spec.Cmd));
    assert.strictEqual(cmds.includes(kept.root) || cmds.includes(kept.secret), false, 'neither on a command line');
});

// A MongoDB comes up empty, root named in its env and its port on the machine's loopback alone;
// it is up once root signs in to a server that is not its first start's own, forked; a database
// made in it is made by its user's createUser, the owner of it alone; and no password is ever
// said or put on a command line, the script that held one gone once it ran
test('a MongoDB is brought up empty, and a database made in it is its user\'s alone', async function (t) {
    const world = await world_start(t);
    const engine = world.docker.engine;
    const sampled = await control(world, 'POST', '/api/v1/databases', {name: 'mongodb-1', engine: 'mongodb', version: '8.0', remote: 'laptop', sample: 'tiny'});
    assert.strictEqual(sampled.status, 400, 'a MongoDB has no sample');
    const made = await control(world, 'POST', '/api/v1/databases', {name: 'mongodb-1', engine: 'mongodb', version: '8.0', remote: 'laptop'});
    assert.strictEqual(made.status, 202, JSON.stringify(made.body));
    const up = await view_until(world, v => (v.servers[0].phase === 'up'));
    assert.deepStrictEqual(up.servers[0].databases, []);
    assert.strictEqual(up.servers[0].port, 41337);
    const listed = up.engines.find(v => v.value === 'mongodb');
    assert.deepStrictEqual([listed.label, listed.versions, listed.samples], ['MongoDB', ['8.0', '7.0'], []]);

    const kept_file = path.join(world.state_dir, 'databases.json');
    const root = JSON.parse(fs.readFileSync(kept_file, 'utf8')).servers[0].root;
    const container = engine.containers.get('serviceman-db-mongodb-1');
    const spec = container.spec;
    assert.strictEqual(spec.Image, 'docker.io/library/mongo:8.0');
    assert.deepStrictEqual(spec.HostConfig.Binds, ['serviceman-db-mongodb-1:/data/db']);
    assert.deepStrictEqual(spec.HostConfig.PortBindings, {'27017/tcp': [{HostIp: '127.0.0.1', HostPort: ''}]});
    assert.strictEqual(spec.HostConfig.NetworkMode, 'serviceman-databases');
    assert.deepStrictEqual(spec.Env.slice().sort(), [`MONGO_INITDB_ROOT_PASSWORD=${root}`, 'MONGO_INITDB_ROOT_USERNAME=root']);
    const ping = [...engine.execs.values()].find(v => v.spec.Cmd[0] === 'mongosh').spec;
    assert.match(ping.Cmd[ping.Cmd.length - 1], /auth\("root", process\.env\.MONGO_ROOT_PASSWORD\)/);
    assert.match(ping.Cmd[ping.Cmd.length - 1], /argv\.includes\("--fork"\) \? 1 : 0/);
    assert.deepStrictEqual(ping.Env, [`MONGO_ROOT_PASSWORD=${root}`]);
    // Its root signs in from inside its container alone, held as it came up, and kept so
    const holds = engine.sql.filter(v => v.sql.includes('authenticationRestrictions'));
    assert.deepStrictEqual(holds.map(v => v.sql), ['db.getSiblingDB("admin").updateUser("root", {authenticationRestrictions: [{clientSource: ["127.0.0.1", "::1"]}]});\n']);
    assert.strictEqual(JSON.parse(fs.readFileSync(kept_file, 'utf8')).servers[0].root_held, true);
    // One made before that is held once, at its machine's next dial-in, and not again
    const before = JSON.parse(fs.readFileSync(kept_file, 'utf8'));
    delete before.servers[0].root_held;
    fs.writeFileSync(kept_file, JSON.stringify(before));
    await database_root_held(world.app, 'mongodb-1');
    await database_root_held(world.app, 'mongodb-1');
    assert.strictEqual(engine.sql.filter(v => v.sql.includes('authenticationRestrictions')).length, 2);
    assert.strictEqual(JSON.parse(fs.readFileSync(kept_file, 'utf8')).servers[0].root_held, true);

    const orders = await control(world, 'POST', '/api/v1/databases/mongodb-1/databases', {name: 'orders'});
    assert.strictEqual(orders.status, 201, JSON.stringify(orders.body));
    assert.deepStrictEqual(orders.body.servers[0].databases.map(v => `${v.name} ${v.tables} ${v.user}`), ['orders 3 orders']);
    assert.strictEqual((await control(world, 'POST', '/api/v1/databases/mongodb-1/databases', {name: 'orders'})).status, 409);
    // The page names the variable each app given it finds it in, as the app's own row says it
    for (const [name, env] of [['shop', 'MONGODB_URL'], ['report', 'DB_URL']]) {
        const given = await control(world, 'POST', '/api/v1/services', {service: {name, type: 'docker', remotes: ['laptop'], image: 'docker.io/library/node:22', publish: {host: `${name}.localhost`, port: 3000}, databases: [{server: 'mongodb-1', database: 'orders', env}]}});
        assert.strictEqual(given.status, 200, JSON.stringify(given.body));
    }
    const picked = (await control(world, 'GET', '/api/v1/databases')).body.servers[0].databases[0];
    assert.deepStrictEqual([picked.apps, picked.envs], [['shop', 'report'], {shop: 'MONGODB_URL', report: 'DB_URL'}]);
    const script = engine.sql.find(v => v.sql.includes('createUser'));
    assert.ok(script.cmd.startsWith('mongosh --quiet --norc mongodb://127.0.0.1:27017/admin '), script.cmd);
    assert.match(script.sql, /^const roles = \[\{role: 'dbOwner', db: 'orders'\}\];$/m);
    assert.match(script.sql, /db\.getSiblingDB\('orders'\)\.createUser\(\{user: 'orders', pwd: '[0-9a-f]{24}', roles\}\);/);
    const scripts = [...engine.execs.values()].filter(v => v.spec.Cmd[0] === 'sh').map(v => v.spec.Cmd[v.spec.Cmd.length - 1]);
    assert.ok((scripts.length > 0) && scripts.every(v => v.endsWith('.js')), 'mongosh loads a file only when it ends in .js');

    // Its data, browsed: a script run inside its container, in orders, signed in as orders' own
    // user, its name and password in the exec's env; what is typed goes in as data
    const collections = await control(world, 'GET', '/api/v1/databases/mongodb-1/orders/browse/collections');
    assert.deepStrictEqual([collections.status, collections.body.items.map(v => `${v.name} ${v.count}`)], [200, ['items 2']]);
    const page = await control(world, 'GET', `/api/v1/databases/mongodb-1/orders/browse/documents?${new URLSearchParams({collection: 'items', filter: '{n: {$gt: 1}}', skip: '50'})}`);
    assert.deepStrictEqual([page.status, page.body.skip, page.body.limit, JSON.parse(page.body.ask.filter)], [200, 50, 50, {n: {$gt: 1}}]);
    const browsed = [...engine.execs.values()].filter(v => (v.spec.Cmd[0] === 'sh') && v.spec.Cmd[2].includes('SERVICEMAN_DB_USER')).map(v => v.spec);
    assert.strictEqual(browsed.length, 2);
    assert.ok(browsed[1].Cmd[2].startsWith('mongosh --quiet --norc \'mongodb://127.0.0.1:27017/orders\' '), browsed[1].Cmd[2]);
    assert.deepStrictEqual(browsed[1].Env, ['SERVICEMAN_DB_USER=orders', `SERVICEMAN_DB_PASSWORD=${JSON.parse(fs.readFileSync(kept_file, 'utf8')).servers[0].users.orders.password}`]);
    const refused = [
        ['/api/v1/databases/mongodb-1/nope/browse/collections', 404, 'mongodb-1 has no database "nope" made by serviceman'],
        ['/api/v1/databases/mongodb-2/orders/browse', 404, 'no database server called "mongodb-2"'],
        ['/api/v1/databases/mongodb-1/orders/browse/documents?collection=items&filter=%7Ba%3A%20db.x()%7D', 400, 'the filter: "db.x" is not a value: a query is data, the shell\'s types (ObjectId, ISODate, NumberLong…) and no code, at 5'],
    ];
    for (const [asked, status, said] of refused) {
        const answer = await control(world, 'GET', asked);
        assert.deepStrictEqual([answer.status, answer.body.error], [status, said], asked);
    }
    assert.strictEqual((await control(world, 'POST', '/api/v1/databases/mongodb-1/orders/browse/documents', {})).status, 404, 'no door changes its data yet');

    const kept = JSON.parse(fs.readFileSync(kept_file, 'utf8')).servers[0];
    const secrets = [kept.root, kept.users.orders.password];
    const answers = JSON.stringify([made.body, up, orders.body, collections.body, page.body]);
    assert.deepStrictEqual(secrets.filter(v => answers.includes(v)), [], 'no password in an answer');
    const cmds = JSON.stringify([...engine.execs.values()].map(v => v.spec.Cmd));
    assert.deepStrictEqual(secrets.filter(v => cmds.includes(v)), [], 'no password on a command line');
    assert.deepStrictEqual(Object.keys(container.files), []);
});

// A server's port shows up on another machine as a forward that is part of it: written from the
// page's {to} alone, from its machine and its port; a forward that stays where it showed up keeps
// its label; it follows the port when docker picks another at a start; a token neither sees it
// nor writes one; and it goes with the server
test('a database server\'s port goes to another machine as its forward, follows its port, and goes with it', async function (t) {
    const world = await world_start(t, ['vps2']);
    const engine = world.docker.engine;
    const made = await control(world, 'POST', '/api/v1/databases', {name: 'mongodb-1', engine: 'mongodb', version: '8.0', remote: 'laptop'});
    assert.strictEqual(made.status, 202, JSON.stringify(made.body));
    await view_until(world, v => (v.servers[0].phase === 'up'));
    function file() {
        return JSON.parse(fs.readFileSync(world.config_path, 'utf8')).forwards;
    }

    assert.strictEqual((await control(world, 'PUT', '/api/v1/databases/mongodb-9/forwards', {forwards: []})).status, 404);
    for (const wrong of [{}, {forwards: 'vps2'}, {forwards: [null]}, {forwards: [{to: 'vps2:27017'}]}]) {
        assert.strictEqual((await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', wrong)).status, 400, JSON.stringify(wrong));
    }
    const nowhere = await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', {forwards: [{to: {remote: 'phone', port: 27017}}]});
    assert.strictEqual(nowhere.status, 400);
    assert.match(nowhere.body.error, /phone/);
    assert.strictEqual(file(), undefined, 'nothing written for a list the config refuses');

    const brought = await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', {forwards: [{to: {remote: 'vps2', port: 27017}}]});
    assert.strictEqual(brought.status, 200, JSON.stringify(brought.body));
    assert.deepStrictEqual(file(), [{label: 'mongodb-1 → vps2', database: 'mongodb-1', from: {remote: 'laptop', port: 41337}, to: {remote: 'vps2', port: 27017}}]);
    assert.deepStrictEqual(brought.body.servers[0].forwards, [{label: 'mongodb-1 → vps2', from: {remote: 'laptop', port: 41337}, to: {remote: 'vps2', here: false, port: 27017, socket: null, host: null}, off: false, state: 'to_offline', problem: 'vps2 is offline', at: null, apps: [], tls: false, allow: [], address: null, firewall: null}]);

    // Copy URL: its user's URL as a program there reaches it, on its machine and through the
    // forward; nowhere it is not brought, and for the owner alone
    const orders = await control(world, 'POST', '/api/v1/databases/mongodb-1/databases', {name: 'orders'});
    assert.strictEqual(orders.status, 201, JSON.stringify(orders.body));
    const password = JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0].users.orders.password;
    const home = await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=orders&remote=laptop');
    assert.deepStrictEqual([home.status, home.body], [200, {url: `mongodb://orders:${password}@127.0.0.1:41337/orders`}]);
    const there = await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=orders&remote=vps2');
    assert.deepStrictEqual([there.status, there.body], [200, {url: `mongodb://orders:${password}@127.0.0.1:27017/orders`}]);
    const unknown = await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=sales&remote=vps2');
    assert.deepStrictEqual([unknown.status, unknown.body.error], [409, 'mongodb-1 has no database sales made by serviceman']);
    assert.strictEqual((await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=orders&remote=phone')).status, 404);
    assert.strictEqual((await control(world, 'GET', '/api/v1/databases/mongodb-9/url?database=orders&remote=vps2')).status, 404);
    // A program on vps2 that picked it finds it at the forward's port, and the forward names it
    const shop = await control(world, 'POST', '/api/v1/services', {service: {name: 'shop', type: 'shell', remotes: ['vps2'], command: 'bin/run', publish: {host: 'shop.localhost', port: 3000}, databases: [{server: 'mongodb-1', database: 'orders', env: 'MONGODB_URL'}]}});
    assert.strictEqual(shop.status, 200, JSON.stringify(shop.body));
    // A container there that picked it does not find it there, and is not named
    const boxed = await control(world, 'POST', '/api/v1/services', {service: {name: 'shop-box', type: 'docker', remotes: ['vps2'], image: 'docker.io/library/mongo:8.0', publish: {host: 'shop-box.localhost', port: 3000}, databases: [{server: 'mongodb-1', database: 'orders', env: 'MONGODB_URL'}]}});
    assert.strictEqual(boxed.status, 200, JSON.stringify(boxed.body));
    assert.deepStrictEqual((await control(world, 'GET', '/api/v1/databases')).body.servers[0].forwards[0].apps, ['shop']);
    const service = world.app.services.find(v => v.name === 'shop');
    assert.deepStrictEqual(database_env(world.app, {name: 'vps2'}, service, false), {MONGODB_URL: there.body.url});
    assert.throws(() => database_env(world.app, {name: 'vps2'}, service, true), /mongodb-1 is on laptop, its port brought to vps2's 127\.0\.0\.1, which a container does not reach/);

    // Docker picked another port at a start: read again, kept, and the forward follows it
    engine.host_port = 41338;
    world.app.database_lists.clear();
    const moved = await control(world, 'GET', '/api/v1/databases');
    assert.strictEqual(moved.status, 200);
    assert.deepStrictEqual(file()[0].from, {remote: 'laptop', port: 41338});
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0].port, 41338);

    // A second place: the first keeps its label, the new one gets a number
    const two = await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', {forwards: [{to: {remote: 'vps2', port: 27017}}, {to: {remote: 'vps2', port: 27018}}]});
    assert.strictEqual(two.status, 200, JSON.stringify(two.body));
    assert.deepStrictEqual(file().map(v => `${v.label} ${v.from.port} ${v.to.port}`), ['mongodb-1 → vps2 41338 27017', 'mongodb-1 → vps2 2 41338 27018']);

    // A token with the forwards right: the server's are the owner's
    const minted = await control(world, 'POST', '/api/v1/tokens', {label: 'visual-agency', remotes: ['laptop', 'vps2'], rights: ['forwards']});
    assert.strictEqual(minted.status, 200, JSON.stringify(minted.body));
    const listed = await control(world, 'GET', '/api/v1/forwards', undefined, minted.body.token);
    assert.deepStrictEqual(listed.body.forwards, []);
    const tying = await control(world, 'PUT', '/api/v1/forwards', {forwards: [{label: 'mine', database: 'mongodb-1', from: {remote: 'laptop', port: 41338}, to: {remote: 'vps2', port: 27019}}]}, minted.body.token);
    assert.strictEqual(tying.status, 403);
    assert.match(tying.body.error, /may not hold a forward that is part of a database server/);
    const asked = await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=orders&remote=vps2', undefined, minted.body.token);
    assert.strictEqual(asked.status, 403, 'a URL with its password is the owner\'s alone');
    assert.strictEqual(JSON.stringify(asked.body).includes(password), false);

    const removed = await control(world, 'DELETE', '/api/v1/databases/mongodb-1');
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    assert.deepStrictEqual(removed.body.forwards_removed, ['mongodb-1 → vps2', 'mongodb-1 → vps2 2']);
    assert.strictEqual(file(), undefined);
});

// A MongoDB's public port: on every address of its own machine, the agent joining it to the
// server's port; TLS on by default with a certificate of its own authority's, whose file the page
// hands out; who may connect as the machine's ufw rules, written and taken out with it; Copy URL
// at the machine's public address. Never another engine's, never on another machine.
test('a MongoDB\'s public port listens on every address, with TLS a setting and its firewall told', async function (t) {
    const world = await world_start(t);
    const made = await control(world, 'POST', '/api/v1/databases', {name: 'mongodb-1', engine: 'mongodb', version: '8.0', remote: 'laptop'});
    assert.strictEqual(made.status, 202, JSON.stringify(made.body));
    await view_until(world, v => (v.servers[0].phase === 'up'));
    assert.strictEqual((await control(world, 'POST', '/api/v1/databases/mongodb-1/databases', {name: 'orders'})).status, 201);
    const laptop = world.app.remote_by_name.laptop;
    const port = await port_free();
    function file() {
        return JSON.parse(fs.readFileSync(world.config_path, 'utf8')).forwards;
    }
    function rules() {
        return fs.existsSync(world.ufw_state) ? fs.readFileSync(world.ufw_state, 'utf8').split('\n').filter(v => v !== '') : [];
    }
    function told() {
        return forwards_tell.forwards_of(world.app, laptop).find(v => v.name === 'mongodb-1 → the internet');
    }

    const socket = await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', {forwards: [{to: {remote: 'laptop', socket: '~/mongo.sock', host: '0.0.0.0'}}]});
    assert.deepStrictEqual([socket.status, socket.body.error], [400, 'forwards[0].to: a public port is a port on its server\'s own machine, laptop']);

    const opened = await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', {forwards: [{to: {remote: 'laptop', port, host: '0.0.0.0'}, tls: true, allow: []}]});
    assert.strictEqual(opened.status, 200, JSON.stringify(opened.body));
    assert.deepStrictEqual(file(), [{label: 'mongodb-1 → the internet', database: 'mongodb-1', from: {remote: 'laptop', port: 41337}, to: {remote: 'laptop', port, host: '0.0.0.0'}, tls: true}]);
    const line = opened.body.servers[0].forwards[0];
    assert.deepStrictEqual([line.to.host, line.tls, line.allow, line.apps, line.firewall], ['0.0.0.0', true, [], [], `its firewall lets port ${port} in from anywhere`]);
    assert.deepStrictEqual(rules(), [`ufw allow proto tcp from any to any port ${port} comment 'serviceman:mongodb-1:public'`]);
    assert.deepStrictEqual([told().host, told().allow, Object.keys(told().tls)], ['0.0.0.0', undefined, ['cert', 'key']]);
    await view_until(world, v => (v.servers[0].forwards[0].state === 'ready'));
    assert.strictEqual((await control(world, 'GET', '/api/v1/databases')).body.servers[0].forwards[0].at, `0.0.0.0:${port}`);

    // The authority's file, and a TLS handshake the agent answers, checked against it
    const certificate = await fetch_host({port: world.control_port, host: '127.0.0.1', path: '/api/v1/databases/mongodb-1/certificate', method: 'GET', headers: {}});
    assert.strictEqual(certificate.status, 200);
    assert.match(certificate.headers['content-disposition'], /filename="mongodb-1-ca\.pem"/);
    const kept = JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0];
    assert.strictEqual(certificate.body, kept.tls.ca);
    assert.strictEqual(told().tls.cert.startsWith(kept.tls.cert.split('-----END CERTIFICATE-----')[0]), true);
    const authorized = await new Promise(function (resolve, reject) {
        const client = tls.connect({host: '127.0.0.1', port, ca: kept.tls.ca, checkServerIdentity: () => undefined}, function () {
            resolve(client.authorized);
            client.destroy();
        });
        client.on('error', reject);
    });
    assert.strictEqual(authorized, true);

    // Copy URL from anywhere: at the machine's public address, once one is known
    const unknown = await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=orders&public=1');
    assert.deepStrictEqual([unknown.status, unknown.body.error], [409, 'laptop has no public address serviceman knows: its agent says none, and it dials in from a private one']);
    laptop.state.resources.addresses = ['10.0.0.5', '100.64.0.20', '203.0.113.5'];
    const anywhere = await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=orders&public=1');
    assert.deepStrictEqual([anywhere.status, anywhere.body], [200, {url: `mongodb://orders:${kept.users.orders.password}@203.0.113.5:${port}/orders?tls=true&tlsCAFile=mongodb-1-ca.pem`}]);

    // Who may connect, TLS off: the rules follow, the agent is told the list and no certificate
    const listed = await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', {forwards: [{to: {remote: 'laptop', port, host: '0.0.0.0'}, tls: false, allow: ['198.51.100.7', '10.0.0.0/8']}]});
    assert.strictEqual(listed.status, 200, JSON.stringify(listed.body));
    assert.deepStrictEqual(rules(), [`ufw allow proto tcp from 198.51.100.7 to any port ${port} comment 'serviceman:mongodb-1:public'`, `ufw allow proto tcp from 10.0.0.0/8 to any port ${port} comment 'serviceman:mongodb-1:public'`]);
    assert.deepStrictEqual([told().allow, told().tls], [['198.51.100.7', '10.0.0.0/8'], undefined]);
    assert.strictEqual(listed.body.servers[0].forwards[0].firewall, `its firewall lets port ${port} in from 198.51.100.7, 10.0.0.0/8 alone`);
    const plain = await control(world, 'GET', '/api/v1/databases/mongodb-1/url?database=orders&public=1');
    assert.strictEqual(plain.body.url, `mongodb://orders:${kept.users.orders.password}@203.0.113.5:${port}/orders`);

    // Closed: its rules go with it
    const closed = await control(world, 'PUT', '/api/v1/databases/mongodb-1/forwards', {forwards: []});
    assert.strictEqual(closed.status, 200, JSON.stringify(closed.body));
    assert.deepStrictEqual([file(), rules()], [undefined, []]);

    // Another engine has none
    assert.strictEqual((await control(world, 'POST', '/api/v1/databases', {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop'})).status, 202);
    await view_until(world, v => v.servers.every(vv => vv.phase === 'up'));
    const mysql = await control(world, 'PUT', '/api/v1/databases/mysql-1/forwards', {forwards: [{to: {remote: 'laptop', port, host: '0.0.0.0'}}]});
    assert.deepStrictEqual([mysql.status, mysql.body.error], [400, 'a public port is a MongoDB\'s: mysql-1 is mysql']);
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

// A server serviceman was bringing up when it restarted is failed, and its page's Bring it up
// again brings it up where it was: its file still says starting, and nothing is on its way
test('a server left coming up by a restart is failed, and it can be brought up again', async function (t) {
    const world = await world_start(t);
    const kept = {servers: [{name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', sample: 'tiny', root: 'a'.repeat(32), users: {}, phase: 'starting', said: 'making its container', error: null, port: null, made: '2026-11-19T00:00:00.000Z'}]};
    fs.writeFileSync(path.join(world.state_dir, 'databases.json'), JSON.stringify(kept), {mode: 0o600});
    const failed = await view_until(world, v => (v.servers.length === 1));
    assert.strictEqual(failed.servers[0].phase, 'failed');
    assert.strictEqual(failed.servers[0].error, 'serviceman restarted while it came up; bring it up again');
    assert.strictEqual(failed.servers[0].sample, 'tiny', 'what bringing it up again asks for');
    world.sample_bytes = Buffer.from(SAMPLE_SQL);
    const again = await control(world, 'POST', '/api/v1/databases', {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', sample: 'tiny'});
    assert.strictEqual(again.status, 202);
    const up = await view_until(world, v => (v.servers[0].phase === 'up'));
    assert.deepStrictEqual(up.servers[0].databases.map(v => v.name), ['tiny']);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(world.state_dir, 'databases.json'), 'utf8')).servers[0].root, 'a'.repeat(32), 'the password its data was made with');
    const twice = await control(world, 'POST', '/api/v1/databases', {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', sample: 'tiny'});
    assert.strictEqual(twice.status, 409, 'one that is up is not brought up over');
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

// `others` are machines of the config beside the laptop, with no agent: offline
async function world_start(t, others)
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
        remotes: [{name: 'laptop', token: TOKEN}].concat((others || []).map((v, i) => ({name: v, token: `token-of-${v}-${i}-0123456789abcdef`}))),
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
    // ufw is a stand-in that keeps its rules in a file: a public port's firewall rules are written
    // there, never to the machine's own
    out.ufw_state = path.join(dir, 'ufw.rules');
    const env = Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(dir, 'agent'), SERVICEMAN_LOG_TIME: 'off', DOCKER_HOST: `unix://${path.join(dir, 'docker.sock')}`, SERVICEMAN_UFW: `${process.execPath} ${path.join(__dirname, 'fake_ufw.js')}`, FAKE_UFW_STATE: out.ufw_state});
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
    const laptop = app.remote_by_name.laptop;
    await wait_until(() => (laptop.state.phase === 'online') && (laptop.state.resources !== null) && (laptop.state.resources.docker !== null), 15000);
    return out;
}

async function control(world, method, path_asked, value, token)
{
    // With its length, as a browser sends it: node sends a DELETE's body with none
    const body = (value === undefined) ? undefined : JSON.stringify(value);
    const headers = (body === undefined) ? {} : {'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body))};
    if (token !== undefined) {
        headers.authorization = `Bearer ${token}`;
    }
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

// A port nobody listens on now
function port_free()
{
    return new Promise(function (resolve) {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', function () {
            const port = probe.address().port;
            probe.close(() => resolve(port));
        });
    });
}
