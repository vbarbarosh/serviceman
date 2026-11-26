const body_fields = require('../body_fields');
const crypto = require('crypto');
const database_engines = require('../helpers/database_engines');
const database_forwards_put = require('../helpers/database_forwards_put');
const database_list = require('../helpers/database_list');
const database_port_follow = require('../helpers/database_port_follow');
const database_public_firewall = require('../helpers/database_public_firewall');
const database_public_tls = require('../helpers/database_public_tls');
const database_public_url = require('../helpers/database_public_url');
const database_samples = require('../helpers/database_samples');
const database_sql = require('../helpers/database_sql');
const database_up = require('../helpers/database_up');
const database_url = require('../helpers/database_url');
const database_user_make = require('../helpers/database_user_make');
const database_user_sql = require('../helpers/database_user_sql');
const databases_read = require('../helpers/databases_read');
const databases_write = require('../helpers/databases_write');
const docker_exec_connect = require('../helpers/docker_exec_connect');
const engine_call = require('../helpers/engine_call');
const engine_said = require('../helpers/engine_said');
const log_event = require('../helpers/log_event');
const remote_addresses = require('../helpers/remote_addresses');
const remote_can = require('../helpers/remote_can');
const route_param = require('../helpers/route_param');
const send_json = require('../helpers/send_json');
const view_from_forward = require('../helpers/view_from_forward');

const BODY_LIMIT_BYTES = 16*1024;
// A server's name: its container and its volume are called after it
const RE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
// A database's name, which is its user's name too
const RE_DATABASE = /^[a-z][a-z0-9_]{0,31}$/;
const RE_SERVER = /^\/api\/v1\/databases\/([^/]+)$/;
const RE_SERVER_DATABASES = /^\/api\/v1\/databases\/([^/]+)\/databases$/;
const RE_SERVER_FORWARDS = /^\/api\/v1\/databases\/([^/]+)\/forwards$/;
const RE_SERVER_URL = /^\/api\/v1\/databases\/([^/]+)\/url$/;
const RE_SERVER_CERTIFICATE = /^\/api\/v1\/databases\/([^/]+)\/certificate$/;
// How long a server's list of databases is shown as last read before it is read again
const LIST_FRESH_MS = 10000;

