const body_fields = require('../body_fields');
const crypto = require('crypto');
const database_engines = require('../helpers/database_engines');
const database_list = require('../helpers/database_list');
const database_samples = require('../helpers/database_samples');
const database_sql = require('../helpers/database_sql');
const database_up = require('../helpers/database_up');
const database_user_make = require('../helpers/database_user_make');
const database_user_sql = require('../helpers/database_user_sql');
const databases_read = require('../helpers/databases_read');
const databases_write = require('../helpers/databases_write');
const docker_exec_connect = require('../helpers/docker_exec_connect');
const engine_call = require('../helpers/engine_call');
const engine_said = require('../helpers/engine_said');
const log_event = require('../helpers/log_event');
const route_param = require('../helpers/route_param');
const send_json = require('../helpers/send_json');

const BODY_LIMIT_BYTES = 16*1024;
// A server's name: its container and its volume are called after it
const RE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
// A database's name, which is its user's name too
const RE_DATABASE = /^[a-z][a-z0-9_]{0,31}$/;
const RE_SERVER = /^\/api\/v1\/databases\/([^/]+)$/;
const RE_SERVER_DATABASES = /^\/api\/v1\/databases\/([^/]+)\/databases$/;
// How long a server's list of databases is shown as last read before it is read again
const LIST_FRESH_MS = 10000;

// GET /api/v1/databases (query)                    the servers, each one's databases as it says them; live=0 as last read
// POST /api/v1/databases (body)                    {name, engine, version, remote, sample}: a server brought up there, filled with the sample
// POST /api/v1/databases/<server>/databases (body) {name}: an empty database in it, with a user of its own
// DELETE /api/v1/databases/<server>                the server, its container and its volume, every database in it
//
// True when the request was one of these. The owner's alone: the passwords are behind it, and
// none of them is ever in an answer.
async function handle_databases(app, req, res, url)
{
    if ((url.pathname === '/api/v1/databases') && (req.method === 'GET')) {
        send_json(res, 200, await view_of(app, url.searchParams.get('live') !== '0'));
        return true;
    }
    if ((url.pathname === '/api/v1/databases') && (req.method === 'POST')) {
        await server_create(app, req, res);
        return true;
    }
    const server = RE_SERVER_DATABASES.exec(url.pathname);
    if ((server !== null) && (req.method === 'POST')) {
        await database_create(app, req, res, route_param(server[1]));
        return true;
    }
    const removed = RE_SERVER.exec(url.pathname);
    if ((removed !== null) && (req.method === 'DELETE')) {
        await server_remove(app, res, route_param(removed[1]));
        return true;
    }
    return false;
}

