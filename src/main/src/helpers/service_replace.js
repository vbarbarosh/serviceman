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
const service_hold = require('./service_hold');
const service_phase = require('./service_phase');
const service_try_again = require('./service_try_again');

// Ten minutes, as an install: bin/configure may fetch everything an app needs, and bin/build
// build it
const CONFIGURE_TIMEOUT_MS = 600000;

// An app folder takes a new version of itself. Its files were sent beside it, to <folder>.new.
// The app is stopped first, whatever it was doing: every instance, no restart waiting, and
// every start asked meanwhile — a request, a restart timer, a person — waits for the replace,
// so bin/run never meets a folder whose bin/configure has not finished. Then <folder>.new
// becomes the folder, data/ is moved over from the old one, over any data/ the new files
// brought, the old one goes, bin/configure and bin/build run in it, and the new version is
// started, whatever the app was doing before.
//
// There is no way back to the old version once the folders are swapped. A new version that
// cannot be set up stays in place, its data/ in it, and the service says why it failed; it is
// not started until somebody asks, since bin/run in a folder that is not set up is a crash.
//
// A data/ the new files brought is never merged into the app's: a folder picked from a working
// copy brings that machine's own saves, keys and logs. It is set aside whole, and said:
//
//     {data_dropped}  true when the new files brought a data/ of their own and the app's own
//                     was kept in its place
async function service_replace(app, service)
{
    const folder = service_app_folder(service);
    if (folder === null) {
        throw status_error(400, `${service.name} is not an app folder: only a program run as bin/run in a folder of its own takes a new version`);
    }
    // A start on the way is no reason to wait: it is stopped like the rest
    if (service.state.work !== null) {
        throw status_error(409, `${service.name} is busy ${service.state.work}: try again when it is done`);
    }
    const instance = service.state.instances[0];
    log_event(app, 'service_replace_begin', {service: service.name, folder, was: service_phase(service)});
    service.state.work = 'taking its new version';
    service.state.doing = service.state.work;
    service.state.said = [];
    let data_dropped = false;
    try {
        const remote = (instance.remote === null) ? remote_reserve(app, service, instance, []) : remote_from_instance(app, service, instance);
        await folder_check(app, remote, folder);
        await service_hold(app, service, 'a new version is put in its place', async function () {
            data_dropped = await folder_swap(app, remote, folder);
            await configure(app, remote, service, folder).catch(function (error) {
                set_up_failed(service, error);
                throw error;
            });
            // A different program now: whatever it gave up on before is history, and the
            // starts that waited for the replace find it so
            service_try_again(app, service);
        });
        service.state.doing = 'starting its new version';
        await service_ensure_running(app, service);
    }
    catch (error) {
        log_event(app, 'service_replace_end_error', {service: service.name, reason: error.message, data_dropped});
        throw error;
    }
    finally {
        service.state.work = null;
        service.state.doing = null;
    }
    log_event(app, 'service_replace_end_ok', {service: service.name, data_dropped});
    return {data_dropped};
}

// Refused before anything is stopped: there is nothing to put in place, or a replace before
// this one did not finish
async function folder_check(app, remote, folder)
{
    const disk = remote_disk(app, remote);
    if (await exists(disk, `${folder}.new`) === false) {
        throw status_error(409, `no new version waits at ${folder}.new: its files go there first`);
    }
    if (await exists(disk, `${folder}.old`)) {
        throw status_error(409, `${folder}.old is left from a replacement that did not finish: look in it, and remove it once nothing in it is needed`);
    }
}

// The new files become the folder, and data/ comes over from the old one. A rename that fails
// before the new folder is in place puts the old one back, so the app is never without one.
// True when a data/ the new files brought went, for the app's own.
async function folder_swap(app, remote, folder)
{
    const disk = remote_disk(app, remote);
    const fresh = `${folder}.new`;
    const old = `${folder}.old`;
    await disk.rename(folder, old);
    try {
        await disk.rename(fresh, folder);
    }
    catch (error) {
        await disk.rename(old, folder);
        throw error;
    }
    const data = `${folder}/data`;
    let out = false;
    if (await exists(disk, `${old}/data`)) {
        if (await exists(disk, data)) {
            await disk.remove(data);
            out = true;
        }
        await disk.rename(`${old}/data`, data);
    }
    await disk.remove(old);
    return out;
}

// The new version is in place and not set up. It is not started by anything but a person
// asking: a request that waited for the replace is told why, instead of starting bin/run.
function set_up_failed(service, error)
{
    service.state.last_error = `${error.message} — the new version is in place, but not set up`;
    service.state.failures = 0;
    service.state.gave_up_at = Date.now();
}

// The install line when the app has one, which marks the folder as installed: the line the
// New service form gives an app folder runs bin/configure, then bin/build, for those it holds.
// An app with no line, or with bin/configure alone as the form gave it before, gets those
// steps here instead, for the ones its new version brings.
async function configure(app, remote, service, folder)
{
    const disk = remote_disk(app, remote);
    const bin = await disk.list(`${folder}/bin`).catch(() => ({items: []}));
    let steps = ['configure', 'build'].filter(v => bin.items.some(vv => vv.name === v));
    if (service.lifecycle.install !== null) {
        await program_install(app, remote, service, true);
        steps = (service.lifecycle.install === 'bin/configure') ? steps.filter(v => v === 'build') : [];
    }
    for (const step of steps) {
        const secrets = await secrets_deliver(app, remote, service);
        const answer = await remote_call(app, remote, 'program_step', {service: service.name, cwd: folder, line: `bin/${step}`, env: program_env(service), image: service.image, user: service.user, secrets}, CONFIGURE_TIMEOUT_MS);
        if (answer.ok === false) {
            throw new Error(`${service.name}: bin/${step} failed — ${answer.stderr}`);
        }
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
