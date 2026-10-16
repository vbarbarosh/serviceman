const EventEmitter = require('events');
const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');

// A file of this machine the host is reading — the whole of it, or the byte range a player
// asked to seek to. It answers the way a socket does, so the tunnel carries it out without
// knowing the difference — and the tunnel's own credit holds a fast disk back from a slow link.
function agent_file_get(target)
{
    const slice = {};
    if (typeof target.start === 'number') {
        slice.start = target.start;
    }
    if (typeof target.end === 'number') {
        slice.end = target.end;
    }
    const file = fs.createReadStream(agent_fs_path(target.path, target.root), slice);
    const out = new EventEmitter();
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function () {};
    out.end = function () {};
    out.pause = function () {
        file.pause();
    };
    out.resume = function () {
        file.resume();
    };
    out.destroy = function () {
        out.destroyed = true;
        file.destroy();
    };
    file.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    file.on('end', function () {
        out.emit('end');
        out.destroyed = true;
        out.emit('close');
    });
    file.on('error', function (error) {
        out.emit('error', error);
    });
    return out;
}

module.exports = agent_file_get;