// A new server, or one that failed brought up again with what it was given
async function server_create(app, req, res)
{
    const body = await body_fields(req, BODY_LIMIT_BYTES);
    const name = String((body.name === undefined) ? '' : body.name);
    const engine = database_engines.find(v => v.value === body.engine);
    if (RE_NAME.test(name) === false) {
        send_json(res, 400, {error: 'a database server\'s name is up to 40 small letters, digits and hyphens, a letter first'});
        return;
    }
    if (engine === undefined) {
        send_json(res, 400, {error: `serviceman brings up ${database_engines.map(v => v.label).join(' or ')}, not ${JSON.stringify(String(body.engine))}`});
        return;
    }
    const version = String(body.version);
    if (engine.versions[version] === undefined) {
        send_json(res, 400, {error: `${engine.label} comes in ${Object.keys(engine.versions).join(' or ')}, not ${JSON.stringify(version)}`});
        return;
    }
    const sample = String((body.sample === undefined) ? '' : body.sample);
    if ((sample !== '') && (database_samples[engine.value][sample] === undefined)) {
        send_json(res, 400, {error: `no sample called ${JSON.stringify(sample)} for ${engine.label}`});
        return;
    }
    const remote = app.remote_by_name[String(body.remote)];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(String(body.remote))}`});
        return;
    }
    const why = machine_refusal(remote);
    if (why !== null) {
        send_json(res, 409, {error: `${title_of(app, remote.name)} ${why}`});
        return;
    }
    const databases = databases_read(app);
    const found = databases.servers.find(v => v.name === name);
    if ((found !== undefined) && (found.phase !== 'failed')) {
        send_json(res, 409, {error: `there is a database server called ${name} already`});
        return;
    }
    if (app.database_jobs.has(name)) {
        send_json(res, 409, {error: `${name} is on its way already`});
        return;
    }
    // Tried again where it was, it keeps its root password: its volume holds data made with it
    const root = ((found !== undefined) && (found.remote === remote.name)) ? found.root : crypto.randomBytes(16).toString('hex');
    const server = {name, engine: engine.value, version, remote: remote.name, sample, root, users: (found === undefined) ? {} : found.users, phase: 'starting', said: 'on its way', error: null, port: null, made: new Date().toISOString()};
    databases.servers = databases.servers.filter(v => v.name !== name).concat([server]);
    databases_write(app, databases);
    app.database_jobs.add(name);
    send_json(res, 202, await view_of(app, false));
    database_up(app, name).finally(function () {
        app.database_jobs.delete(name);
        app.database_lists.delete(name);
    });
}

async function database_create(app, req, res, name)
{
    const body = await body_fields(req, BODY_LIMIT_BYTES);
    const database = String((body.name === undefined) ? '' : body.name);
    if (RE_DATABASE.test(database) === false) {
        send_json(res, 400, {error: 'a database\'s name is up to 32 small letters, digits and _, a letter first'});
        return;
    }
    const server = databases_read(app).servers.find(v => v.name === name);
    if (server === undefined) {
        send_json(res, 404, {error: `no database server called ${JSON.stringify(name)}`});
        return;
    }
    const remote = app.remote_by_name[server.remote];
    if ((server.phase !== 'up') || (remote === undefined) || (remote.state.phase !== 'online')) {
        send_json(res, 409, {error: `${name} is not up on ${server.remote} now`});
        return;
    }
    const connect = docker_exec_connect(app, remote);
    const there = await database_list(connect, server);
    if (there.some(v => v.name.toLowerCase() === database)) {
        send_json(res, 409, {error: `${name} has a database called ${database} already`});
        return;
    }
    const user = database_user_make(database);
    try {
        await database_sql(connect, server, database_user_sql(server.engine, database, user, true));
    }
    catch (error) {
        send_json(res, 502, {error: `${name} did not make ${database}: ${error.message}`});
        return;
    }
    const databases = databases_read(app);
    databases.servers.find(v => v.name === name).users[database] = user;
    databases_write(app, databases);
    app.database_lists.delete(name);
    log_event(app, 'database_make', {database: name, name: database, remote: server.remote});
    send_json(res, 201, await view_of(app, true));
}

// Its container and its volume go, through its machine's docker; a machine that is away keeps
// them, and the server stays, failed, saying so
async function server_remove(app, res, name)
{
    const databases = databases_read(app);
    const server = databases.servers.find(v => v.name === name);
    if (server === undefined) {
        send_json(res, 404, {error: `no database server called ${JSON.stringify(name)}`});
        return;
    }
    if (app.database_jobs.has(name)) {
        send_json(res, 409, {error: `${name} is on its way up: remove it once it is up or failed`});
        return;
    }
    const remote = app.remote_by_name[server.remote];
    if ((remote !== undefined) && (remote.state.phase === 'online')) {
        try {
            const connect = docker_exec_connect(app, remote);
            const gone = await engine_call(connect, 'DELETE', `/containers/serviceman-db-${name}?force=1`);
            if ((gone.status !== 204) && (gone.status !== 404)) {
                throw new Error(engine_said(gone));
            }
            const volume = await engine_call(connect, 'DELETE', `/volumes/serviceman-db-${name}`);
            if ((volume.status !== 204) && (volume.status !== 404)) {
                throw new Error(engine_said(volume));
            }
        }
        catch (error) {
            send_json(res, 502, {error: `${name} was not removed from ${title_of(app, server.remote)}: ${error.message}`});
            return;
        }
    }
    else if (remote !== undefined) {
        send_json(res, 409, {error: `${title_of(app, server.remote)} is offline: ${name} is removed once it is back`});
        return;
    }
    databases.servers = databases.servers.filter(v => v.name !== name);
    databases_write(app, databases);
    app.database_lists.delete(name);
    log_event(app, 'database_remove', {database: name, remote: server.remote});
    send_json(res, 200, await view_of(app, false));
}

// What the page shows: the engines with their versions and samples, the machines that may hold
// a server, and the servers, each with its databases. A server left starting by a serviceman
// that restarted is one that failed.
async function view_of(app, live)
{
    const servers = databases_read(app).servers;
    const rows = [];
    for (const server of servers) {
        const remote = app.remote_by_name[server.remote];
        const online = (remote !== undefined) && (remote.state.phase === 'online');
        const stale = (server.phase === 'starting') && (app.database_jobs.has(server.name) === false);
        const row = {
            name: server.name,
            engine: server.engine,
            version: server.version,
            remote: server.remote,
            title: title_of(app, server.remote),
            online,
            phase: stale ? 'failed' : server.phase,
            said: server.said,
            error: stale ? 'serviceman restarted while it came up; bring it up again' : server.error,
            port: server.port,
            databases: [],
        };
        if ((row.phase === 'up') && online) {
            row.databases = await databases_of(app, remote, server, live);
        }
        rows.push(row);
    }
    return {
        engines: database_engines.map(v => ({value: v.value, label: v.label, versions: Object.keys(v.versions), samples: Object.entries(database_samples[v.value]).map(vv => ({value: vv[0], label: vv[1].label, about: vv[1].about}))})),
        machines: app.remotes.map(v => ({remote: v.name, title: title_of(app, v.name), online: (v.state.phase === 'online'), docker: (machine_refusal(v) === null) || (v.state.phase !== 'online')})),
        servers: rows,
    };
}

// As the server said them last, read again when that is older than a few seconds; a server that
// does not answer shows the last it said. Each with the apps that picked it in their Data tab,
// and the name of the user serviceman made for it, which an app's pick needs; null for none.
async function databases_of(app, remote, server, live)
{
    let kept = app.database_lists.get(server.name);
    const fresh = (kept !== undefined) && (Date.now() - kept.at < LIST_FRESH_MS);
    if (live && (fresh === false)) {
        try {
            kept = {at: Date.now(), rows: await database_list(docker_exec_connect(app, remote), server)};
            app.database_lists.set(server.name, kept);
        }
        catch {
            // Shown as it said them last
        }
    }
    const rows = (kept === undefined) ? [] : kept.rows;
    return rows.map(v => Object.assign({}, v, {apps: apps_of(app, server.name, v.name), user: (server.users[v.name] === undefined) ? null : server.users[v.name].user}));
}

// The apps that picked a database, by name
function apps_of(app, server, database)
{
    return app.services.filter(v => (v.databases !== undefined) && v.databases.some(vv => (vv.server === server) && (vv.database === database))).map(v => v.name);
}

// Why a machine cannot hold a server, or null: it is online with docker its agent reaches
function machine_refusal(remote)
{
    if (remote.state.phase !== 'online') {
        return 'is offline';
    }
    if ((remote.state.resources === null) || (remote.state.resources.docker === null) || (remote.state.resources.docker_socket === null) || (remote.state.resources.docker_socket === undefined)) {
        return 'has no docker its agent can reach';
    }
    return null;
}

function title_of(app, name)
{
    const remote = app.remote_by_name[name];
    return ((remote === undefined) || (remote.title === undefined) || (remote.title === '')) ? name : remote.title;
}

module.exports = handle_databases;
