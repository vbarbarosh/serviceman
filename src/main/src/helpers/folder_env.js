const path = require('path');
const remote_call = require('./remote_call');
const volume_keep_root = require('./volume_keep_root');

// Where a folder an app picked is, in a container: /data/files, then /data/files-2 for a second
const INSIDE = '/data/files';

// The folders an app picked in its Data tab, at its start: {env, volumes}. In a container each
// is mounted, /data/files the first, and its variable names where; the folder kept for it is the
// agent's data/<app>/files, made with the container's other kept folders. A program on the
// machine itself finds each folder's own path there, the one kept for it made now. A folder of
// the machine that is not there is made, by the agent, as its own user.
async function folder_env(app, remote, service, inside)
{
    const out = {env: {}, volumes: []};
    const rows = (service.folders === undefined) ? [] : service.folders;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const suffix = (i === 0) ? '' : `-${i + 1}`;
        if (inside) {
            const target = `${INSIDE}${suffix}`;
            out.volumes.push((row.path === null) ? {kind: 'kept', source: '', keep: `${service.name}/files${suffix}`, target, readonly: false, create: true} : {kind: 'path', source: row.path, target, readonly: false, create: true});
            out.env[row.env] = target;
            continue;
        }
        let where = row.path;
        if (where === null) {
            const root = volume_keep_root(app, remote);
            if (root === null) {
                throw new Error(`the agent on ${remote.name} does not say where it keeps things, so ${service.name} has no folder kept for it: run bin/update on that machine`);
            }
            where = path.posix.join(root, 'data', service.name, `files${suffix}`);
        }
        await remote_call(app, remote, 'dir_create', {path: where});
        out.env[row.env] = where;
    }
    return out;
}

module.exports = folder_env;
