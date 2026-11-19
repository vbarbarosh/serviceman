const adminer_login_put = require('../src/main/src/helpers/adminer_login_put');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const database_env = require('../src/main/src/helpers/database_env');
const databases_write = require('../src/main/src/helpers/databases_write');
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
    const app = {state_dir: dir};
    databases_write(app, {servers: [
        {name: 'mysql-1', engine: 'mysql', version: '8.4', remote: 'laptop', root: 'r'.repeat(32), users: {sakila: {user: 'sakila', password: 'p'.repeat(24)}}, phase: 'up', port: 41337},
        {name: 'mysql-2', engine: 'mysql', version: '8.0', remote: 'vps1', root: 'r'.repeat(32), users: {world: {user: 'world', password: 'w'.repeat(24)}}, phase: 'up', port: 41338},
        {name: 'mysql-3', engine: 'mysql', version: '8.4', remote: 'laptop', root: 'r'.repeat(32), users: {}, phase: 'failed', port: null},
    ]});
    const laptop = {name: 'laptop'};
    const picked = {name: 'adminer', databases: [{server: 'mysql-1', database: 'sakila', env: 'DATABASE_URL'}]};
    assert.deepStrictEqual(database_env(app, laptop, picked, true), {DATABASE_URL: `mysql://sakila:${'p'.repeat(24)}@serviceman-db-mysql-1:3306/sakila`});
    assert.deepStrictEqual(database_env(app, laptop, picked, false), {DATABASE_URL: `mysql://sakila:${'p'.repeat(24)}@127.0.0.1:41337/sakila`});
    assert.deepStrictEqual(database_env(app, laptop, {name: 'web', databases: []}, true), {});
    assert.deepStrictEqual(database_env(app, laptop, {name: 'page'}, true), {}, 'a service of a kind with no databases');
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-2', database: 'world', env: 'DATABASE_URL'}]}, true), /mysql-2 is on vps1, and adminer runs on laptop/);
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-9', database: 'x', env: 'DATABASE_URL'}]}, true), /no database server is called mysql-9 now/);
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-3', database: 'x', env: 'DATABASE_URL'}]}, true), /mysql-3 is not up/);
    assert.throws(() => database_env(app, laptop, {name: 'adminer', databases: [{server: 'mysql-1', database: 'shop', env: 'DATABASE_URL'}]}, true), /mysql-1 has no database shop made by serviceman/);
});

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
