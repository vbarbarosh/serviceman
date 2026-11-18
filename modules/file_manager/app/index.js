#!/usr/bin/env node

const files_app_answer = require('./src/files_app_answer');
const folder_disk = require('./src/folder_disk');
const fs = require('fs');
const http = require('http');
const log_line = require('../../../src/main/src/helpers/log_line');
const log_uid = require('../../../src/helpers/log_uid');
const machine_link = require('../../../src/module-host/src/machine_link');
const os = require('os');
const page_file_by_address = require('./src/page_file_by_address');
const path = require('path');
const remote_disk = require('../../../src/main/src/helpers/remote_disk');

// The folder the app is: the repository in a checkout, the app folder bin/file-manager-zip makes
// once it is unpacked, which keeps every file this one needs where it sits in the repository
const APP_DIR = path.resolve(__dirname, '../../..');

const USAGE = `files-app

The File Manager as an app of its own: one page, the whole window, over a folder of this
machine's own file system, which it shows as / and never leaves (a link that leads out of it is
not followed). Everything it does is done to that folder, as the user who runs the app, by the
ServiceMan agent's own code in this process. It listens on 127.0.0.1 only: serviceman, in front
of it, says who may open it.

  PORT        where it listens (default 3003)
  FILES_DIR   the folder it shows: absolute, ~/ for the home folder, or relative to the app
              folder (default data/files, made when it is not there)
  --files     says the files the app is made of, from the app folder, and stops: what
              bin/file-manager-zip puts in the zip

Run as its bin/run runs it, SERVICEMAN_AGENT_DIR and SERVICEMAN_LOG_DIR are its own: the agent
in it keeps to data/agent, and its lines are the app's output.
`;

// No cli: the app carries no package, and cli takes one (bluebird). A failure ends the process
// with its error, as the agent's own does.
main();

async function main()
{
    if (process.argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    if (process.argv.includes('--files')) {
        console.log(app_files_read().join('\n'));
        return;
    }
    const port = Number(process.env.PORT || 3003);
    const root = files_dir_from_text(process.env.FILES_DIR || 'data/files');
    const found = fs.statSync(root, {throwIfNoEntry: false});
    if (found === undefined) {
        fs.mkdirSync(root, {recursive: true});
    }
    else if (found.isDirectory() === false) {
        throw new Error(`FILES_DIR is ${root}, which is no folder`);
    }
    // What the agent keeps is the app's, never the folder of the agent that started it
    if (!process.env.SERVICEMAN_AGENT_DIR) {
        process.env.SERVICEMAN_AGENT_DIR = path.join(APP_DIR, 'data/agent');
    }
    const uid = log_uid();
    const app = {
        log_lines: [],
        file_log: null,
        log_stdout_time: true,
        // The agent says nothing of a service here: it runs none
        service_said: function () {},
    };
    const remote = machine_link(app);
    const ctx = {
        disk: folder_disk(remote_disk(app, remote, {root: [root]}), root),
        remote,
        root,
        machine: os.hostname(),
        log: function (event, fields) {
            log_line(app, uid, event, fields);
        },
    };
    // What answering one throws costs that caller alone: thrown out of here it would end the
    // process, and an upload under way with it
    const server = http.createServer(function (req, res) {
        files_app_answer(req, res, ctx).catch(function (error) {
            log_line(app, uid, 'files_app_request_error', {method: req.method, reason: error.message});
            request_refuse(res);
        });
    });
    log_line(app, uid, 'group_spawn');
    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    log_line(app, uid, 'files_app_begin', {port, root, pid: process.pid});
    // serviceman stops an app with SIGTERM; the agent's link keeps this process going, so it
    // ends here, and the socket file of the link goes with it
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, function () {
            log_line(app, uid, 'files_app_end_ok', {signal});
            server.closeAllConnections();
            process.exit(0);
        });
    }
}

// The folder FILES_DIR names: ~ is the home folder of the app's user, and a path that is not
// absolute is the app folder's
function files_dir_from_text(text)
{
    if ((text === '~') || text.startsWith('~/')) {
        return path.join(os.homedir(), text.slice(1));
    }
    return path.resolve(APP_DIR, text);
}

// Every file the app runs and serves, from the app folder: the modules node has loaded by now,
// which are every module it requires, since each is required at the top of its file, and the
// page's files
function app_files_read()
{
    const files = Object.keys(require.cache).concat(Object.values(page_file_by_address));
    return Array.from(new Set(files.map(v => path.relative(APP_DIR, v)))).sort();
}

// 400 for a request whose answer was not begun; one already on its way is cut where it is
function request_refuse(res)
{
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(400, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify({error: 'bad request'}));
}
