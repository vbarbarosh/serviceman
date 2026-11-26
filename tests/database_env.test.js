const adminer_login_put = require('../src/main/src/helpers/adminer_login_put');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const database_env = require('../src/main/src/helpers/database_env');
const databases_write = require('../src/main/src/helpers/databases_write');
const folder_env = require('../src/main/src/helpers/folder_env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const program_docker_argv = require('../src/helpers/program_docker_argv');
const test = require('node:test');

const BASE = {listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'laptop', token: 'token-of-the-laptop-0123456789'}]};
const ADMINER = {name: 'adminer', type: 'docker', remotes: ['laptop'], image: 'adminer', publish: {host: 'adminer.localhost', port: 8080}};

function service_of(databases)
{
    return config_from_json(Object.assign({}, BASE, {services: [Object.assign({}, ADMINER, {databases})]}), os.tmpdir()).services[0];
}

// The databases an app picked, as its config keeps them: a server, a database, the variable
test('a service\'s databases are read from the config, DATABASE_URL unless named; a wrong one is refused', function () {
    assert.deepStrictEqual(service_of(undefined).databases, []);
    assert.deepStrictEqual(service_of([{server: 'mysql-1', database: 'sakila'}]).databases, [{server: 'mysql-1', database: 'sakila', env: 'DATABASE_URL'}]);
    assert.deepStrictEqual(service_of([{server: 'mysql-1', database: 'Chinook', env: 'DB_URL'}]).databases, [{server: 'mysql-1', database: 'Chinook', env: 'DB_URL'}]);
    assert.throws(() => service_of('sakila'), /databases: a list of/);
    assert.throws(() => service_of([{server: 'mysql-1'}]), /databases\[0\]: a server of the Databases page/);
    assert.throws(() => service_of([{server: 'My SQL', database: 'sakila'}]), /databases\[0\]/);
    assert.throws(() => service_of([{server: 'mysql-1', database: 'a', env: 'my url'}]), /databases\[0\]\.env: a variable's name/);
    assert.throws(() => service_of([{server: 'mysql-1', database: 'a'}, {server: 'mysql-1', database: 'b'}]), /databases\[1\]\.env: DATABASE_URL is filled by another database/);
});

// What the app finds at its start: its own user's URL, by the server's name in a container, on
// 127.0.0.1 at its port on the machine; a pick that cannot be reached stops the start, saying why
test('a picked database is its own user\'s URL, by name in a container, by port on the machine', function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'database-env-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const app = {state_dir: dir, config: {forwards: []}};
    databases_write(app, {servers: [
        {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', root: 'r'.repeat(32), users: {sakila: {user: 'sakila', password: 'p'.repeat(24)}}, phase: 'up', port: 41337},
        {name: 'mysql-2', engine: 'mysql', version: '8.0', remote: 'vps1', root: 'r'.repeat(32), users: {world: {user: 'world', password: 'w'.repeat(24)}}, phase: 'up', port: 41338},
        {name: 'mysql-3', engine: 'mysql', version: '8.4', remote: 'laptop', root: 'r'.repeat(32), users: {}, phase: 'failed', port: null},
        {name: 'mongodb-1', engine: 'mongodb', version: '8.0', remote: 'laptop', root: 'r'.repeat(32), users: {orders: {user: 'orders', password: 'o'.repeat(24)}}, phase: 'up', port: 41339},
    ]});
    const laptop = {name: 'laptop'};
    const picked = {name: 'adminer', databases: [{server: 'mysql-1', database: 'sakila', env: 'DATABASE_URL'}]};
    assert.deepStrictEqual(database_env(app, laptop, picked, true), {DATABASE_URL: `mysql://sakila:${'p'.repeat(24)}@serviceman-db-mysql-1:3306/sakila`});
    assert.deepStrictEqual(database_env(app, laptop, picked, false), {DATABASE_URL: `mysql://sakila:${'p'.repeat(24)}@127.0.0.1:41337/sakila`});
    const orders = {name: 'shop', databases: [{server: 'mongodb-1', database: 'orders', env: 'MONGODB_URL'}]};
    assert.deepStrictEqual(database_env(app, laptop, orders, true), {MONGODB_URL: `mongodb://orders:${'o'.repeat(24)}@serviceman-db-mongodb-1:27017/orders`});
    assert.deepStrictEqual(database_env(app, laptop, orders, false), {MONGODB_URL: `mongodb://orders:${'o'.repeat(24)}@127.0.0.1:41339/orders`});
    assert.deepStrictEqual(database_env(app, laptop, {name: 'web', databases: []}, true), {});
    assert.deepStrictEqual(database_env(app, laptop, {name: 'page'}, true), {}, 'a service of a kind with no databases');
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-2', database: 'world', env: 'DATABASE_URL'}]}, true), /mysql-2 is on vps1, and its port is not brought to laptop: bring it there on its page in Databases/);
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-9', database: 'x', env: 'DATABASE_URL'}]}, true), /no database server is called mysql-9 now/);
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-3', database: 'x', env: 'DATABASE_URL'}]}, true), /mysql-3 is not up/);
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-1', database: 'shop', env: 'DATABASE_URL'}]}, true), /mysql-1 has no database shop made by serviceman/);
});

// A server on another machine is reached by a program there at the port its forward listens on:
// the first that listens on a port, one set aside only when no other does; a container there
// has a 127.0.0.1 of its own, and its start stops saying so
test('a database of another machine is reached through its forward, by a program there alone', function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'database-env-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    function forward(label, to, off) {
        return {label, database: 'mongodb-1', from: {remote: 'vps1', here: false, port: 41339, socket: null}, to: Object.assign({here: false, port: null, socket: null}, to), off, service: null};
    }
    const app = {state_dir: dir, config: {forwards: [
        forward('mongodb-1 → laptop', {remote: 'laptop', socket: '~/mongo.sock'}, false),
        forward('mongodb-1 → vps2', {remote: 'vps2', port: 27017}, true),
        forward('mongodb-1 → vps2 2', {remote: 'vps2', port: 27018}, false),
        forward('mongodb-1 → desktop', {remote: 'desktop', port: 27017}, true),
        {label: 'loki', database: null, from: {remote: 'vps1', here: false, port: 3100, socket: null}, to: {remote: 'phone', here: false, port: 27017, socket: null}, off: false, service: null},
    ]}};
    const password = 'o'.repeat(24);
    databases_write(app, {servers: [
        {name: 'mongodb-1', engine: 'mongodb', version: '8.0', remote: 'vps1', root: 'r'.repeat(32), users: {orders: {user: 'orders', password}}, phase: 'up', port: 41339},
    ]});
    const shop = {name: 'shop', databases: [{server: 'mongodb-1', database: 'orders', env: 'MONGODB_URL'}]};
    assert.deepStrictEqual(database_env(app, {name: 'vps2'}, shop, false), {MONGODB_URL: `mongodb://orders:${password}@127.0.0.1:27018/orders`});
    assert.deepStrictEqual(database_env(app, {name: 'vps1'}, shop, false), {MONGODB_URL: `mongodb://orders:${password}@127.0.0.1:41339/orders`});
    assert.throws(() => database_env(app, {name: 'vps2'}, shop, true), /mongodb-1 is on vps1, its port brought to vps2's 127\.0\.0\.1, which a container does not reach: a program or an app folder there does/);
    assert.throws(() => database_env(app, {name: 'desktop'}, shop, false), /mongodb-1 is on vps1, and its forward to desktop is set aside: turn it on in Forwards/);
    assert.throws(() => database_env(app, {name: 'laptop'}, shop, false), /mongodb-1 is on vps1, and its port is not brought to laptop/, 'a socket file is no port');
    assert.throws(() => database_env(app, {name: 'phone'}, shop, false), /its port is not brought to phone/, 'a forward of something else');
});

