const body_json = require('../body_json');
const log_event = require('../helpers/log_event');
const path = require('path');
const remote_call = require('../helpers/remote_call');
const remote_can = require('../helpers/remote_can');
const send_json = require('../helpers/send_json');
const shared_home_address = require('../helpers/shared_home_address');
const shared_read = require('../helpers/shared_read');
const shared_secrets_make = require('../helpers/shared_secrets_make');
const shared_table = require('../helpers/shared_table');
const shared_tell = require('../helpers/shared_tell');
const shared_write = require('../helpers/shared_write');

const BODY_LIMIT_BYTES = 16*1024;
// The home's two ports on its tailnet address, out of the way of a Redis or an S3 of its own
const REDIS_PORT = 16379;
const S3_PORT = 13900;
// Pulling two images and making the volume the first time: minutes
const HOME_TIMEOUT_MS = 1200000;
const FOLDER_TIMEOUT_MS = 120000;
// The page asks what each machine has mounted; a machine that thinks longer is shown as it last said
const STATUS_TIMEOUT_MS = 8000;
const RE_FOLDER_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RE_FOLDER = /^\/api\/v1\/shared-folders\/folders\/([^/]+)$/;
const RE_MOUNT = /^\/api\/v1\/shared-folders\/folders\/([^/]+)\/mounts\/([^/]+)$/;
const PATHS_REFUSED = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var/lib/serviceman'];

// GET /api/v1/shared-folders (query)                          the home, the folders, each mount as its machine says it stands; live=0 as last said
// POST /api/v1/shared-folders/home (body)                     {remote}: Redis and Garage set up there, the volume made
// POST /api/v1/shared-folders/folders (body)                  {name}: a new folder
// DELETE /api/v1/shared-folders/folders/<name> (body)         {name} typed again: the folder and every file in it
// PUT /api/v1/shared-folders/folders/<name>/mounts/<remote> (body)  {path, mode}: mounted there, rw or ro
// DELETE /api/v1/shared-folders/folders/<name>/mounts/<remote>     unmounted there
//
// True when the request was one of these. The owner's alone: the home's secrets are behind it.
async function handle_shared_folders(app, req, res, url)
{
    if ((url.pathname === '/api/v1/shared-folders') && (req.method === 'GET')) {
        send_json(res, 200, await view_of(app, url.searchParams.get('live') !== '0'));
        return true;
    }
    if ((url.pathname === '/api/v1/shared-folders/home') && (req.method === 'POST')) {
        await home_set(app, req, res);
        return true;
    }
    if ((url.pathname === '/api/v1/shared-folders/folders') && (req.method === 'POST')) {
        await folder_create(app, req, res);
        return true;
    }
    const folder = RE_FOLDER.exec(url.pathname);
    if ((folder !== null) && (req.method === 'DELETE')) {
        await folder_delete(app, req, res, decodeURIComponent(folder[1]));
        return true;
    }
    const mount = RE_MOUNT.exec(url.pathname);
    if ((mount !== null) && (req.method === 'PUT')) {
        await mount_set(app, req, res, decodeURIComponent(mount[1]), decodeURIComponent(mount[2]));
        return true;
    }
    if ((mount !== null) && (req.method === 'DELETE')) {
        mount_remove(app, res, decodeURIComponent(mount[1]), decodeURIComponent(mount[2]));
        return true;
    }
    return false;
}

