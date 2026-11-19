const database_engines = require('./database_engines');
const databases_read = require('./databases_read');

// A variable's _URL, with the number a second one of its name has
const RE_URL_ENV = /_URL(_\d+)?$/;

// The variables an app finds the databases it picked in its Data tab in, at every start:
// {<env>: <url>}, each the database's own user and password. A CouchDB is given as its admin,
// with no database in its URL, and the secret it trusts a signed user name by in a variable of
// its own: COUCHDB_SECRET beside COUCHDB_URL, COUCHDB_SECRET_2 beside COUCHDB_URL_2, and
// <env>_SECRET beside a name with no _URL (app_data_tab.js says it the same). An app in a container reaches the
// server by its container's name on the databases' network, which it joins (inside); a program
// on the machine itself reaches it on 127.0.0.1, at its port there. A database is reached on its
// own machine: a pick of another machine's, or of one that is not there or not up, stops the
// start with the reason, rather than starting an app that finds no database.
function database_env(app, remote, service, inside)
{
    const out = {};
    const rows = (service.databases === undefined) ? [] : service.databases;
    if (rows.length === 0) {
        return out;
    }
    const servers = databases_read(app).servers;
    for (const row of rows) {
        const server = servers.find(v => v.name === row.server);
        if (server === undefined) {
            throw new Error(`${service.name} picked ${row.database} on ${row.server}, and no database server is called ${row.server} now: see Databases`);
        }
        if (server.remote !== remote.name) {
            throw new Error(`${row.server} is on ${server.remote}, and ${service.name} runs on ${remote.name}: an app picks a database of its own machine`);
        }
        if (server.phase !== 'up') {
            throw new Error(`${row.server} is not up: see Databases`);
        }
        const user = server.users[row.database];
        if (user === undefined) {
            throw new Error(`${row.server} has no database ${row.database} made by serviceman`);
        }
        const engine = database_engines.find(v => v.value === server.engine);
        const host = inside ? `serviceman-db-${server.name}:${engine.port}` : `127.0.0.1:${server.port}`;
        if (server.engine === 'couchdb') {
            out[row.env] = `${engine.scheme}://${user.user}:${user.password}@${host}`;
            out[secret_env(row.env)] = server.secret;
            continue;
        }
        out[row.env] = `${engine.scheme}://${user.user}:${user.password}@${host}/${row.database}`;
    }
    return out;
}

function secret_env(env)
{
    return RE_URL_ENV.test(env) ? env.replace(RE_URL_ENV, '_SECRET$1') : `${env}_SECRET`;
}

database_env.secret_env = secret_env;

module.exports = database_env;
