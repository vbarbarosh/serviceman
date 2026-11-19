const app_address_of = require('./app_address_of');
const app_apply_config = require('./app_apply_config');
const app_files_put = require('./app_files_put');
const child_process = require('child_process');
const config_file_save = require('./config_file_save');
const config_from_file = require('./config_from_file');
const config_locked = require('./config_locked');
const fs = require('fs');
const log_event = require('./log_event');
const path = require('path');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');
const remote_disk = require('./remote_disk');
const tar_stream = require('./tar_stream');

const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
// serviceman's own folder, where the File Manager's app sits as the repository has it
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
// The ports a program on a machine is given, the first one free from here, as the New service
// form gives an app folder its own
const PORT_FIRST = 8080;
const PORT_LIST_TIMEOUT_MS = 8000;
// What it starts, with PORT, in its folder: as bin/file-manager-zip writes it
const RUN = `#!/bin/bash

# http://www.gnu.org/software/bash/manual/bash.html#The-Set-Builtin
# http://redsymbol.net/articles/unofficial-bash-strict-mode
set -o nounset -o errexit -o pipefail

script=\`realpath $0\`
scriptdir=\`dirname $script\`

cd $scriptdir/..

# The File Manager over FILES_DIR, on 127.0.0.1:$PORT; put here by serviceman as a file browser.
# The ServiceMan agent's code in it keeps to this app: what it keeps goes to data/agent, its
# lines are the app's output, and it is asked for files alone.
export SERVICEMAN_AGENT_DIR=$PWD/data/agent
export SERVICEMAN_LOG_DIR=none
export SERVICEMAN_DOCKER=false SERVICEMAN_TAILSCALE=false SERVICEMAN_APT=false
unset SERVICEMAN_TOKEN SERVICEMAN_HOST_KEY
# systemd gives the agent a short PATH; node is looked for where the agent's installer looks too
export PATH=$PATH:\${HOME-}/bin:\${HOME-}/.local/bin:/usr/local/bin:/opt/node/bin
exec node modules/file_manager/app/index.js
`;

// A file browser: serviceman's own File Manager put on a machine as an app folder of its own,
// over the folder picked, a folder kept for it there or one of that machine. It is a program on
// the machine, run by node, which the agent runs on: the files it carries are the ones the
// app says it is made of (modules/file_manager/app/index.js --files), as bin/file-manager-zip
// packs them. A new name becomes a program at the names an app of files gets, its folder its
// Data tab's first row; a name taken is refused.
//
//     given   {remote, path}: the machine; path null for a folder kept for it
//
//     {service, made, address, public}, as app_files_put says it
async function app_file_browser_put(app, name, given)
{
    if (RE_NAME.test(name) === false) {
        throw failure(400, `${name}: an app's name is lowercase letters, digits, - and _`);
    }
    if (app.service_by_name[name] !== undefined) {
        throw failure(409, `${name} is taken: pick another name for the app`);
    }
    const remote = app.remote_by_name[String(given.remote)];
    if (remote === undefined) {
        throw failure(400, `no machine named ${JSON.stringify(String(given.remote))} is in the config`);
    }
    if (remote.state.phase !== 'online') {
        throw failure(409, `${remote.name} is offline`);
    }
    if ((remote_can(remote, 'tar_put') === false) || (remote.state.resources === null) || (typeof remote.state.resources.services !== 'string')) {
        throw failure(409, `${remote.name} has an agent from before files come in one tar: its page says how it updates`);
    }
    if (app.config.path === undefined) {
        throw failure(409, 'serviceman runs without a config file, so a new app cannot be written into it');
    }
    const where = ((given.path === undefined) || (given.path === null) || (given.path === '')) ? null : String(given.path);
    const folder = path.posix.join(remote.state.resources.services, name);
    const disk = remote_disk(app, remote);
    const there = await disk.list(folder).catch(() => null);
    if ((there !== null) && (there.items.length > 0)) {
        throw failure(409, `${folder} on ${remote.name} holds files already, left by another app: give this one another name`);
    }
    // The entry is checked before anything is sent: a folder the config refuses sends nothing
    const port = await port_free(app, remote);
    const hosts = app_files_put.hosts(app, name);
    const entry = {name, type: 'shell', remote: remote.name, command: 'bin/run', cwd: folder, publish: Object.assign((hosts.length === 1) ? {host: hosts[0]} : {hosts}, {port}), folders: [{path: where, env: 'FILES_DIR'}]};
    await config_locked(app, () => config_check(app, entry));
    const items = items_of();
    await disk.write_tar(folder, tar_stream(items));
    await config_locked(app, () => config_put(app, entry));
    log_event(app, 'app_file_browser_put', {service: name, remote: remote.name, folder: (where === null) ? 'kept' : where, port, files: items.filter(v => v.dir !== true).length});
    const service = app.service_by_name[name];
    return Object.assign({service, made: true}, app_address_of(app, service));
}

// Its files, read from serviceman's own folder: the app's, the licences of what it carries, bin/run
function items_of()
{
    const listed = child_process.execFileSync(process.execPath, [path.join(ROOT, 'modules', 'file_manager', 'app', 'index.js'), '--files'], {cwd: ROOT, encoding: 'utf8'}).split('\n').filter(v => v !== '');
    const files = listed.concat(['LICENSE', 'node_modules/@vbarbarosh/node-helpers/LICENSE']);
    const now = Math.floor(Date.now()/1000);
    const dirs = new Set(['bin']);
    for (const file of files) {
        for (let at = file.indexOf('/'); at !== -1; at = file.indexOf('/', at + 1)) {
            dirs.add(file.slice(0, at));
        }
    }
    const out = [...dirs].sort().map(v => ({path: v, dir: true, mtime_s: now}));
    for (const file of files) {
        const full = path.join(ROOT, file);
        const stat = fs.statSync(full);
        out.push({path: file, mode: stat.mode & 0o777, mtime_s: now, size: stat.size, stream: () => fs.createReadStream(full)});
    }
    const run = Buffer.from(RUN);
    out.push({path: 'bin/run', mode: 0o755, mtime_s: now, size: run.length, stream: () => [run]});
    return out;
}

// The first port from PORT_FIRST that no program of serviceman's is given and the machine does
// not listen on now
async function port_free(app, remote)
{
    const taken = new Set(app.services.filter(v => v.type === 'shell').map(v => v.port));
    if (remote_can(remote, 'port_list')) {
        const listed = await remote_call(app, remote, 'port_list', {}, PORT_LIST_TIMEOUT_MS).catch(() => ({items: []}));
        for (const item of listed.items) {
            taken.add(item.port);
        }
    }
    let out = PORT_FIRST;
    while (taken.has(out)) {
        out++;
    }
    return out;
}

// The config with the app in it, read as serviceman reads it: a folder it refuses is said, and
// nothing is written
async function config_check(app, entry)
{
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    json.services = (json.services || []).concat([entry]);
    try {
        config_from_file(app, json);
    }
    catch (error) {
        throw failure(400, error.message.replace(/^services\[\d+\]\./, ''));
    }
}

// The app in the config file, applied the way a Save applies one
async function config_put(app, entry)
{
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    json.services = json.services || [];
    if (json.services.some(v => v.name === entry.name)) {
        throw failure(409, `${entry.name} is taken: pick another name for the app`);
    }
    json.services.push(entry);
    const config = config_from_file(app, json);
    await config_file_save(app.config.path, `${JSON.stringify(json, null, 4)}\n`);
    await app_apply_config(app, config);
}

function failure(status, text)
{
    return Object.assign(new Error(text), {status});
}

module.exports = app_file_browser_put;
