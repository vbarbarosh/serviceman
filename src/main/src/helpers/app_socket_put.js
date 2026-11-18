const app_apply_config = require('./app_apply_config');
const app_files_put = require('./app_files_put');
const app_socket_token_refusal = require('./app_socket_token_refusal');
const config_file_save = require('./config_file_save');
const config_from_file = require('./config_from_file');
const config_locked = require('./config_locked');
const fs = require('fs');
const log_event = require('./log_event');
const socket_place = require('./socket_place');

const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

// An app reached through a socket file: its program, on a machine or on serviceman's side,
// listens on that file, and serviceman answers the app's names by passing every request into
// it. No files and no port: serviceman starts nothing, it is the app's own to run. A new name
// becomes an external service at the names an app of files gets (app_files_put.hosts); a name
// that is such an app already takes its new socket or machine, its names as they are.
//
//     given   {socket, remote}: the path, from / or ~/, and the machine it is on; '' or null
//             for serviceman's own side, where a path may be inside its state folder too
//             (socket_place)
//     token   the control token the call came with, undefined for the owner: a token puts an
//             app on a machine it sees alone, at the socket named after the app
//             (app_socket_token_refusal)
//
//     {service, made, local, public}, as app_files_put says it
async function app_socket_put(app, name, given, token)
{
    if (RE_NAME.test(name) === false) {
        throw failure(400, `${name}: an app's name is lowercase letters, digits, - and _`);
    }
    const typed = (typeof given.socket === 'string') ? given.socket.trim() : '';
    const remote = ((typeof given.remote === 'string') && (given.remote !== '')) ? given.remote : null;
    // On serviceman's own side a path is in its state folder, typed as the cards say it or not
    const socket = (remote === null) ? socket_place.typed(app, typed) : typed;
    if ((remote !== null) && (socket.startsWith('/') === false) && (socket.startsWith('~/') === false)) {
        throw failure(400, `the socket is the path of the file the app listens on there, from / or from ~/ (got ${JSON.stringify(given.socket)})`);
    }
    if (socket === '') {
        throw failure(400, 'the socket is the path of the file the app listens on');
    }
    if ((remote !== null) && (app.remote_by_name[remote] === undefined)) {
        throw failure(400, `no machine named ${remote} is in the config`);
    }
    const kept = app_socket_token_refusal(app, token, name, socket, remote);
    if (kept !== null) {
        throw failure(403, `the token ${JSON.stringify(token.label)} ${kept}`);
    }
    const before = app.service_by_name[name];
    if ((before !== undefined) && ((before.type !== 'external') || (before.upstream.socket === undefined))) {
        throw failure(409, `${name} is a service of another kind already: pick another name for the app`);
    }
    if (app.config.path === undefined) {
        throw failure(409, 'serviceman runs without a config file, so a new app cannot be written into it');
    }
    await config_locked(app, () => config_put(app, name, socket, remote));
    log_event(app, 'app_socket_put', {service: name, made: (before === undefined), socket, remote});
    const service = app.service_by_name[name];
    const domain = app.config.apps.domain;
    const hosts = service.hosts.map(v => v.split('/')[0]);
    const under = hosts.find(v => (domain !== null) && v.endsWith(`.${domain}`));
    return {service, made: (before === undefined), local: hosts.find(v => v !== under) || hosts[0], public: (under === undefined) ? null : under};
}

// The app in the config file, new or with its socket and machine changed, applied the way a Save
// applies one
async function config_put(app, name, socket, remote)
{
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    json.services = json.services || [];
    const at = json.services.findIndex(v => v.name === name);
    let entry;
    if (at === -1) {
        const hosts = app_files_put.hosts(app, name);
        entry = {name, type: 'external', publish: (hosts.length === 1) ? {host: hosts[0]} : {hosts}};
        json.services.push(entry);
    }
    else {
        entry = json.services[at];
        delete entry.remotes;
    }
    delete entry.remote;
    if (remote !== null) {
        entry.remote = remote;
    }
    entry.socket = socket;
    let config;
    try {
        config = config_from_file(app, json);
    }
    catch (error) {
        throw failure(400, error.message);
    }
    await config_file_save(app.config.path, `${JSON.stringify(json, null, 4)}\n`);
    await app_apply_config(app, config);
}

function failure(status, text)
{
    return Object.assign(new Error(text), {status});
}

module.exports = app_socket_put;