// GET /api/v1/databases (query)                    the servers, each one's databases as it says them; live=0 as last read, asked once when never
// POST /api/v1/databases (body)                    {name, engine, version, remote, sample}: a server brought up there, filled with the sample
// POST /api/v1/databases/<server>/databases (body) {name}: an empty database in it, with a user of its own
// PUT /api/v1/databases/<server>/forwards (body)   {forwards: [{to, tls, allow}]}: where its port shows up on other machines, and on its public port
// GET /api/v1/databases/<server>/url (query)       database, remote or public=1: {url}, its user's URL, password and all, for a program on that machine or anywhere
// GET /api/v1/databases/<server>/certificate       its public port's authority, <server>-ca.pem, for a client to check the server by
// DELETE /api/v1/databases/<server>                the server, its container and its volume, every database in it, its forwards
//
// True when the request was one of these. The owner's alone: the passwords are behind it, and
// none of them is in an answer but the one URL Copy URL asks for, which is written down.
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
    const forwards = RE_SERVER_FORWARDS.exec(url.pathname);
    if ((forwards !== null) && (req.method === 'PUT')) {
        await forwards_put(app, req, res, route_param(forwards[1]));
        return true;
    }
    const given = RE_SERVER_URL.exec(url.pathname);
    if ((given !== null) && (req.method === 'GET')) {
        url_give(app, res, route_param(given[1]), String(url.searchParams.get('database')), (url.searchParams.get('public') === '1') ? null : String(url.searchParams.get('remote')));
        return true;
    }
    const certificate = RE_SERVER_CERTIFICATE.exec(url.pathname);
    if ((certificate !== null) && (req.method === 'GET')) {
        certificate_give(app, res, route_param(certificate[1]));
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
    if (app.database_jobs.has(name)) {
        send_json(res, 409, {error: `${name} is on its way already`});
        return;
    }
    // One left starting by a serviceman that restarted failed, as the page says it did
    if ((found !== undefined) && (found.phase !== 'failed') && (found.phase !== 'starting')) {
        send_json(res, 409, {error: `there is a database server called ${name} already`});
        return;
    }
    // Tried again where it was, it keeps its root password: its volume holds data made with it
    const again = (found !== undefined) && (found.remote === remote.name);
    const root = again ? found.root : crypto.randomBytes(16).toString('hex');
    const server = {name, engine: engine.value, version, remote: remote.name, sample, root, users: (found === undefined) ? {} : found.users, phase: 'starting', said: 'on its way', error: null, port: null, made: new Date().toISOString()};
    // A CouchDB is given to an app as its admin, and trusts a user name signed by a secret of
    // its own, made here and kept with its password
    if (engine.value === 'couchdb') {
        server.users = {[engine.admin]: {user: engine.admin, password: root}};
        server.secret = (again && (typeof found.secret === 'string')) ? found.secret : crypto.randomBytes(32).toString('hex');
    }
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
    if (server.engine === 'couchdb') {
        send_json(res, 409, {error: `${name} is a CouchDB: its databases are made by the app given it, as its admin, one for each user it signs in`});
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

// Where its port shows up on other machines: {forwards: [{to}]}, each `to` a machine and a port
// on its loopback, {"remote": "vps2", "port": 27017}, or a socket file there, as a forward's `to`
// is written. Each is a forward that is part of it, from its machine and its port now, which
// follows that port (database_forwards_put); an empty list takes them all out. What the config
// refuses is said as it says it.
async function forwards_put(app, req, res, name)
{
    const body = await body_fields(req, BODY_LIMIT_BYTES);
    const server = databases_read(app).servers.find(v => v.name === name);
    if (server === undefined) {
        send_json(res, 404, {error: `no database server called ${JSON.stringify(name)}`});
        return;
    }
    const wrong = (Array.isArray(body.forwards) === false) || body.forwards.some(v => (v === null) || (typeof v !== 'object') || (v.to === null) || (typeof v.to !== 'object') || Array.isArray(v.to));
    if (wrong) {
        send_json(res, 400, {error: 'forwards: where its port shows up, a list of {"to": {"remote": "vps2", "port": 27017}}, its public port {"to": {"remote": "<its machine>", "port": 27017, "host": "0.0.0.0"}, "tls": true, "allow": []}'});
        return;
    }
    // A public port speaks TLS as a MongoDB's client does, from its first byte; MySQL and
    // PostgreSQL ask for it inside their own protocol, and a port that answered TLS at once would
    // turn their clients away
    if (body.forwards.some(v => v.to.host !== undefined) && (server.engine !== 'mongodb')) {
        send_json(res, 400, {error: `a public port is a MongoDB's: ${name} is ${server.engine}`});
        return;
    }
    if ((body.forwards.length > 0) && (server.port === null)) {
        send_json(res, 409, {error: `${name} has no port yet: it goes to another machine once ${name} is up`});
        return;
    }
    const had_public = app.config.forwards.some(v => (v.database === name) && (v.to.host === '0.0.0.0'));
    let written;
    try {
        written = await database_forwards_put(app, server, body.forwards.map(v => ({to: v.to, tls: v.tls, allow: v.allow})));
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
        return;
    }
    log_event(app, 'database_forwards', {database: name, forwards: written.labels.join(', ') || 'none', removed: written.removed.join(', ') || 'none'});
    // Its machine's firewall lets the public port in, or no longer
    if (had_public || body.forwards.some(v => v.to.host !== undefined)) {
        await database_public_firewall(app, server);
    }
    send_json(res, 200, await view_of(app, false));
}

// Copy URL: a database's URL as a program on a machine reaches it, its user's password in it,
// for the owner to connect by hand (database_url): on the server's machine at its port, on
// another at its forward's. Written down, the password left out; why it is not reached from
// there is said as an app's start says it.
function url_give(app, res, name, database, remote)
{
    const server = databases_read(app).servers.find(v => v.name === name);
    if (server === undefined) {
        send_json(res, 404, {error: `no database server called ${JSON.stringify(name)}`});
        return;
    }
    // Through its public port, from anywhere
    if (remote === null) {
        let url;
        try {
            url = database_public_url(app, server, database);
        }
        catch (error) {
            send_json(res, 409, {error: error.message});
            return;
        }
        log_event(app, 'database_url_given', {database: name, name: database, remote: 'the internet'});
        send_json(res, 200, {url});
        return;
    }
    if (app.remote_by_name[remote] === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(remote)}`});
        return;
    }
    let url;
    try {
        url = database_url(app, server, database, remote, false);
    }
    catch (error) {
        send_json(res, 409, {error: error.message});
        return;
    }
    log_event(app, 'database_url_given', {database: name, name: database, remote});
    send_json(res, 200, {url});
}

// Its public port's authority, the file a client checks the server by (tlsCAFile): no secret,
// its key thrown away when it was made (database_public_tls). Made now when its port speaks TLS
// and none was made yet.
function certificate_give(app, res, name)
{
    const server = databases_read(app).servers.find(v => v.name === name);
    if (server === undefined) {
        send_json(res, 404, {error: `no database server called ${JSON.stringify(name)}`});
        return;
    }
    const tls = app.config.forwards.some(v => (v.database === name) && (v.to.host === '0.0.0.0') && v.tls);
    if ((server.tls === undefined) && tls) {
        database_public_tls(app, name);
    }
    const kept = databases_read(app).servers.find(v => v.name === name).tls;
    if (kept === undefined) {
        send_json(res, 404, {error: `${name} has no public port that speaks TLS, and so no certificate`});
        return;
    }
    res.writeHead(200, {'content-type': 'application/x-pem-file', 'content-disposition': `attachment; filename="${name}-ca.pem"`, 'cache-control': 'no-store'});
    res.end(kept.ca);
}

// Its container and its volume go, through its machine's docker; a machine that is away keeps
// them, and the server stays, failed, saying so. Its forwards go with it, and the answer names
// them: forwards_removed
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
            // v=1: the volumes its image declares beyond the one kept for it go with it, a
            // MongoDB's /data/configdb, which docker made unnamed
            const gone = await engine_call(connect, 'DELETE', `/containers/serviceman-db-${name}?force=1&v=1`);
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
    let forwards_removed = [];
    const had_public = app.config.forwards.some(v => (v.database === name) && (v.to.host === '0.0.0.0'));
    if (app.config.forwards.some(v => v.database === name)) {
        try {
            forwards_removed = (await database_forwards_put(app, server, [])).removed;
        }
        catch (error) {
            log_event(app, 'database_forwards_error', {database: name, reason: error.message});
        }
    }
    // The firewall rules its public port had go with it
    if (had_public) {
        await database_public_firewall(app, server);
        app.database_firewall.delete(name);
    }
    send_json(res, 200, Object.assign(await view_of(app, false), {forwards_removed}));
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
            // The sample it was filled with, '' for none: what bringing it up again asks for
            sample: server.sample || '',
            remote: server.remote,
            title: title_of(app, server.remote),
            online,
            phase: stale ? 'failed' : server.phase,
            said: server.said,
            error: stale ? 'serviceman restarted while it came up; bring it up again' : server.error,
            port: server.port,
            databases: [],
            // Where its port shows up on other machines, and how each stands now
            forwards: forwards_of(app, server.name),
            // When its databases were read last, what the page shows while its machine is away
            read_at: app.database_lists.has(server.name) ? app.database_lists.get(server.name).at : null,
            // A CouchDB's: the apps whose store for each user it is, finding it at /_couch
            stores: app.services.filter(v => (v.store !== undefined) && (v.store !== null) && (v.store.server === server.name)).map(v => v.name),
        };
        if ((row.phase === 'up') && online) {
            row.databases = await databases_of(app, remote, server, live);
        }
        rows.push(row);
    }
    return {
        engines: database_engines.map(v => ({value: v.value, label: v.label, port: v.port, scheme: v.scheme, versions: Object.keys(v.versions), samples: Object.entries(database_samples[v.value]).map(vv => ({value: vv[0], label: vv[1].label, about: vv[1].about, database: vv[1].database}))})),
        machines: app.remotes.map(v => ({remote: v.name, title: title_of(app, v.name), online: (v.state.phase === 'online'), docker: (machine_refusal(v) === null) || (v.state.phase !== 'online')})),
        servers: rows,
    };
}

// As the server said them last, read again when that is older than a few seconds, and once
// when it never was, even for a count; a server that does not answer shows the last it said. Each with the apps that picked it in their Data tab,
// the variable each finds it in, by the app's name, and the name of the user serviceman made for
// it, which an app's pick needs; null for none.
async function databases_of(app, remote, server, live)
{
    let kept = app.database_lists.get(server.name);
    const fresh = (kept !== undefined) && (Date.now() - kept.at < LIST_FRESH_MS);
    if ((live || (kept === undefined)) && (fresh === false)) {
        try {
            kept = {at: Date.now(), rows: await database_list(docker_exec_connect(app, remote), server)};
            app.database_lists.set(server.name, kept);
            // Its port as docker says it now, which its forwards follow
            await database_port_follow(app, server.name);
        }
        catch {
            // Shown as it said them last
        }
    }
    const rows = (kept === undefined) ? [] : kept.rows;
    return rows.map(v => Object.assign({}, v, {apps: apps_of(app, server.name, v.name), envs: envs_of(app, server.name, v.name), user: (server.users[v.name] === undefined) ? null : server.users[v.name].user}));
}

// The forwards that are part of a server, as the page shows them: where each shows up, how it
// stands now as the Forwards page says it (view_from_forward), and the programs of that machine
// that picked a database of it, which find it there; a container there has a 127.0.0.1 of its
// own, and its start stops saying so (database_url)
function forwards_of(app, name)
{
    return app.config.forwards.filter(v => v.database === name).map(function (forward) {
        const view = view_from_forward(app, forward);
        const out = {label: forward.label, from: {remote: forward.from.remote, port: forward.from.port}, to: {remote: forward.to.remote, here: forward.to.here, port: forward.to.port, socket: forward.to.socket, host: forward.to.host}, off: forward.off, state: view.state, problem: view.problem, at: view.at, apps: [], tls: forward.tls, allow: forward.allow, address: null, firewall: null};
        if (forward.to.host === null) {
            out.apps = app.services.filter(v => (v.type === 'shell') && (v.image === null) && (v.databases !== undefined) && v.databases.some(vv => vv.server === name) && (v.remotes !== undefined) && v.remotes.includes(forward.to.remote)).map(v => v.name);
            return out;
        }
        // Its public port: the address it is reached at, what its machine's firewall said, and
        // an agent from before public ports, which is not told it (forwards_tell)
        const remote = app.remote_by_name[forward.to.remote];
        out.address = (remote === undefined) ? null : remote_addresses(remote).public;
        out.firewall = app.database_firewall.has(name) ? app.database_firewall.get(name) : null;
        if ((remote !== undefined) && (remote.state.phase === 'online') && (remote_can(remote, 'forwards_public') === false)) {
            Object.assign(out, {state: 'old_agent', problem: `the agent on ${forward.to.remote} is from before public ports: update it`});
        }
        return out;
    });
}

// The apps that picked a database, by name
function apps_of(app, server, database)
{
    return app.services.filter(v => (v.databases !== undefined) && v.databases.some(vv => (vv.server === server) && (vv.database === database))).map(v => v.name);
}

// The variable each app that picked a database finds it in, by the app's name
function envs_of(app, server, database)
{
    const out = {};
    for (const service of app.services) {
        const picked = (service.databases === undefined) ? undefined : service.databases.find(v => (v.server === server) && (v.database === database));
        if (picked !== undefined) {
            out[service.name] = picked.env;
        }
    }
    return out;
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
