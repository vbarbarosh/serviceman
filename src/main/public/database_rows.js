import database_state from './database_state.js';

// Each engine's mark, as New database draws it
const ENGINE_COLOURS = {mysql: '#FF8400', postgresql: '#1299DA', couchdb: '#C77DFF'};
const DATABASE_ICON = '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>';

// The rows of a table of databases: one per database, and one for each server with none to show
// (empty, coming up, failed, its machine away), each as database_cell.js draws it.
//
//     servers   what GET /api/v1/databases answers in servers
//     engines   ...and in engines, for their names
//
//     [{key, server, database, name, aside, icon, colour, engine, machine, size, apps, no_apps,
//       dot, state, bad, busy, detail}]   database is '' on a server's own row
function database_rows(servers, engines)
{
    const out = [];
    for (const server of servers) {
        const state = database_state(server);
        const base = {server: server.name, icon: DATABASE_ICON, colour: ENGINE_COLOURS[server.engine] || 'currentColor', engine: database_engine_text(server, engines), machine: server.title, dot: state.dot, state: state.word, bad: state.bad, busy: (server.phase === 'starting'), detail: state.detail};
        if (server.databases.length === 0) {
            const aside = ((server.phase === 'up') && server.online) ? 'no database in it yet' : 'a server';
            out.push(Object.assign({}, base, {key: `${server.name}/`, database: '', name: server.name, aside, size: '—', apps: [], no_apps: '—'}));
            continue;
        }
        for (const database of server.databases) {
            const aside = (server.engine === 'couchdb') ? `${database.tables} ${(database.tables === 1) ? 'user' : 'users'}` : '';
            out.push(Object.assign({}, base, {key: `${server.name}/${database.name}`, database: database.name, name: database.name, aside, size: database_size(database.bytes), apps: database.apps, no_apps: 'no app yet'}));
        }
    }
    return out;
}

// "PostgreSQL 17"
function database_engine_text(server, engines)
{
    const engine = engines.find(v => v.value === server.engine);
    return `${(engine === undefined) ? server.engine : engine.label} ${server.version}`;
}

function database_size(bytes)
{
    if (bytes < 1024*1024) {
        return `${Math.max(1, Math.round(bytes/1024))} KB`;
    }
    if (bytes < 1024*1024*1024) {
        return `${(bytes/1024/1024).toFixed(1)} MB`;
    }
    return `${(bytes/1024/1024/1024).toFixed(1)} GB`;
}

database_rows.ENGINE_COLOURS = ENGINE_COLOURS;
database_rows.DATABASE_ICON = DATABASE_ICON;
database_rows.engine_text = database_engine_text;
database_rows.size = database_size;

export default database_rows;