// The home: set up once, on a machine with docker, a root half and a tailnet address. A home
// that failed may be tried again, there or elsewhere; one that is ready stays where it is.
async function home_set(app, req, res)
{
    const body = await body_json(req, BODY_LIMIT_BYTES);
    const shared = shared_read(app);
    if ((shared.home !== null) && (shared.home.phase === 'ready')) {
        send_json(res, 409, {error: `the home is on ${shared.home.remote} already`});
        return;
    }
    if (app.shared_home_job === true) {
        send_json(res, 409, {error: 'the home is being set up'});
        return;
    }
    const remote = app.remote_by_name[String(body.remote)];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(String(body.remote))}`});
        return;
    }
    const why = home_refusal(remote);
    if (why !== null) {
        send_json(res, 409, {error: `${remote.name} ${why}`});
        return;
    }
    // Tried again on the same machine, it keeps its secrets: a Redis made there already asks for them
    const secrets = ((shared.home !== null) && (shared.home.remote === remote.name)) ? shared.home.secrets : shared_secrets_make();
    shared.home = {remote: remote.name, address: shared_home_address(remote), redis_port: REDIS_PORT, s3_port: S3_PORT, secrets, phase: 'setting_up', error: null, at: new Date().toISOString()};
    shared_write(app, shared);
    app.shared_home_job = true;
    send_json(res, 202, await view_of(app, false));
    home_up(app, remote).finally(function () {
        app.shared_home_job = false;
    });
}

async function home_up(app, remote)
{
    const home = shared_read(app).home;
    log_event(app, 'shared_home_begin', {remote: remote.name, address: home.address});
    let answer;
    try {
        answer = await remote_call(app, remote, 'shared', {action: 'home_up', home: {address: home.address, redis_port: home.redis_port, s3_port: home.s3_port, secrets: home.secrets}}, HOME_TIMEOUT_MS);
        if (answer.ok === false) {
            throw new Error(answer.error);
        }
    }
    catch (error) {
        const shared = shared_read(app);
        shared.home.phase = 'failed';
        shared.home.error = error.message;
        shared_write(app, shared);
        log_event(app, 'shared_home_end_error', {remote: remote.name, reason: error.message});
        return;
    }
    const shared = shared_read(app);
    shared.home.phase = 'ready';
    shared.home.error = null;
    shared.home.at = new Date().toISOString();
    shared_write(app, shared);
    log_event(app, 'shared_home_end_ok', {remote: remote.name, address: home.address});
    await shared_tell(app);
}

async function folder_create(app, req, res)
{
    const body = await body_json(req, BODY_LIMIT_BYTES);
    const name = String((body.name === undefined) ? '' : body.name);
    if (RE_FOLDER_NAME.test(name) === false) {
        send_json(res, 400, {error: 'a shared folder\'s name is up to 40 small letters, digits and hyphens'});
        return;
    }
    if (shared_read(app).folders.some(v => v.name === name)) {
        send_json(res, 409, {error: `there is a shared folder called "${name}" already`});
        return;
    }
    const answer = await home_ask(app, res, {action: 'folder_create', name});
    if (answer === null) {
        return;
    }
    const shared = shared_read(app);
    if (shared.folders.some(v => v.name === name) === false) {
        shared.folders.push({name, created: new Date().toISOString()});
        shared_write(app, shared);
    }
    log_event(app, 'shared_folder_created', {folder: name});
    send_json(res, 200, await view_of(app, false));
}

// For good, every file in it: asked with its name typed again, and only once no machine mounts it
async function folder_delete(app, req, res, name)
{
    const body = await body_json(req, BODY_LIMIT_BYTES);
    const shared = shared_read(app);
    if (shared.folders.some(v => v.name === name) === false) {
        send_json(res, 404, {error: `there is no shared folder called "${name}"`});
        return;
    }
    if (body.name !== name) {
        send_json(res, 400, {error: `the folder's name, typed again, says it is "${name}" that goes`});
        return;
    }
    const on = shared.mounts.filter(v => v.folder === name).map(v => v.remote);
    if (on.length > 0) {
        send_json(res, 409, {error: `"${name}" is mounted on ${on.join(', ')}; unmount it there first`});
        return;
    }
    const answer = await home_ask(app, res, {action: 'folder_delete', name});
    if (answer === null) {
        return;
    }
    const after = shared_read(app);
    after.folders = after.folders.filter(v => v.name !== name);
    shared_write(app, after);
    log_event(app, 'shared_folder_deleted', {folder: name});
    send_json(res, 200, await view_of(app, false));
}

