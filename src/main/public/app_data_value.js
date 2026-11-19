// The value a sketch's row of an app's Data tab puts in its variable, as serviceman would give it:
// item {kind: folder|rest, from: kept|machine, path}; app {name, kind, host}. A folder kept for
// it is under the agent's folder on its machine, or /data/files inside a docker image; REST is
// /_data/ at the app's address, and a page asks its own.
function app_data_value(item, app)
{
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
