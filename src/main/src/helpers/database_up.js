const couchdb_ini = require('./couchdb_ini');
const database_engines = require('./database_engines');
const database_sample_files = require('./database_sample_files');
const database_samples = require('./database_samples');
const database_sql = require('./database_sql');
const database_user_make = require('./database_user_make');
const database_user_sql = require('./database_user_sql');
const databases_read = require('./databases_read');
const databases_write = require('./databases_write');
const docker_exec_connect = require('./docker_exec_connect');
const engine_call = require('./engine_call');
const engine_exec = require('./engine_exec');
const engine_files_put = require('./engine_files_put');
const engine_pull = require('./engine_pull');
const engine_said = require('./engine_said');
const log_event = require('./log_event');

// The network every database server is on, and an app container that uses one joins: there it
// reaches the server by its container's name
const NETWORK = 'serviceman-databases';
// How long a server has to answer once started: its first start makes its data folder
const READY_TIMEOUT_MS = 300000;
const READY_EVERY_MS = 2000;
// What a server that stopped said last, in its reason
const LOG_LINES = 12;
// What answers once each engine's real server is up, over TCP: its first start runs one of its
// own without TCP while it makes its data folder
const READY = {
    mysql: ['mysqladmin', 'ping', '--protocol=TCP', '-h127.0.0.1', '-uroot', '--silent'],
    postgresql: ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-q'],
    couchdb: ['curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:5984/_up'],
};
// Where a CouchDB reads the settings serviceman lays in, before it starts
const COUCHDB_LOCAL = '/opt/couchdb/etc/local.d';

// Brings a database server up on its machine, saying each step in its `said`: the image
// pulled, the network and the volume made, the container made and started, then filled with
// its sample, whose database gets a user of its own. The container restarts with the machine's
// docker, on its own: a restart of serviceman or of the agent touches nothing of it. A step
// that fails leaves the server failed, with the reason; it may be brought up again.
async function database_up(app, name)
{
    const begun = Date.now();
    const server = server_of(app, name);
    log_event(app, 'database_up_begin', {database: name, engine: server.engine, version: server.version, remote: server.remote, sample: server.sample || null});
    try {
        const remote = app.remote_by_name[server.remote];
        if ((remote === undefined) || (remote.state.phase !== 'online')) {
            throw new Error(`${server.remote} is not online`);
        }
        const connect = docker_exec_connect(app, remote);
        const engine = database_engines.find(v => v.value === server.engine);
        const image = engine.versions[server.version];
        said_set(app, name, `pulling ${image.replace(/^docker\.io\/library\//, '')}`);
        await engine_pull(connect, image);
        said_set(app, name, 'making its container');
        await network_made(connect);
        await container_made(connect, server, engine, image);
        said_set(app, name, `waiting for ${engine.label} to answer`);
        await ready_wait(connect, server, engine);
        if (server.sample) {
            await sample_load(app, connect, server);
        }
        const port = await port_read(connect, server, engine);
        server_set(app, name, {phase: 'up', said: '', error: null, port});
        log_event(app, 'database_up_end_ok', {database: name, remote: server.remote, port, ms: Date.now() - begun});
    }
    catch (error) {
        server_set(app, name, {phase: 'failed', said: '', error: error.message});
        log_event(app, 'database_up_end_error', {database: name, remote: server.remote, reason: error.message, ms: Date.now() - begun});
    }
}

function server_of(app, name)
{
    return databases_read(app).servers.find(v => v.name === name);
}

function server_set(app, name, fields)
{
    const databases = databases_read(app);
    const server = databases.servers.find(v => v.name === name);
    if (server !== undefined) {
        Object.assign(server, fields);
        databases_write(app, databases);
    }
}

function said_set(app, name, said)
{
    server_set(app, name, {said});
}

async function network_made(connect)
{
    const found = await engine_call(connect, 'GET', `/networks/${NETWORK}`);
    if (found.status === 200) {
        return;
    }
    const made = await engine_call(connect, 'POST', '/networks/create', {Name: NETWORK, Labels: {'serviceman.network': 'databases'}});
    // Two servers made at once may both find none: the second is told it is there
    if ((made.status !== 201) && (made.status !== 409)) {
        throw new Error(engine_said(made));
    }
}

