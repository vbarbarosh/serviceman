const fs = require('fs');
const http = require('http');

// A docker engine for the databases tests, on a socket of its own: the parts of the API a
// database server is brought up with (an image, a network, a container made, started, inspected
// and removed, a volume), files put into a container, and commands run in it. Its MySQL is a
// make-believe, MySQL's or PostgreSQL's: a ping answers once the container runs, and SQL run as a
// file makes the databases its CREATE lines name, drops those its DROP lines name, and answers
// the list of them; every SQL run is kept, in `sql`. Its MongoDB the same, a mongosh script
// making the databases its createUser lines are made in, and the data browser's answered. Every request is kept, with its
// body, for the test to read what went where.
async function fake_database_engine(socket)
{
    const engine = {images: new Set(), networks: new Set(), volumes: new Set(), containers: new Map(), execs: new Map(), requests: [], fail_ping: false, fail_build: false, sql: [], next: 1, host_port: 41337};
    const server = http.createServer(function (req, res) {
        const chunks = [];
        req.on('data', v => chunks.push(v));
        req.on('end', function () {
            const body = Buffer.concat(chunks);
            engine.requests.push({method: req.method, url: req.url, body: body.toString('latin1')});
            route(engine, req, res, body);
        });
    });
    fs.rmSync(socket, {force: true});
    await new Promise(v => server.listen(socket, v));
    return {
        engine,
        close: () => new Promise(v => server.close(v)),
    };
}

function route(engine, req, res, body)
{
    const url = new URL(req.url, 'http://docker');
    const parts = url.pathname.replace(/^\/v[0-9.]+/, '').split('/').filter(v => v !== '').map(decodeURIComponent);
    if ((parts[0] === 'images') && (parts[2] === 'json')) {
        return engine.images.has(parts[1]) ? json(res, 200, {Id: parts[1]}) : json(res, 404, {message: 'no such image'});
    }
    if ((parts[0] === 'images') && (parts[1] === 'create')) {
        engine.images.add(`${url.searchParams.get('fromImage')}:${url.searchParams.get('tag')}`);
        return text(res, 200, '{"status":"Pulling"}\n{"status":"Downloaded"}\n');
    }
    // A build says how it went line by line, a failure as its last, with an answer of 200 all the same
    if (parts[0] === 'build') {
        if (engine.fail_build) {
            return text(res, 200, '{"stream":"Step 1/3"}\n{"error":"no space left on device"}\n');
        }
        engine.images.add(url.searchParams.get('t'));
        return text(res, 200, '{"stream":"Step 1/3"}\n{"stream":"Successfully built"}\n');
    }
    if ((parts[0] === 'networks') && (parts[1] === 'create')) {
        engine.networks.add(JSON.parse(body).Name);
        return json(res, 201, {Id: 'net'});
    }
    if (parts[0] === 'networks') {
        return engine.networks.has(parts[1]) ? json(res, 200, {Name: parts[1]}) : json(res, 404, {message: 'no such network'});
    }
    if ((parts[0] === 'volumes') && (req.method === 'DELETE')) {
        return engine.volumes.delete(parts[1]) ? text(res, 204, '') : json(res, 404, {message: 'no such volume'});
    }
    if ((parts[0] === 'containers') && (parts[1] === 'create')) {
        const spec = JSON.parse(body);
        const name = url.searchParams.get('name');
        engine.containers.set(name, {name, spec, running: false, files: {}, databases: new Set()});
        engine.volumes.add(spec.HostConfig.Binds[0].split(':')[0]);
        return json(res, 201, {Id: name});
    }
    if (parts[0] === 'containers') {
        return container_route(engine, req, res, body, url, parts);
    }
    if (parts[0] === 'exec') {
        return exec_route(engine, req, res, parts);
    }
    return json(res, 404, {message: `the fake engine knows nothing of ${req.method} ${url.pathname}`});
}

function container_route(engine, req, res, body, url, parts)
{
    const container = engine.containers.get(parts[1]);
    if (container === undefined) {
        return json(res, 404, {message: `no such container: ${parts[1]}`});
    }
    if (req.method === 'DELETE') {
        engine.containers.delete(parts[1]);
        return text(res, 204, '');
    }
    if (parts[2] === 'json') {
        // The port docker picked on the machine's loopback, which a test may move, as a start does
        const port = [{HostIp: '127.0.0.1', HostPort: String(engine.host_port)}];
        return json(res, 200, {State: {Running: container.running}, NetworkSettings: {Ports: {'3306/tcp': port, '5432/tcp': port, '5984/tcp': port, '27017/tcp': port}}});
    }
    if (parts[2] === 'start') {
        container.running = true;
        return text(res, 204, '');
    }
    if (parts[2] === 'logs') {
        return text(res, 200, 'ready for connections\n');
    }
    if (parts[2] === 'archive') {
        for (const [name, bytes] of Object.entries(tar_files(body))) {
            container.files[`${url.searchParams.get('path')}/${name}`] = bytes;
        }
        return text(res, 200, '');
    }
    if (parts[2] === 'exec') {
        const id = `exec${engine.next++}`;
        engine.execs.set(id, {container: container.name, spec: JSON.parse(body)});
        return json(res, 201, {Id: id});
    }
    return json(res, 404, {message: 'not in the fake engine'});
}

