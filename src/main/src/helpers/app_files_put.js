const app_apply_config = require('./app_apply_config');
const config_file_save = require('./config_file_save');
const config_from_file = require('./config_from_file');
const config_locked = require('./config_locked');
const files_zip_items = require('./files_zip_items');
const fs = require('fs');
const log_event = require('./log_event');
const path = require('path');
const service_files_folder = require('./service_files_folder');
const stream = require('stream');

const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

// What a service of another kind is, in the New service form's words
const KIND_WORDS = {docker: 'a docker image', shell: 'a program', external: 'something already running'};

// An app of files sent to serviceman as a zip: its files written beside its folder, then swapped
// in whole, so a visitor meets the old version or the new one and never half of each. A name
// serviceman has not seen yet becomes a folder of files in the config, the way the New service
// form would write it, at its names (app_files_hosts): the one beside serviceman's own, which the
// computer serviceman runs on reaches with no DNS at all, and the one under the apps domain, for
// outside. A zip that is broken or no page changes nothing; one app takes one zip at a time.
//
//     zip     the path of the zip on this host's disk
//     signal  aborts the writing when the sender hangs up
//
//     {service, made, files, bytes, local, public}
//     made    true when the name was new
//     local   its name here, notes.localhost; public its name under the apps domain, or null
async function app_files_put(app, name, zip, signal)
{
    if (RE_NAME.test(name) === false) {
        throw failure(400, `${name}: an app's name is lowercase letters, digits, - and _`);
    }
    const before = app.service_by_name[name];
    if ((before !== undefined) && (before.type !== 'files')) {
        const way = (before.type === 'shell') ? `: a new version of an app folder goes to /api/v1/services/${name}/zip` : '';
        throw failure(409, `${name} is ${KIND_WORDS[before.type] || before.type}, not a folder of files${way}`);
    }
    if ((before === undefined) && (app.config.path === undefined)) {
        throw failure(409, 'serviceman runs without a config file, so a new app cannot be written into it');
    }
    if (app.files_sending.has(name)) {
        throw failure(409, `${name} is taking another zip now: one goes at a time`);
    }
    app.files_sending.add(name);
    try {
        let items;
        try {
            items = await files_zip_items(`${name}.zip`, zip);
        }
        catch (error) {
            throw failure(400, error.message);
        }
        const folder = (before === undefined) ? path.resolve(app.state_dir, 'apps', name) : service_files_folder(app, before);
        await folder_write(`${folder}.new`, items.items, signal);
        await folder_swap(folder);
        if (before === undefined) {
            await config_locked(app, () => config_add(app, name));
        }
        log_event(app, 'app_files_put', {service: name, made: (before === undefined), files: items.files, bytes: items.bytes});
        const service = app.service_by_name[name];
        const domain = app.config.apps.domain;
        const hosts = service.hosts.map(v => v.split('/')[0]);
        const under = hosts.find(v => (domain !== null) && v.endsWith(`.${domain}`));
        return {service, made: (before === undefined), files: items.files, bytes: items.bytes, local: hosts.find(v => v !== under) || hosts[0], public: (under === undefined) ? null : under};
    }
    finally {
        app.files_sending.delete(name);
    }
}

// Every file, from the zip to the disk, into a folder made fresh for them; what was half
// written when the sender hung up goes
async function folder_write(target, items, signal)
{
    await fs.promises.rm(target, {recursive: true, force: true});
    await fs.promises.mkdir(target, {recursive: true});
    try {
        for (const item of items) {
            const file = path.join(target, item.path);
            if (item.dir) {
                await fs.promises.mkdir(file, {recursive: true});
                continue;
            }
            await fs.promises.mkdir(path.dirname(file), {recursive: true});
            await stream.promises.pipeline(item.stream(), fs.createWriteStream(file, {mode: item.mode}), {signal});
        }
    }
    catch (error) {
        await fs.promises.rm(target, {recursive: true, force: true});
        throw error;
    }
}

// <folder>.new in the place of <folder>; the old version goes once the new one is in
async function folder_swap(folder)
{
    const old = `${folder}.old`;
    await fs.promises.rm(old, {recursive: true, force: true});
    const there = await fs.promises.stat(folder).then(() => true, () => false);
    if (there) {
        await fs.promises.rename(folder, old);
    }
    await fs.promises.rename(`${folder}.new`, folder);
    await fs.promises.rm(old, {recursive: true, force: true});
}

// The new app in the config file, as one more service, applied the way a Save applies one
async function config_add(app, name)
{
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    if ((json.services || []).some(v => v.name === name)) {
        return;
    }
    const hosts = app_files_hosts(app, name);
    const publish = (hosts.length === 1) ? {host: hosts[0]} : {hosts};
    json.services = (json.services || []).concat([{name, type: 'files', publish}]);
    const config = config_from_file(app, json);
    await config_file_save(app.config.path, `${JSON.stringify(json, null, 4)}\n`);
    await app_apply_config(app, config);
}

// An app's names: notes.apps.example.com under the config's apps domain, for outside, and
// always the one the New service form would give it, notes.localhost beside
// serviceman.localhost, which the computer serviceman runs on reaches by itself. A hostname has
// no _ in it.
//
//     [domain name, local name], or [local name] with no apps domain
function app_files_hosts(app, name)
{
    const label = name.replace(/_/g, '-');
    const host = (typeof app.config.control.host === 'string') ? app.config.control.host : 'localhost';
    const at = host.indexOf('.');
    const local = `${label}.${(at === -1) ? host : host.slice(at + 1)}`;
    return (app.config.apps.domain === null) ? [local] : [`${label}.${app.config.apps.domain}`, local];
}

function failure(status, text)
{
    return Object.assign(new Error(text), {status});
}

app_files_put.hosts = app_files_hosts;

module.exports = app_files_put;
