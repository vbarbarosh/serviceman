const EventEmitter = require('events');
const agent_part_path = require('./agent_part_path');
const fs = require('fs');

// One part of a file the host is copying here in parts. It is written at the offset it says,
// which is where the parts already in end — or before that, when a part whose answer was lost
// is sent again, and what stood from there on is cut away first. It answers the way a socket
// does, so the tunnel carries it without knowing the difference, and the one line it says
// back is how much of the file is in now.
//
// A part cut off halfway stays as far as it got: the next one asks how far that is.
function agent_file_part_put(target)
{
    const where = agent_part_path(target);
    const offset = Number(target.offset);
    if ((Number.isInteger(offset) === false) || (offset < 0)) {
        throw new Error(`a part starts at a byte of the file, and ${JSON.stringify(target.offset)} is not one`);
    }
    fs.mkdirSync(where.dir, {recursive: true});
    const had = size_or_zero(where.part);
    if (offset > had) {
        throw new Error(`the file has ${had} bytes so far, and a part cannot start at ${offset}`);
    }
    // The parts gather in a file this agent made, never through a link planted under that
    // name: opened following no link, cut through the same handle
    const fd = fs.openSync(where.part, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o644);
    if (offset < had) {
        fs.ftruncateSync(fd, offset);
    }
    const file = fs.createWriteStream(where.part, {fd});
    const out = new EventEmitter();
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function (chunk, done) {
        // The write is answered when the bytes are on the disk, and that answer is the credit
        // the host waits for — a slow disk here slows the copy instead of filling this memory
        file.write(chunk, done);
    };
    out.end = function () {
        file.end();
    };
    out.pause = function () {};
    out.resume = function () {};
    out.destroy = function () {
        out.destroyed = true;
        file.destroy();
    };
    file.on('error', function (error) {
        out.emit('error', error);
    });
    file.on('finish', function () {
        out.emit('data', Buffer.from(`${JSON.stringify({received: size_or_zero(where.part)})}\n`));
        out.emit('end');
        out.destroyed = true;
        out.emit('close');
    });
    return out;
}

// How much of the file is in: of the part file itself, never of whatever a link under that
// name points at
function size_or_zero(file)
{
    try {
        return fs.lstatSync(file).size;
    }
    catch {
        return 0;
    }
}

module.exports = agent_file_part_put;