// Made once: one found already, of a start before, is started as it is, its data in its volume
async function container_made(connect, server, engine, image)
{
    const container = `serviceman-db-${server.name}`;
    const found = await engine_call(connect, 'GET', `/containers/${container}/json`);
    if (found.status === 404) {
        const made = await engine_call(connect, 'POST', `/containers/create?name=${container}`, {
            Image: image,
            Env: [`${engine.root_env}=${server.root}`].concat((engine.admin_env === undefined) ? [] : [`${engine.admin_env}=${engine.admin}`]),
            Labels: {'serviceman.database': server.name},
            ExposedPorts: {[`${engine.port}/tcp`]: {}},
            HostConfig: {
                Binds: [`${container}:${engine.data}`],
                PortBindings: {[`${engine.port}/tcp`]: [{HostIp: '127.0.0.1', HostPort: ''}]},
                RestartPolicy: {Name: 'unless-stopped'},
                NetworkMode: NETWORK,
            },
        });
        if (made.status !== 201) {
            throw new Error(engine_said(made));
        }
    }
    else if (found.status !== 200) {
        throw new Error(engine_said(found));
    }
    if (server.engine === 'couchdb') {
        await engine_files_put(connect, container, COUCHDB_LOCAL, [{name: 'authwall.ini', bytes: Buffer.from(couchdb_ini(server.secret))}]);
    }
    const started = await engine_call(connect, 'POST', `/containers/${container}/start`);
    if ((started.status !== 204) && (started.status !== 304)) {
        throw new Error(engine_said(started));
    }
}

// Answering on its port: its first start runs a server of its own without one while it makes
// the data folder, so a ping over TCP answers only once the real one is up. A container that
// stopped meanwhile is said with the last of its log.
async function ready_wait(connect, server, engine)
{
    const container = `serviceman-db-${server.name}`;
    const until = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < until) {
        const inspected = await engine_call(connect, 'GET', `/containers/${container}/json`);
        if ((inspected.status === 200) && (JSON.parse(inspected.body).State.Running === false)) {
            throw new Error(`it stopped as it came up: ${await log_tail(connect, container)}`);
        }
        const ping = await engine_exec(connect, container, READY[engine.value], (engine.password_env === null) ? [] : [`${engine.password_env}=${server.root}`]);
        if (ping.code === 0) {
            return;
        }
        await new Promise(v => setTimeout(v, READY_EVERY_MS));
    }
    throw new Error(`it did not answer within ${READY_TIMEOUT_MS/60000} minutes: ${await log_tail(connect, container)}`);
}

async function log_tail(connect, container)
{
    const answer = await engine_call(connect, 'GET', `/containers/${container}/logs?stdout=1&stderr=1&tail=${LOG_LINES}`);
    // Each frame of a container's log starts with 8 bytes of its own; what is left is the text
    return answer.body.replace(/[\x00-\x08\x0e-\x1f]/g, '').split('\n').map(v => v.trim()).filter(v => v !== '').slice(-3).join(' · ');
}

// The sample's files, each run whole as root, then its database's own user. A PostgreSQL sample
// that loads into a database of its own name has it made first, afresh: one that failed before
// leaves it half made.
async function sample_load(app, connect, server)
{
    const sample = database_samples[server.engine][server.sample];
    said_set(app, server.name, `fetching ${sample.label}`);
    const files = await database_sample_files(app, server.engine, server.sample);
    said_set(app, server.name, `loading ${sample.label}, its sha256 checked`);
    if ((sample.into !== undefined) && (sample.into !== null)) {
        await database_sql(connect, server, `DROP DATABASE IF EXISTS "${sample.into}" WITH (FORCE);\n`);
        await database_sql(connect, server, `CREATE DATABASE "${sample.into}";\n`);
    }
    for (const file of files) {
        await database_sql(connect, server, file.bytes.toString('utf8'), sample.into);
    }
    const user = database_user_make(sample.database);
    await database_sql(connect, server, database_user_sql(server.engine, sample.database, user, false));
    const databases = databases_read(app);
    const kept = databases.servers.find(v => v.name === server.name);
    kept.users[sample.database] = user;
    databases_write(app, databases);
}

async function port_read(connect, server, engine)
{
    const inspected = await engine_call(connect, 'GET', `/containers/serviceman-db-${server.name}/json`);
    if (inspected.status !== 200) {
        throw new Error(engine_said(inspected));
    }
    const ports = JSON.parse(inspected.body).NetworkSettings.Ports[`${engine.port}/tcp`];
    return ((ports === null) || (ports === undefined) || (ports.length === 0)) ? null : Number(ports[0].HostPort);
}

database_up.NETWORK = NETWORK;

module.exports = database_up;