// The folders an app picked, as its config keeps them: kept for it, or a full path of its machine
// that is none of the system's own; a variable a database of it fills is refused
test('a service\'s folders are read from the config, FILES_DIR unless named; a wrong one is refused', function () {
    function folders_of(folders, databases) {
        return config_from_json(Object.assign({}, BASE, {services: [Object.assign({}, ADMINER, {folders, databases})]}), os.tmpdir()).services[0].folders;
    }
    assert.deepStrictEqual(folders_of(undefined), []);
    assert.deepStrictEqual(folders_of([{path: null}]), [{path: null, env: 'FILES_DIR'}]);
    assert.deepStrictEqual(folders_of([{path: '/srv/photos', env: 'PHOTOS'}, {}]), [{path: '/srv/photos', env: 'PHOTOS'}, {path: null, env: 'FILES_DIR'}]);
    for (const where of ['/etc', '/etc/x', '/', '/usr/local/x', '/var/lib/serviceman/data', 'srv/photos', '/srv/a/', '/srv/../etc']) {
        assert.throws(() => folders_of([{path: where}]), /folders\[0\]\.path: /, where);
    }
    assert.throws(() => folders_of([{path: null}, {path: null}]), /folders\[1\]\.env: FILES_DIR is filled by another/);
    assert.throws(() => folders_of([{path: null, env: 'DATABASE_URL'}], [{server: 'mysql-1', database: 'a'}]), /folders\[0\]\.env: DATABASE_URL is filled by another/);
});

