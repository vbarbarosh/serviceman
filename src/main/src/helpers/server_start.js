const connection_group = require('./connection_group');
const control_owner_token = require('./control_owner_token');
const fs = require('fs');
const handle_control_request = require('../routes/handle_control_request');
const handle_control_upgrade = require('../routes/handle_control_upgrade');
const handle_request = require('../routes/handle_request');
const handle_upgrade = require('../routes/handle_upgrade');
const http = require('http');
const log_event = require('./log_event');
const net = require('net');
const render_error_page = require('./render_error_page');
const url_logged = require('./url_logged');

// How long one request may take to come in whole. Node's own five minutes cut a zip of an app
// sent over a slow uplink (300 MB at 8 Mbit/s is five minutes); a request whose headers are
// slow is still cut by headersTimeout.
const REQUEST_TIMEOUT_MS = 3600000;

// Opens the doors: the service port, and the control port when the config asks for one
async function server_start(app)
{
    const server = service_server(app);
    await listen(server, app.config.listen.port, app.config.listen.host);
    // The port the services are really on: the config may say 0, which means whichever is free
    app.listen_port = server.address().port;
    // Every door can be closed, and each can be a port or a file: the services, the control page
    const out = {server, service_socket: null, control: null, socket: null};
    if (app.config.listen.socket !== null) {
        out.service_socket = await file_open(app, service_server(app), app.config.listen.socket, app.config.listen.socket_mode);
    }
    // The owner's token is there before the first request, for bin/owner-token to print
    if ((app.config.control.port !== null) || (app.config.control.socket !== null)) {
        control_owner_token(app);
    }
    if (app.config.control.port !== null) {
        out.control = await control_open(app, app.config.control.port, app.config.control.bind);
    }
    if (app.config.control.socket !== null) {
        out.socket = await file_open(app, control_server(app), app.config.control.socket, app.config.control.socket_mode);
    }
    app.servers = out;
    return out;
}

// The services, answered by hostname the same way whether the request came through a port or a
// socket file. A file needs no port and no address, which is what an ssh forward carries.
function service_server(app)
{
    const out = http.createServer(function (req, res) {
        guard_streams(req, res);
        answer(app, req, res, handle_request);
    });
    out.requestTimeout = REQUEST_TIMEOUT_MS;
    out.on('connection', function (socket) {
        connection_group(app, socket);
    });
    out.on('upgrade', function (req, socket, head) {
        socket.on('error', function () {
            socket.destroy();
        });
        const host = String(req.headers.host || '').toLowerCase().split(':')[0];
        // A handshake that came in through a machine's door is a service's or nobody's: the
        // control page is never reached that way, as handle_request says of a request
        if ((socket.tunnel_from === undefined) && (app.config.control.host !== null) && (host === app.config.control.host)) {
            handle_control_upgrade(app, req, socket, head);
            return;
        }
        const promise = handle_upgrade(app, req, socket, head);
        promise.catch(function () {
            socket.destroy();
        });
    });
    return out;
}

async function control_open(app, port, bind)
{
    const out = control_server(app);
    await listen(out, port, bind);
    return out;
}

// A door on the filesystem instead of the network. Who may open the file is who may knock, so
// the mode is the whole of its security.
async function file_open(app, server, path, mode)
{
    await socket_free(path);
    await listen(server, path, undefined);
    fs.chmodSync(path, mode);
    return server;
}

// A socket file outlives the process that made it. One that nobody answers on is this one's to
// take; one that answers belongs to a serviceman that is still running, and is left alone.
// The control page, whichever door it is opened behind
function control_server(app)
{
    const out = http.createServer(function (req, res) {
        guard_streams(req, res);
        answer(app, req, res, handle_control_request);
    });
    out.requestTimeout = REQUEST_TIMEOUT_MS;
    out.on('connection', function (socket) {
        connection_group(app, socket);
    });
    out.on('upgrade', function (req, socket, head) {
        socket.on('error', function () {
            socket.destroy();
        });
        handle_control_upgrade(app, req, socket, head);
    });
    return out;
}

function socket_free(path)
{
    return new Promise(function (resolve, reject) {
        if (fs.existsSync(path) === false) {
            resolve();
            return;
        }
        const probe = net.connect({path});
        probe.on('connect', function () {
            probe.destroy();
            reject(new Error(`${path}: something already answers on that socket`));
        });
        probe.on('error', function () {
            probe.destroy();
            fs.unlinkSync(path);
            resolve();
        });
    });
}

function listen(server, port, host)
{
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, host, function () {
            server.removeListener('error', reject);
            resolve(server);
        });
    });
}

// A client that vanishes mid-transfer emits 'error' on its streams; without a listener that kills the process
function guard_streams(req, res)
{
    req.on('error', function () {
        res.destroy();
    });
    res.on('error', function () {
        res.destroy();
    });
}

function answer(app, req, res, handler)
{
    const promise = handler(app, req, res);
    promise.catch(function (error) {
        // The address without its values, and the reason without the stack: the log is read by
        // more eyes than the code is
        log_event(app, 'serviceman_error', {host: req.headers.host, path: url_logged(req.url), error: error.message});
        render_error_page(res, 500, 'serviceman broke on this request', error.message);
    });
}

module.exports = server_start;
