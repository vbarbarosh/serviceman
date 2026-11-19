const app_address_of = require('./app_address_of');
const app_apply_config = require('./app_apply_config');
const app_files_put = require('./app_files_put');
const config_file_save = require('./config_file_save');
const config_from_file = require('./config_from_file');
const config_locked = require('./config_locked');
const fs = require('fs');
const log_event = require('./log_event');
const path = require('path');
const php_image_make = require('./php_image_make');
const remote_can = require('./remote_can');
const remote_disk = require('./remote_disk');
const tar_stream = require('./tar_stream');

const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const RE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.php$/;
// The port PHP's own server listens on inside its container
const PORT = 8080;
// Adminer 5 on is one file of this namespace, and takes plugins from adminer-plugins.php beside it
const RE_ADMINER = /\bnamespace\s+Adminer\s*;/;
const PLUGIN = path.join(__dirname, '..', '..', 'adminer', 'serviceman_database.php');

// A PHP file dropped on Apps: an app folder of its own on a machine, run in serviceman's PHP
// image (php_image_make) by PHP's own server, every request going to the file. The folder holds
// the file and bin/run; an Adminer's holds its login too (src/main/adminer), which opens it on
// the database its Data tab picks. A new name becomes a program in that image at the names an
// app of files gets (app_files_put.hosts); a name taken is refused.
//
//     file    its name as dropped, adminer.php
//     bytes   what it holds
//     remote  the machine it runs on: online, with docker its agent reaches
//
//     {service, made, address, public}, as app_files_put says it
async function app_php_put(app, name, file, bytes, remote_name)
{
    if (RE_NAME.test(name) === false) {
        throw failure(400, `${name}: an app's name is lowercase letters, digits, - and _`);
    }
    if (RE_FILE.test(file) === false) {
        throw failure(400, `${JSON.stringify(file)}: a PHP app is one .php file, its name letters, digits, ., - and _`);
    }
    if (app.service_by_name[name] !== undefined) {
        throw failure(409, `${name} is taken: pick another name for the app`);
    }
    const remote = app.remote_by_name[remote_name];
    if (remote === undefined) {
        throw failure(400, `no machine named ${JSON.stringify(remote_name)} is in the config`);
    }
    const why = machine_refusal(remote);
    if (why !== null) {
        throw failure(409, `${remote.name} ${why}`);
    }
    if (app.config.path === undefined) {
        throw failure(409, 'serviceman runs without a config file, so a new app cannot be written into it');
    }
    const folder = path.posix.join(remote.state.resources.services, name);
    const disk = remote_disk(app, remote);
    const there = await disk.list(folder).catch(() => null);
    if ((there !== null) && (there.items.length > 0)) {
        throw failure(409, `${folder} on ${remote.name} holds files already, left by another app: give this one another name`);
    }
    const items = items_of(file, bytes);
    await disk.write_tar(folder, tar_stream(items));
    await config_locked(app, () => config_put(app, name, folder, remote.name));
    log_event(app, 'app_php_put', {service: name, file, bytes: bytes.length, remote: remote.name, adminer: RE_ADMINER.test(bytes.toString('latin1'))});
    const service = app.service_by_name[name];
    return Object.assign({service, made: true}, app_address_of(app, service));
}

// The app's folder: its file, bin/run that serves it, and an Adminer's login beside an Adminer
function items_of(file, bytes)
{
    const now = Math.floor(Date.now()/1000);
    const run = Buffer.from(`#!/bin/sh\n# Written by serviceman: PHP's own server, every request going to ${file}\nexec php -S "0.0.0.0:$PORT" ${file}\n`);
    const out = [
        {path: 'bin', dir: true, mtime_s: now},
        {path: 'bin/run', mode: 0o755, mtime_s: now, size: run.length, stream: () => [run]},
        {path: file, mode: 0o644, mtime_s: now, size: bytes.length, stream: () => [bytes]},
    ];
    if (RE_ADMINER.test(bytes.toString('latin1'))) {
        const plugin = fs.readFileSync(PLUGIN);
        const plugins = Buffer.from('<?php\n\n// Written by serviceman: the login that opens this Adminer on its database\nreturn array(require __DIR__ . \'/serviceman_database.php\');\n');
        out.push({path: 'serviceman_database.php', mode: 0o644, mtime_s: now, size: plugin.length, stream: () => [plugin]});
        out.push({path: 'adminer-plugins.php', mode: 0o644, mtime_s: now, size: plugins.length, stream: () => [plugins]});
    }
    return out;
}

// The app in the config file, applied the way a Save applies one
async function config_put(app, name, folder, remote)
{
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    json.services = json.services || [];
    if (json.services.some(v => v.name === name)) {
        throw failure(409, `${name} is taken: pick another name for the app`);
    }
    const hosts = app_files_put.hosts(app, name);
    json.services.push({name, type: 'shell', remote, image: php_image_make.IMAGE, command: 'bin/run', cwd: folder, publish: Object.assign((hosts.length === 1) ? {host: hosts[0]} : {hosts}, {port: PORT})});
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

// Why a machine cannot run it, or null: online, its docker reached, files taken in one tar
function machine_refusal(remote)
{
    if (remote.state.phase !== 'online') {
        return 'is offline';
    }
    if ((remote.state.resources === null) || (remote.state.resources.docker === null) || (remote.state.resources.docker_socket === null) || (remote.state.resources.docker_socket === undefined)) {
        return 'has no docker its agent can reach: a PHP app runs in a container';
    }
    if ((remote_can(remote, 'tar_put') === false) || (typeof remote.state.resources.services !== 'string')) {
        return 'has an agent from before files come in one tar: its page says how it updates';
    }
    return null;
}

function failure(status, text)
{
    return Object.assign(new Error(text), {status});
}

module.exports = app_php_put;