// Where a folder is on one machine, and how: the machine is told at once when it is online, and
// at its next hello when it is not
async function mount_set(app, req, res, folder, name)
{
    const body = await body_json(req, BODY_LIMIT_BYTES);
    const shared = shared_read(app);
    if (shared.folders.some(v => v.name === folder) === false) {
        send_json(res, 404, {error: `there is no shared folder called "${folder}"`});
        return;
    }
    if (app.remote_by_name[name] === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    const where = String((body.path === undefined) ? '' : body.path).trim();
    const refused = path_refusal(where);
    if (refused !== null) {
        send_json(res, 400, {error: refused});
        return;
    }
    if ((body.mode !== 'rw') && (body.mode !== 'ro')) {
        send_json(res, 400, {error: 'a mount\'s mode is rw or ro'});
        return;
    }
    const taken = shared.mounts.find(v => (v.remote === name) && (v.path === where) && (v.folder !== folder));
    if (taken !== undefined) {
        send_json(res, 409, {error: `${where} on ${name} is where "${taken.folder}" is mounted`});
        return;
    }
    const nested = shared.mounts.find(v => (v.remote === name) && (v.folder !== folder) && (where.startsWith(`${v.path}/`) || v.path.startsWith(`${where}/`)));
    if (nested !== undefined) {
        send_json(res, 409, {error: `${where} on ${name} is inside or around ${nested.path}, where "${nested.folder}" is mounted`});
        return;
    }
    // A changed mount keeps its place in the list; a new one goes last
    const mount = {folder, remote: name, path: where, mode: body.mode};
    const at = shared.mounts.findIndex(v => (v.remote === name) && (v.folder === folder));
    if (at === -1) {
        shared.mounts.push(mount);
    }
    else {
        shared.mounts[at] = mount;
    }
    shared_write(app, shared);
    log_event(app, 'shared_mount_set', {folder, remote: name, path: where, mode: body.mode});
    send_json(res, 200, await view_of(app, false));
    shared_tell(app);
}

function mount_remove(app, res, folder, name)
{
    const shared = shared_read(app);
    const found = shared.mounts.find(v => (v.remote === name) && (v.folder === folder));
    if (found === undefined) {
        send_json(res, 404, {error: `"${folder}" is not mounted on ${name}`});
        return;
    }
    shared.mounts = shared.mounts.filter(v => v !== found);
    shared_write(app, shared);
    log_event(app, 'shared_mount_removed', {folder, remote: name, path: found.path});
    send_json(res, 200, {});
    shared_tell(app);
}

// One thing of the home's machine, with the access a folder needs; null once refused here
async function home_ask(app, res, params)
{
    const home = shared_read(app).home;
    if ((home === null) || (home.phase !== 'ready')) {
        send_json(res, 409, {error: 'the shared folders have no home yet'});
        return null;
    }
    const remote = app.remote_by_name[home.remote];
    if ((remote === undefined) || (remote.state.phase !== 'online')) {
        send_json(res, 409, {error: `${home.remote}, the home of the shared folders, is not connected`});
        return null;
    }
    const meta = {address: home.address, port: home.redis_port, password: home.secrets.redis_password};
    const answer = await remote_call(app, remote, 'shared', Object.assign({meta, passphrase: home.secrets.passphrase}, params), FOLDER_TIMEOUT_MS);
    if (answer.ok === false) {
        send_json(res, answer.status || 502, {error: answer.error});
        return null;
    }
    return answer;
}

// What the page shows: the home without its secrets, the folders with a row per machine, and
// the machines that may be picked. `live` asks each machine how its mounts stand now.
async function view_of(app, live)
{
    const shared = shared_read(app);
    const home = shared.home;
    // A home left half set up by a serviceman that restarted is a home that failed
    const stale = (home !== null) && (home.phase === 'setting_up') && (app.shared_home_job !== true);
    const answers = live ? await statuses_read(app, shared) : {};
    const machines = app.remotes.map(v => ({name: v.name, title: v.title || v.name, phase: v.state.phase, mount_why: mount_refusal(v), home_why: home_refusal(v)}));
    const folders = shared.folders.map(function (folder) {
        const mounts = shared.mounts.filter(v => v.folder === folder.name).map(v => mount_view(app, shared, answers, v));
        return {name: folder.name, created: folder.created, mounts};
    });
    return {
        home: (home === null) ? null : {
            remote: home.remote,
            title: title_of(app, home.remote),
            address: home.address,
            redis_port: home.redis_port,
            s3_port: home.s3_port,
            phase: stale ? 'failed' : home.phase,
            error: stale ? 'serviceman restarted while it was being set up; set it up again' : home.error,
            at: home.at,
            online: (app.remote_by_name[home.remote] !== undefined) && (app.remote_by_name[home.remote].state.phase === 'online'),
        },
        folders,
        machines,
    };
}

function mount_view(app, shared, answers, mount)
{
    const row = {remote: mount.remote, title: title_of(app, mount.remote), path: mount.path, mode: mount.mode};
    const remote = app.remote_by_name[mount.remote];
    if (remote === undefined) {
        return Object.assign(row, {state: 'gone', error: `${mount.remote} is no longer one of the machines`});
    }
    if ((shared.home === null) || (shared.home.phase !== 'ready')) {
        return Object.assign(row, {state: 'waiting', error: 'waits for the home to be set up'});
    }
    if (remote.state.phase !== 'online') {
        return Object.assign(row, {state: 'waiting', error: `waits for ${row.title} to come online`});
    }
    const why = mount_refusal(remote);
    if (why !== null) {
        return Object.assign(row, {state: 'cannot', error: `${row.title} ${why}`});
    }
    const table = shared_table(shared, mount.remote);
    if (remote.state.shared_told !== table.version) {
        if ((remote.state.shared_error !== null) && (remote.state.shared_error !== undefined) && (remote.state.shared_sending !== table.version)) {
            return Object.assign(row, {state: 'error', error: remote.state.shared_error});
        }
        return Object.assign(row, {state: 'telling'});
    }
    const said = (answers[mount.remote] === undefined) ? remote.state.shared_answer : answers[mount.remote];
    const item = ((said === undefined) || (said === null)) ? undefined : said.items.find(v => v.path === mount.path);
    if (item === undefined) {
        return Object.assign(row, {state: 'telling'});
    }
    return Object.assign(row, {state: item.state, error: item.error, users: item.users, now: item.now, used: item.used});
}

// Every machine with mounts, asked at once how they stand; one that does not answer in time is
// shown as it last said
async function statuses_read(app, shared)
{
    const out = {};
    const names = Array.from(new Set(shared.mounts.map(v => v.remote)));
    async function ask(name) {
        const remote = app.remote_by_name[name];
        if ((remote === undefined) || (remote.state.phase !== 'online') || (mount_refusal(remote) !== null)) {
            return;
        }
        try {
            const answer = await remote_call(app, remote, 'shared', {action: 'status'}, STATUS_TIMEOUT_MS);
            if (answer.ok !== false) {
                out[name] = answer;
                remote.state.shared_answer = answer;
            }
        }
        catch {
            // Shown as it last said; the row says what it said then
        }
    }
    await Promise.all(names.map(ask));
    return out;
}

// Why a machine cannot mount a shared folder now, or null when it can
function mount_refusal(remote)
{
    if (remote.state.phase !== 'online') {
        return 'is not connected';
    }
    if (remote_can(remote, 'shared') === false) {
        return 'runs an agent from before shared folders; its page says how it updates';
    }
    if (remote_can(remote, 'root') === false) {
        return 'has no root half to mount with: sudo bin/install-root in the agent\'s folder there';
    }
    return null;
}

// Why a machine cannot be the home, or null when it can
function home_refusal(remote)
{
    const why = mount_refusal(remote);
    if (why !== null) {
        return why;
    }
    if ((remote.state.resources === null) || (remote.state.resources.docker === null)) {
        return 'has no docker to run Redis and Garage in';
    }
    if (shared_home_address(remote) === null) {
        return 'has no tailnet address for the other machines to reach it at';
    }
    return null;
}

// A full path, none of the system's own folders, one level below the top at least
function path_refusal(where)
{
    if ((path.posix.isAbsolute(where) === false) || (path.posix.normalize(where) !== where) || where.endsWith('/')) {
        return 'a path is a full path, like /srv/media';
    }
    if (where === '/') {
        return 'the root of the disk is the system\'s own; a shared folder goes in a folder of its own, like /srv/shared';
    }
    if (where.split('/').length < 3) {
        return `${where} is a folder of the system's own; a shared folder goes one level deeper, like ${where}/shared`;
    }
    const under = PATHS_REFUSED.find(v => (where === v) || where.startsWith(`${v}/`));
    return (under === undefined) ? null : `${where} is under ${under}, the system's own`;
}

function title_of(app, name)
{
    const remote = app.remote_by_name[name];
    return ((remote === undefined) || (remote.title === undefined) || (remote.title === '')) ? name : remote.title;
}

module.exports = handle_shared_folders;
