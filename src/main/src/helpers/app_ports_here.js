const fs = require('fs');
const log_event = require('./log_event');
const net = require('net');
const path = require('path');
const service_is_app = require('./service_is_app');
const tls = require('tls');

const FILE = 'app_ports.json';
// The first byte of a TLS handshake: a connection that opens with it asks for https
const TLS_HANDSHAKE = 0x16;
// A connection that says nothing at all is let go after this long
const FIRST_BYTE_MS = 60000;

// Every app has a port of its own on serviceman, beside its names: from the tailnet,
// serviceman.tail1234.ts.net:3101 opens va with nothing to set up, no DNS, no name to add.
// Whatever name a request on it carries, it is that app's (app_port_route), behind the app's
// own wall. A port is the app's for good: kept in the state dir's app_ports.json, it stays the
// same across restarts and new apps, follows a rename and is let go with the app. A new app takes
// the lowest one free from the config's apps.ports up; 0 gives each whichever is free, kept
// nowhere. The port listens where the service port does (listen.host).
//
// Called at the start, after the config changes, and on the minute, when one that could not
// listen (another program held it) is tried again. Nothing listens before serviceman's own
// doors are open: app.app_ports_server, which server_start gives, makes the server of a port,
// one that answers as the service port does. Each port answers https too, with the tailnet's
// certificate once tailscale gave one (tailnet_cert_read), and http as before: a connection that
// opens with a TLS handshake is the https one.
//
// app.app_ports_here holds what each one is now: {app: {port, server, error}}, error null for
// one that listens. One change at a time, as forwards_here.
//
//     renamed   {old name: new name} of an app the save renamed: its port goes with it
function app_ports_here(app, renamed)
{
    app.app_ports_lock = app.app_ports_lock.then(function () {
        return ports_apply(app, (renamed === undefined) ? Object.create(null) : renamed);
    }).catch(function (error) {
        log_event(app, 'app_port_apply_error', {reason: error.message});
    });
    return app.app_ports_lock;
}

async function ports_apply(app, renamed)
{
    const first = app.config.apps.ports;
    // Turned off, every port closes and the file stays as it is, for the day they are back
    const off = (first === null) || (app.app_ports_server === undefined);
    const names = off ? [] : app.services.filter(v => service_is_app(v) && (v.routes.length > 0)).map(v => v.name);
    const wanted = off ? Object.create(null) : ports_kept(app, names, first, renamed);
    // What a port that is tried again failed with last time, so the log says a reason once
    const before = Object.create(null);
    for (const name of Object.keys(app.app_ports_here)) {
        const found = app.app_ports_here[name];
        if ((wanted[name] !== undefined) && ((wanted[name] === 0) || (wanted[name] === found.port)) && (found.error === null)) {
            continue;
        }
        await close(found);
        delete app.app_ports_here[name];
        if (found.error === null) {
            log_event(app, 'app_port_close', {app: name, port: found.port});
        }
        else {
            before[name] = found.error;
        }
    }
    for (const name of Object.keys(wanted)) {
        if (app.app_ports_here[name] === undefined) {
            app.app_ports_here[name] = await listen(app, name, wanted[name], before[name]);
        }
    }
}

// The port of each app, kept: {app: port}. One the file does not have yet gets the lowest free
// from `first` up, past serviceman's own ports; one gone from the config lets its port go. With
// `first` 0 nothing is kept: each app is 0, whichever is free.
function ports_kept(app, names, first, renamed)
{
    const out = Object.create(null);
    if (first === 0) {
        for (const name of names) {
            out[name] = 0;
        }
        return out;
    }
    const file = path.resolve(app.state_dir, FILE);
    const kept = kept_read(file);
    for (const old of Object.keys(renamed)) {
        if ((kept[old] !== undefined) && (kept[renamed[old]] === undefined)) {
            kept[renamed[old]] = kept[old];
        }
        delete kept[old];
    }
    // serviceman's own: its doors, its DNS, and the forwards it listens for itself
    const own = [app.config.listen.port, app.config.control.port, app.config.apps.dns];
    for (const item of app.config.forwards) {
        if (item.to.here && (item.to.socket === null)) {
            own.push(item.to.port);
        }
    }
    for (const name of names) {
        if (Number.isInteger(kept[name]) && (kept[name] >= first) && (kept[name] <= 65535)) {
            out[name] = kept[name];
        }
    }
    const taken = Object.values(out);
    for (const name of names) {
        if (out[name] !== undefined) {
            continue;
        }
        let port = first;
        while (taken.includes(port) || own.includes(port)) {
            port++;
        }
        if (port > 65535) {
            continue;
        }
        out[name] = port;
        taken.push(port);
    }
    const text = `${JSON.stringify(Object.assign({}, out), null, 4)}\n`;
    if (text !== `${JSON.stringify(Object.assign({}, kept), null, 4)}\n`) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(`${file}.new`, text);
        fs.renameSync(`${file}.new`, file);
    }
    return out;
}

