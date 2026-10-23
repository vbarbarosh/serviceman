const instance_stop = require('./instance_stop');
const log_event = require('./log_event');
const program_env = require('./program_env');
const program_install = require('./program_install');
const remote_call = require('./remote_call');
const remote_disk = require('./remote_disk');
const remote_from_instance = require('./remote_from_instance');
const remote_reserve = require('./remote_reserve');
const secrets_deliver = require('./secrets_deliver');
const service_app_folder = require('./service_app_folder');
const service_ensure_running = require('./service_ensure_running');
const service_phase = require('./service_phase');
const service_try_again = require('./service_try_again');

// Ten minutes, as an install: bin/configure may fetch everything an app needs
const CONFIGURE_TIMEOUT_MS = 600000;

// An app folder takes a new version of itself. Its files were sent beside it, to <folder>.new;
// that folder becomes the app's, bin/configure runs in it, and what the app keeps, data/, is
// moved over from the old one last, over any data/ the new files brought.
//
// The old folder waits as <folder>.old until data/ is across. Whatever fails before then puts
// it back as it was, so a version that cannot be configured leaves the app as it ran, and
// data/ is never in a folder that is taken away.
async function service_replace(app, service)
{
    const folder = service_app_folder(service);
    if (folder === null) {
        throw status_error(400, `${service.name} is not an app folder: only a program run as bin/run in a folder of its own takes a new version`);
    }
    if ((service.state.doing !== undefined) && (service.state.doing !== null)) {
        throw status_error(409, `${service.name} is busy ${service.state.doing}: try again when it is done`);
    }
    const instance = service.state.instances[0];
    const running = (service_phase(service) === 'running');
    log_event(app, 'service_replace_begin', {service: service.name, folder, was: service_phase(service)});
    service.state.doing = 'taking its new version';
    service.state.said = [];
    let failed = null;
    try {
        if (running) {
            await instance_stop(app, service, instance, 'a new version is put in its place');
        }
        const remote = (instance.remote === null) ? remote_reserve(app, service, instance, []) : remote_from_instance(app, service, instance);
        await folder_replace(app, remote, service, folder);
    }
    catch (error) {
        // The app is as it was, so nothing about it failed: what failed is the new version,
        // and the page that sent it is told
        service.state.said = [];
        log_event(app, 'service_replace_end_error', {service: service.name, reason: error.message});
        failed = error;
    }
    finally {
        service.state.doing = null;
    }
    if (failed === null) {
        log_event(app, 'service_replace_end_ok', {service: service.name});
        service_try_again(app, service);
    }
    // Running before, running after: the new version, or the one it had when that failed
    if (running) {
        await service_ensure_running(app, service);
    }
    if (failed !== null) {
        throw failed;
    }
}

async function folder_replace(app, remote, service, folder)
{
    const disk = remote_disk(app, remote);
    const fresh = `${folder}.new`;
    const old = `${folder}.old`;
    if (await exists(disk, fresh) === false) {
        throw status_error(409, `no new version waits at ${fresh}: its files go there first`);
    }
    if (await exists(disk, old)) {
        throw status_error(409, `${old} is left from a replacement that did not finish: look in it, and remove it once nothing in it is needed`);
    }
    await disk.rename(folder, old);
    try {
        await disk.rename(fresh, folder);
        await configure(app, remote, disk, service, folder);
    }
    catch (error) {
        // The new version goes back where it was sent, to be looked at; the old one is the app again
        if (await exists(disk, folder)) {
            await disk.rename(folder, fresh);
        }
        await disk.rename(old, folder);
        throw error;
    }
    const data = `${folder}/data`;
    if (await exists(disk, `${old}/data`)) {
        if (await exists(disk, data)) {
            await disk.remove(data);
        }
        await disk.rename(`${old}/data`, data);
    }
    await disk.remove(old);
}

// The install line when the app has one, which marks the folder as installed; bin/configure
// itself when the app had none and the new version brings one
async function configure(app, remote, disk, service, folder)
{
    if (service.lifecycle.install !== null) {
        await program_install(app, remote, service, true);
        return;
    }
    const bin = await disk.list(`${folder}/bin`).catch(() => ({items: []}));
    if (bin.items.some(v => v.name === 'configure') === false) {
        return;
    }
    const secrets = await secrets_deliver(app, remote, service);
    const answer = await remote_call(app, remote, 'program_step', {service: service.name, cwd: folder, line: 'bin/configure', env: program_env(service), image: service.image, user: service.user, secrets}, CONFIGURE_TIMEOUT_MS);
    if (answer.ok === false) {
        throw new Error(`${service.name}: bin/configure failed — ${answer.stderr}`);
    }
}

async function exists(disk, asked)
{
    try {
        await disk.stat(asked);
        return true;
    }
    catch (error) {
        if (/ENOENT/.test(error.message)) {
            return false;
        }
        throw error;
    }
}

function status_error(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
}

module.exports = service_replace;
