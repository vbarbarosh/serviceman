import app_data_engines from './app_data_engines.js';

// The value a row of an app's Data tab puts in its variable, as serviceman would give it:
// item {kind: database|folder|rest, engine, from: kept|machine, path, secret}; app {name, kind,
// host}; shown, the password in full or as dots. A database is the app's own, its user named
// after the app; a folder kept for it is under the agent's folder on its machine, or /data/files
// inside a docker image; REST is /_data/ at the app's address, and a page asks its own.
function app_data_value(item, app, shown)
{
    const user = app.name.replace(/-/g, '_');
    if (item.kind === 'database') {
        const engine = app_data_engines.find(v => v.value === item.engine) || app_data_engines[0];
        const secret = shown ? item.secret : '•'.repeat(8);
        return `${engine.scheme}://${user}:${secret}@127.0.0.1:${engine.port}/${user}`;
    }
    if (item.kind === 'folder') {
        if (app.kind === 'docker image') {
            return '/data/files';
        }
        if (item.from === 'machine') {
            return item.path || '/srv/files';
        }
        return `~/serviceman-agent/data/${app.name}/files`;
    }
    if (app.kind === 'page') {
        return '/_data/';
    }
    return `http://${app.host}/_data/`;
}

export default app_data_value;
