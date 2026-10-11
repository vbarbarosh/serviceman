const EventEmitter = require('events');
const agent_term_read = require('./agent_term_read');
const agent_term_start = require('./agent_term_start');
const fs = require('fs');
const net = require('net');

// Joins the terminal `name` kept on this machine, starting its holder first when none runs it.
// It answers like the socket a tunnelled stream usually is: the holder's bytes come out as
// data, the history first; destroying it leaves the terminal, which keeps running.
//
//     target = {name, cols, rows}
function agent_term_join(target)
{
    const out = new EventEmitter();
    const waiting = [];
    // The size asked for last: a resize while the holder is still starting is applied once it is up
    const size = {cols: target.cols || 80, rows: target.rows || 24};
    let socket = null;
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function (chunk, done) {
        if (socket === null) {
            waiting.push(chunk);
            if (done !== undefined) {
                done();
            }
            return;
        }
        socket.write(chunk, done);
    };
    out.end = function () {
        out.destroy();
    };
    out.pause = function () {
        if (socket !== null) {
            socket.pause();
        }
    };
    out.resume = function () {
        if (socket !== null) {
            socket.resume();
        }
    };
    out.destroy = function () {
        out.destroyed = true;
        if (socket !== null) {
            socket.destroy();
        }
    };
    out.resize = function (cols, rows) {
        size.cols = cols;
        size.rows = rows;
        if (socket !== null) {
            size_write(target.name, cols, rows);
        }
    };
    open().then(function (opened) {
        socket = opened;
        if (out.destroyed) {
            socket.destroy();
            return;
        }
        socket.on('data', v => out.emit('data', v));
        socket.on('end', () => out.emit('end'));
        socket.on('error', e => out.emit('error', e));
        socket.on('close', function () {
            out.destroyed = true;
            out.emit('close');
        });
        size_write(target.name, size.cols, size.rows);
        for (const chunk of waiting.splice(0)) {
            socket.write(chunk);
        }
    }, function (error) {
        out.destroyed = true;
        out.emit('error', error);
        out.emit('close');
    });
    return out;

    async function open() {
        await agent_term_start(target.name, size.cols, size.rows);
        return await connected(net.connect({path: `${agent_term_read(target.name).base}.sock`}));
    }
}

// The size is not in the stream, which stays the terminal's own bytes: the holder reads it
// from a file when it is told to
function size_write(name, cols, rows)
{
    const found = agent_term_read(name);
    if (found === null) {
        return;
    }
    fs.writeFileSync(`${found.base}.size`, `${cols} ${rows}\n`);
    process.kill(found.pid, 'SIGWINCH');
}

function connected(socket)
{
    return new Promise(function (resolve, reject) {
        socket.once('connect', () => resolve(socket));
        socket.once('error', reject);
    });
}

module.exports = agent_term_join;
