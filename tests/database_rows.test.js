const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const ENGINES = [{value: 'mysql', label: 'MySQL'}, {value: 'postgresql', label: 'PostgreSQL'}, {value: 'couchdb', label: 'CouchDB'}];

async function database_rows_of()
{
    return (await import(path.join(PUBLIC, 'database_rows.js'))).default;
}

function server_make(fields)
{
    return Object.assign({name: 'postgresql-1', engine: 'postgresql', version: '17', remote: 'laptop', title: 'laptop', online: true, phase: 'up', said: '', error: null, port: 41001, databases: []}, fields);
}

// The Databases table, a row a database: each with its server's engine, machine and state
test('a row per database, each with its engine, machine, size, apps and state', async function () {
    const database_rows = await database_rows_of();
    const databases = [{name: 'orders', tables: 4, bytes: 240*1024*1024, apps: ['grafana', 'shop'], user: 'orders'}, {name: 'notes', tables: 1, bytes: 2000, apps: [], user: 'notes'}];
    const rows = database_rows([server_make({databases})], ENGINES);
    assert.deepStrictEqual(rows.map(v => [v.key, v.name, v.engine, v.machine, v.size, v.apps.join(','), v.state, v.dot]), [
        ['postgresql-1/orders', 'orders', 'PostgreSQL 17', 'laptop', '240.0 MB', 'grafana,shop', 'running', 'running'],
        ['postgresql-1/notes', 'notes', 'PostgreSQL 17', 'laptop', '2 KB', '', 'running', 'running'],
    ]);
});

// A server with no database to show is a row of its own, so nothing brought up is out of sight
test('a server with no database, coming up, failed or away is a row of its own', async function () {
    const database_rows = await database_rows_of();
    const rows = database_rows([
        server_make({name: 'postgresql-1'}),
        server_make({name: 'mysql-1', engine: 'mysql', version: '8.4', phase: 'starting', said: 'pulling mysql:8.4'}),
        server_make({name: 'mysql-2', engine: 'mysql', version: '8.4', phase: 'failed', error: 'no space left on device'}),
        server_make({name: 'postgresql-2', online: false}),
    ], ENGINES);
    assert.deepStrictEqual(rows.map(v => [v.key, v.database, v.aside, v.state, v.bad, v.busy]), [
        ['postgresql-1/', '', 'no database in it yet', 'running', false, false],
        ['mysql-1/', '', 'a server', 'coming up', false, true],
        ['mysql-2/', '', 'a server', 'failed', true, false],
        ['postgresql-2/', '', 'a server', 'machine offline', true, false],
    ]);
    // What it says, in its Detail: what it is doing, why it failed, where its machine is
    assert.deepStrictEqual(rows.map(v => v.detail), ['', 'pulling mysql:8.4', 'no space left on device', 'laptop is offline: its databases show once it is back']);
});

// A CouchDB is one row, its admin, with how many users have a database in it
test('a CouchDB is its admin, with its users counted', async function () {
    const database_rows = await database_rows_of();
    const rows = database_rows([server_make({name: 'couchdb-1', engine: 'couchdb', version: '3', databases: [{name: 'admin', tables: 1, bytes: 9000, apps: ['authwall'], user: 'admin'}]})], ENGINES);
    assert.deepStrictEqual(rows.map(v => [v.name, v.aside, v.engine, v.apps.join(',')]), [['admin', '1 user', 'CouchDB 3', 'authwall']]);
});