function kept_read(file)
{
    try {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        return ((typeof json === 'object') && (json !== null) && (Array.isArray(json) === false)) ? Object.assign(Object.create(null), json) : Object.create(null);
    }
    catch {
        return Object.create(null);
    }
}

async function listen(app, name, port, error_before)
{
    const out = {port, server: null, error: null, sockets: new Set()};
    const server = server_of(app, name, out.sockets);
    try {
        await new Promise(function (resolve, reject) {
            server.once('error', reject);
            server.listen(port, app.config.listen.host, function () {
                server.removeListener('error', reject);
                resolve();
            });
        });
    }
    catch (error) {
        out.error = error.message;
        if (error.message !== error_before) {
            log_event(app, 'app_port_listen_error', {app: name, port, reason: error.message, then: 'tried again every minute'});
        }
        return out;
    }
    // An app's port alone never keeps serviceman up: the service port does that
    server.unref();
    // An error after the listen is the listener gone; the next minute opens it again
    server.on('error', function (error) {
        out.error = error.message;
    });
    out.server = server;
    out.port = server.address().port;
    log_event(app, 'app_port_listen', {app: name, address: `${app.config.listen.host}:${out.port}`});
    return out;
}

// What listens on an app's port: each connection goes by its first byte to the https side or
// the http side, and both answer as the service port does. Every connection is kept in
// `sockets` until it closes, for the port to be closed whole.
function server_of(app, name, sockets)
{
    const http_server = app.app_ports_server();
    http_server.on('connection', function (socket) {
        // What came in here is this app's, whatever name it carries
        socket.app_port = name;
    });
    // The certificate is asked for at each handshake, so a renewed one is used at once
    const https_server = tls.createServer({ALPNProtocols: ['http/1.1'], SNICallback: function (servername, done) {
        done(null, app.tailnet_cert.context);
    }}, function (socket) {
        http_server.emit('connection', socket);
    });
    // A handshake that failed is that connection's alone, as a bad request is
    https_server.on('tlsClientError', function (error, socket) {
        socket.destroy();
    });
    return net.createServer(function (socket) {
        sockets.add(socket);
        socket.on('close', function () {
            sockets.delete(socket);
        });
        first_byte(socket, function (byte) {
            if (byte !== TLS_HANDSHAKE) {
                http_server.emit('connection', socket);
            }
            else if (app.tailnet_cert.context === null) {
                // https with no certificate to answer it: refused, as a port that speaks only http refuses it
                socket.destroy();
            }
            else {
                https_server.emit('connection', socket);
            }
        });
    });
}

// The first byte a connection sends, read and put back for whoever answers it; one that closes
// or says nothing for a minute is let go
function first_byte(socket, then)
{
    function on_error() {
        socket.destroy();
    }
    function on_timeout() {
        socket.destroy();
    }
    socket.on('error', on_error);
    socket.setTimeout(FIRST_BYTE_MS);
    socket.on('timeout', on_timeout);
    socket.once('readable', function () {
        const head = socket.read(1);
        socket.removeListener('error', on_error);
        socket.removeListener('timeout', on_timeout);
        socket.setTimeout(0);
        if (head === null) {
            socket.destroy();
            return;
        }
        socket.unshift(head);
        then(head[0]);
    });
}

// Closed whole before its port is listened on again, by the same app under a new name too
function close(found)
{
    if (found.server === null) {
        return Promise.resolve();
    }
    return new Promise(function (resolve) {
        found.server.close(function () {
            resolve();
        });
        for (const socket of found.sockets) {
            socket.destroy();
        }
    });
}

app_ports_here.FILE = FILE;

module.exports = app_ports_here;