// At its start: mounted in a container, /data/files then /data/files-2, the kept one the
// agent's; on the machine, each its own path, the kept one made in the agent's data/ now
test('a picked folder is mounted in a container, and its own path on the machine', async function () {
    const service = {name: 'files', folders: [{path: null, env: 'FILES_DIR'}, {path: '/srv/photos', env: 'PHOTOS'}]};
    const inside = await folder_env({}, {name: 'laptop'}, service, true);
    assert.deepStrictEqual(inside.env, {FILES_DIR: '/data/files', PHOTOS: '/data/files-2'});
    assert.deepStrictEqual(inside.volumes, [
        {kind: 'kept', source: '', keep: 'files/files', target: '/data/files', readonly: false, create: true},
        {kind: 'path', source: '/srv/photos', target: '/data/files-2', readonly: false, create: true},
    ]);
    const made = [];
    const app = {};
    const remote = {name: 'laptop', state: {phase: 'online', resources: {dir: '/home/user/serviceman-agent'}}};
    const outside = await folder_env_with(app, remote, service, made);
    assert.deepStrictEqual(outside.env, {FILES_DIR: '/home/user/serviceman-agent/data/files/files', PHOTOS: '/srv/photos'});
    assert.deepStrictEqual(made, ['/home/user/serviceman-agent/data/files/files', '/srv/photos']);
    assert.deepStrictEqual(await folder_env({}, remote, {name: 'web'}, false), {env: {}, volumes: []}, 'a service with no folders');
});

// folder_env on the machine, its agent's dir_create caught here
async function folder_env_with(app, remote, service, made)
{
    const remote_call_path = require.resolve('../src/main/src/helpers/remote_call');
    const folder_env_path = require.resolve('../src/main/src/helpers/folder_env');
    const kept = require.cache[remote_call_path];
    require.cache[remote_call_path] = {id: remote_call_path, filename: remote_call_path, loaded: true, exports: async function (app_, remote_, method, params) {
        made.push(params.path);
        return {created: true};
    }};
    delete require.cache[folder_env_path];
    try {
        return await require(folder_env_path)(app, remote, service, false);
    }
    finally {
        require.cache[remote_call_path] = kept;
        delete require.cache[folder_env_path];
    }
}

// A program in an image that picked a database is made on the databases' network, by an agent
// that can; one that picked none is made as before
test('a program\'s container is made on the network it is given, and on none unless given', function () {
    const params = {container: 'serviceman-admin', service: 'admin', spec: 'abc', dir: '/home/user/x', image: 'serviceman-php:8.4', command: 'bin/run', env: {}, port: 8080};
    const on = program_docker_argv(Object.assign({}, params, {network: 'serviceman-databases'}));
    assert.strictEqual(on[on.indexOf('--network') + 1], 'serviceman-databases');
    assert.ok(on.indexOf('--network') < on.indexOf('serviceman-php:8.4'), 'before the image');
    assert.strictEqual(program_docker_argv(params).includes('--network'), false);
    assert.strictEqual(program_docker_argv(Object.assign({}, params, {network: null})).includes('--network'), false);
});

// Only Adminer's own image is given the login; anything else is left as it is, with nothing asked
// of its machine
test('the login goes into Adminer\'s image alone', async function () {
    for (const image of ['nginx', 'myadminer', 'adminer-dark', 'adminer/x:1']) {
        assert.strictEqual(await adminer_login_put(null, null, image, 'serviceman-x'), false, image);
    }
});

// A CouchDB is given as its admin, with no database in its URL, and its secret beside it, named
// after the URL's variable
test('a picked CouchDB is its admin\'s URL and the secret it trusts a signed user name by', function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'database-env-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const app = {state_dir: dir};
    const root = 'r'.repeat(32);
    const secret = 's'.repeat(64);
    databases_write(app, {servers: [
        {name: 'couch-1', engine: 'couchdb', version: '3', remote: 'laptop', root, secret, users: {admin: {user: 'admin', password: root}}, phase: 'up', port: 41339},
    ]});
    const laptop = {name: 'laptop'};
    const wall = {name: 'authwall', databases: [{server: 'couch-1', database: 'admin', env: 'COUCHDB_URL'}]};
    assert.deepStrictEqual(database_env(app, laptop, wall, true), {COUCHDB_URL: `http://admin:${root}@serviceman-db-couch-1:5984`, COUCHDB_SECRET: secret});
    assert.deepStrictEqual(database_env(app, laptop, wall, false), {COUCHDB_URL: `http://admin:${root}@127.0.0.1:41339`, COUCHDB_SECRET: secret});
    assert.strictEqual(database_env.secret_env('COUCHDB_URL_2'), 'COUCHDB_SECRET_2');
    assert.strictEqual(database_env.secret_env('STORE'), 'STORE_SECRET');
    assert.strictEqual(database_env.secret_env('DATABASE_URL'), 'DATABASE_SECRET');
});
