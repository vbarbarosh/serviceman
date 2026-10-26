const app_zip_items = require('./app_zip_items');
const fs = require('fs');
const log_event = require('./log_event');
const remote_can = require('./remote_can');
const remote_disk = require('./remote_disk');
const remote_from_instance = require('./remote_from_instance');
const service_app_folder = require('./service_app_folder');
const service_replace = require('./service_replace');
const tar_stream = require('./tar_stream');

// An app folder takes a new version sent as a zip, in one call: what the page does in three
// when a zip is picked on it. The zip is read here, its data/ left out, its files sent beside
// the folder to <folder>.new as one tar (what a try before left there goes first), and
// service_replace puts them in the folder's place, sets them up and starts the app. The caller
// hears when the new version runs, or what failed: a zip that is no app is refused before
// anything is sent, with the sentence the page would show, as error.status 400; what the swap
// refuses or fails at comes with its own status.
//
// The service is busy from the first step: a second zip sent meanwhile is refused with 409,
// since clearing <folder>.new under one still being written leaves that one half its files.
//
//     zip     the path of the zip, read from the disk a file at a time
//     token   the control token the call came with, undefined for the owner: it may send a new
//             version only to a machine it sees, and only to the apps it is kept to, if any
//
//     {data_dropped, data_files, files, bytes}
//     data_dropped  what service_replace says: a data/ among the new files was set aside
//     data_files    how many files the zip's own data/ held, left out here; null when none
//     files, bytes  what went to the machine
async function service_zip_replace(app, service, zip, token)
{
    const folder = service_app_folder(service);
    if (folder === null) {
        throw status_error(400, `${service.name} is not an app folder: only a program run as bin/run in a folder of its own takes a new version`);
    }
    if (service.state.work !== null) {
        throw status_error(409, `${service.name} is busy ${service.state.work}: try again when it is done`);
    }
    log_event(app, 'service_zip_begin', {service: service.name, bytes: fs.statSync(zip).size});
    service.state.work = 'receiving its new version';
    service.state.doing = service.state.work;
    try {
        let read;
        try {
            read = await items_read(service, zip);
            const remote = remote_from_instance(app, service, service.state.instances[0]);
            if ((token !== undefined) && (token.remotes.includes('*') === false) && (token.remotes.includes(remote.name) === false)) {
                throw status_error(403, `the token ${JSON.stringify(token.label)} may not see ${remote.name}`);
            }
            if ((token !== undefined) && Array.isArray(token.services) && (token.services.length > 0) && (token.services.includes(service.name) === false)) {
                throw status_error(403, `the token ${JSON.stringify(token.label)} may not send a new version of ${service.name}: it is for ${token.services.join(', ')}`);
            }
            if (remote_can(remote, 'tar_put') === false) {
                throw status_error(501, `the agent on ${remote.name} is from before files come in one tar — its page says how it updates`);
            }
            const disk = remote_disk(app, remote);
            await folder_clear(disk, `${folder}.new`);
            await disk.write_tar(`${folder}.new`, tar_stream(read.items));
        }
        finally {
            service.state.work = null;
            service.state.doing = null;
        }
        // Nothing waits between the two: service_replace takes the service before its first
        // await, so no other zip comes between the files sent and their swap
        const done = await service_replace(app, service);
        log_event(app, 'service_zip_end_ok', {service: service.name, files: read.files, bytes: read.bytes, data_files: read.data_files});
        return {data_dropped: done.data_dropped, data_files: read.data_files, files: read.files, bytes: read.bytes};
    }
    catch (error) {
        log_event(app, 'service_zip_end_error', {service: service.name, reason: error.message});
        throw error;
    }
}

// The zip as its files, or the refusal: a zip that is no app is the sender's to fix
async function items_read(service, zip)
{
    try {
        return await app_zip_items(`${service.name}.zip`, zip);
    }
    catch (error) {
        throw status_error(400, error.message);
    }
}

// Whatever a try before left at <folder>.new goes, so the new version is these files alone
async function folder_clear(disk, asked)
{
    try {
        await disk.remove(asked);
    }
    catch (error) {
        if (/ENOENT/.test(error.message) === false) {
            throw error;
        }
    }
}

function status_error(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
}

module.exports = service_zip_replace;