// What each command does in the make-believe MySQL
function exec_route(engine, req, res, parts)
{
    const exec = engine.execs.get(parts[1]);
    if (parts[2] === 'json') {
        return json(res, 200, {ExitCode: exec.code});
    }
    const container = engine.containers.get(exec.container);
    const cmd = exec.spec.Cmd;
    let printed = '';
    exec.code = 0;
    if ((cmd[0] === 'mysqladmin') || (cmd[0] === 'pg_isready') || (cmd[0] === 'curl') || (cmd[0] === 'mongosh')) {
        exec.code = engine.fail_ping ? 1 : 0;
    }
    // A CouchDB's databases, as its admin asks them: its own and the app's, by name
    else if ((cmd[0] === 'sh') && cmd[2].includes('/_dbs_info')) {
        printed = JSON.stringify(['_replicator', '_users', ...container.databases].sort().map(v => ({key: v, info: {sizes: {file: 16384}, doc_count: 1}})));
    }
    else if (cmd[0] === 'sh') {
        const file = cmd[cmd.length - 1];
        const sql = container.files[file].toString('utf8');
        delete container.files[file];
        engine.sql.push({container: container.name, cmd: cmd[2], sql});
        for (const found of sql.matchAll(/DROP DATABASE IF EXISTS [`"]?([A-Za-z0-9_]+)[`"]?/g)) {
            container.databases.delete(found[1]);
        }
        for (const found of sql.matchAll(/CREATE (?:DATABASE|SCHEMA)(?: IF NOT EXISTS)? [`"]?([A-Za-z0-9_]+)[`"]?/g)) {
            container.databases.add(found[1]);
        }
        for (const found of sql.matchAll(/getSiblingDB\('([a-z0-9_]+)'\)\.createUser\(/g)) {
            container.databases.add(found[1]);
        }
        // The data browser's script, as the database's own user: a collection, and a page of it
        if (sql.includes('serviceman-answer ')) {
            printed = `serviceman-answer ${JSON.stringify(browse_answer(sql))}\n`;
        }
        else if (sql.includes('listDatabases')) {
            printed = [...container.databases].sort().map(v => `${v}\t3\t8192\n`).join('');
        }
        else if (sql.includes('information_schema.schemata')) {
            printed = [...container.databases].sort().map(v => `${v}\t2\t16384\n`).join('');
        }
        else if (sql.includes('FROM pg_database')) {
            printed = [...container.databases].sort().map(v => `${v}\t16384\n`).join('');
        }
        else if (sql.includes("table_schema NOT IN ('pg_catalog'")) {
            printed = '2\n';
        }
    }
    res.writeHead(200, {'content-type': 'application/vnd.docker.raw-stream'});
    const data = Buffer.from(printed);
    const head = Buffer.alloc(8);
    head[0] = 1;
    head.writeUInt32BE(data.length, 4);
    res.end((data.length === 0) ? Buffer.alloc(0) : Buffer.concat([head, data]));
}

// What the data browser's script prints for its MongoDB: one collection of two documents, and a
// page of them that says back what it was asked
function browse_answer(sql)
{
    if (sql.includes('getCollectionInfos')) {
        return {ok: [{name: 'items', type: 'collection', count: 2, bytes: 191, storage_bytes: 4096, index_bytes: 4096, indexes: 1}]};
    }
    const ask = JSON.parse(/^const ask = (.*);$/m.exec(sql)[1]);
    return {ok: {items: [{_id: {$oid: '6b08111da665b663b25ba166'}, n: 5}], count: 1, took_ms: 3, cut: false, ask}};
}

// The files of a ustar archive, by name
function tar_files(tar)
{
    const out = {};
    let at = 0;
    while ((at + 512) <= tar.length) {
        const header = tar.subarray(at, at + 512);
        if (header.every(v => v === 0)) {
            break;
        }
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
        const size = parseInt(header.subarray(124, 136).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
        out[name] = tar.subarray(at + 512, at + 512 + size);
        at += 512 + Math.ceil(size/512)*512;
    }
    return out;
}

function json(res, status, value)
{
    text(res, status, JSON.stringify(value), 'application/json');
}

function text(res, status, value, type)
{
    res.writeHead(status, {'content-type': type || 'text/plain'});
    res.end(value);
}

module.exports = fake_database_engine;
