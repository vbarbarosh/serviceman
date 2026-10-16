const view_from_remote = require('./view_from_remote');
const view_from_service = require('./view_from_service');

// The status as a token other than the owner's sees it: its machines and what runs on them, and nothing of
// the config, the forwards, the secrets or the other machines
function control_token_status(app, token)
{
    const now = Date.now();
    const seen = new Set(token.remotes);
    const remotes = app.remotes.filter(v => seen.has(v.name)).map(v => view_from_remote(v, now, app.config.logline));
    const services = [];
    for (const service of app.services) {
        const view = view_from_service(service, now);
        const instances = view.instances.filter(v => seen.has(v.remote));
        const named = (Array.isArray(service.remotes) ? service.remotes : []).some(v => seen.has(v));
        if ((instances.length === 0) && (named === false)) {
            continue;
        }
        services.push(Object.assign(view, {instances, instances_running: instances.filter(v => v.phase === 'running').length}));
    }
    return {now, started_at: app.started_at, token: {label: token.label, remotes: token.remotes, rights: token.rights, folders: (Array.isArray(token.folders) ? token.folders : [])}, services, remotes};
}

module.exports = control_token_status;
