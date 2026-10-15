const forward_join = require('./forward_join');
const fs = require('fs');
const log_event = require('./log_event');
const net = require('net');
const path = require('path');

// The longest path a socket file may have: sun_path holds 108 bytes, the last of them a zero
const SOCKET_PATH_MAX = 107;

// The forwards that show up on serviceman itself, `"to": {"here": true}`: serviceman listens for
// them in place of an agent, on a socket file inside its state dir or on its own loopback, and
// joins each connection to `from` the way a machine's is joined (forward_join). The config is
// the list: one taken out, set aside or changed is closed and its file goes, a new one opens.
// Called at the start, after the config changes, and on the minute, when one that could not
// listen is tried again — a file another program held may be free by now.
//
// app.forwards_here holds what each one is now: {name: {key, at, server, error}}, error null
// for one that listens. One change at a time: a minute that strikes during a config change
// waits for it.
function forwards_here(app)
{
    // A change that throws is logged and the next one still runs: the queue never stays broken,
    // and nothing is left for an unhandled rejection to bring serviceman down with
    app.forwards_here_lock = app.forwards_here_lock.then(function () {
        return forwards_apply(app);
    }).catch(function (error) {
        log_event(app, 'forward_here_apply_error', {reason: error.message});
    });
    return app.forwards_here_lock;
}

async function forwards_apply(app)
{
    const wanted = {};
    for (const item of app.config.forwards) {
        if ((item.off === false) && item.to.here) {
            wanted[item.name] = item;
        }
    }
    // What a forward that is tried again failed with last time, so the log says a reason once
    const before = {};
    for (const name of Object.keys(app.forwards_here)) {
        const found = app.forwards_here[name];
        if ((wanted[name] !== undefined) && (key_of(app, wanted[name]) === found.key) && (found.error === null)) {
            continue;
        }
        close(found);
        delete app.forwards_here[name];
        if (found.error === null) {
            log_event(app, 'forward_here_close', {forward: name, at: found.at});
        }
        else {
            before[name] = found.error;
        }
    }
    for (const name of Object.keys(wanted)) {
        if (app.forwards_here[name] === undefined) {
            app.forwards_here[name] = await listen(app, wanted[name], before[name]);
        }
    }
}

async function listen(app, item, error_before)
{
    const at = at_of(app, item);
    const out = {key: key_of(app, item), at, server: null, error: null};
    // Half open, as ssh -L is: a client that says it is done is still sent the answer
    const server = net.createServer({allowHalfOpen: true}, function (socket) {
        connection(app, item.name, socket);
    });
    let owner = null;
    try {
        if (item.to.socket === null) {
            await server_listen(server, {host: '127.0.0.1', port: item.to.port});
        }
        else {
            if (Buffer.byteLength(at) > SOCKET_PATH_MAX) {
                throw new Error(`${at} is ${Buffer.byteLength(at)} bytes long, and a socket file's path may have at most ${SOCKET_PATH_MAX}`);
            }
            fs.mkdirSync(app.state_dir, {recursive: true});
            owner = owner_of(app);
            folder_make(path.dirname(at), owner);
            await socket_take(at);
            await server_listen(server, {path: at});
            fs.chmodSync(at, 0o600);
            if (owner !== null) {
                fs.chownSync(at, owner.uid, owner.gid);
            }
        }
    }
    catch (error) {
        if (server.listening) {
            server.close();
        }
        out.error = error.message;
        if (error.message !== error_before) {
            log_event(app, 'forward_here_listen_error', {forward: item.name, at, reason: error.message, then: 'tried again every minute'});
        }
        return out;
    }
    // An error after the listen is the listener gone; the next minute opens it again
    server.on('error', function (error) {
        out.error = error.message;
    });
    out.server = server;
    log_event(app, 'forward_here_listen', {forward: item.name, at, owner: ((owner === null) ? null : `${owner.uid}:${owner.gid}`)});
    return out;
}

// A connection to it: carried to `from` while the forward is still on and still here, else
// closed at once, as it is while the machine the service is on is offline
function connection(app, name, socket)
{
    socket.on('error', function () {
        socket.destroy();
    });
    const forward = app.config.forwards.find(v => v.name === name);
    if ((forward === undefined) || forward.off || (forward.to.here === false)) {
        socket.destroy();
        return;
    }
    try {
        forward_join.carry(app, forward, function () {
            return socket;
        });
    }
    catch {
        // forward_carry kept the reason for the page; this end only has to close
        socket.destroy();
    }
}

function server_listen(server, options)
{
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(options, function () {
            server.removeListener('error', reject);
            resolve();
        });
    });
}

// A socket file left by a process that is gone, a serviceman that crashed, is taken over; one
// somebody still answers on is theirs, and anything that is not a socket is never deleted
function socket_take(file)
{
    return new Promise(function (resolve, reject) {
        let stat;
        try {
            stat = fs.lstatSync(file);
        }
        catch {
            resolve();
            return;
        }
        if (stat.isSocket() === false) {
            reject(new Error(`${file} is there and is not a socket`));
            return;
        }
        const probe = net.connect({path: file});
        probe.on('connect', function () {
            probe.destroy();
            reject(new Error(`${file} is answered by another program`));
        });
        probe.on('error', function () {
            try {
                fs.unlinkSync(file);
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    });
}

// The socket's folder, made when it is missing, and given to the owner of the state dir like
// the socket itself
function folder_make(dir, owner)
{
    const made = fs.mkdirSync(dir, {recursive: true});
    if ((made === undefined) || (owner === null)) {
        return;
    }
    // `made` is the first of them, every folder from it down to `dir` is new
    let at = dir;
    fs.chownSync(at, owner.uid, owner.gid);
    while ((at !== made) && (at !== path.dirname(at))) {
        at = path.dirname(at);
        fs.chownSync(at, owner.uid, owner.gid);
    }
}

// Who the socket is given to: a serviceman that runs as root, as it does in a rootful docker,
// gives it to whoever owns the state dir — on the host, the person who owns ./data — so they
// may open it, and nobody else; any other serviceman keeps it for its own user
function owner_of(app)
{
    if ((typeof process.getuid !== 'function') || (process.getuid() !== 0)) {
        return null;
    }
    const stat = fs.statSync(app.state_dir);
    if (stat.uid === 0) {
        return null;
    }
    return {uid: stat.uid, gid: stat.gid};
}

// Nothing new is let in, and the socket file goes with it; the connections open now finish on
// their own
function close(found)
{
    if (found.server !== null) {
        found.server.close();
    }
}

function at_of(app, item)
{
    return ((item.to.socket === null) ? `127.0.0.1:${item.to.port}` : path.resolve(app.state_dir, item.to.socket));
}

function key_of(app, item)
{
    return ((item.to.socket === null) ? `port ${item.to.port}` : `socket ${at_of(app, item)}`);
}

module.exports = forwards_here;
