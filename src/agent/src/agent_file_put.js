const EventEmitter = require('events');
const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');

// What a file may land under: a name of its own, and nothing that walks out of the folder
const RE_NAME = /^[^/\\]+$/;

// A file the host is copying onto this machine. It answers the way a socket does, so the
// tunnel carries it without knowing the difference: the bytes come in as they are read over
// there, and the one line it says back is what became of them.
//
// The bytes go to a name of their own until the last of them is in. A copy that stops
// halfway — a link that dropped, a browser that went away — leaves nothing standing where
// the file should be, and never half a file under the name of a whole one.
function agent_file_put(target)
{
    const name = String((target.name === undefined) ? '' : target.name);
    if ((RE_NAME.test(name) === false) || (name === '.') || (name === '..')) {
        throw new Error(`a file lands under a name of its own, and ${JSON.stringify(name)} is not one`);
    }
    const dir = agent_fs_path(String((target.dir === undefined) ? '~' : target.dir), target.root);
    // A folder that is not there is made: the host asks for a place, not for a place that
    // somebody has already been to
    fs.mkdirSync(dir, {recursive: true});
    const full = agent_fs_path(path.join(dir, name), target.root);
    const replaced = fs.existsSync(full);
    // A file that is there is written over as itself: through a link to the file the link
    // points at, and with the permissions it had — an edited script stays runnable
    const written = replaced ? fs.realpathSync(full) : full;
    const mode = replaced ? fs.statSync(written).mode & 0o7777 : null;
    const part = path.join(path.dirname(written), `.${path.basename(written)}.part`);
    const file = fs.createWriteStream(part);
    const out = new EventEmitter();
    let bytes = 0;
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function (chunk, done) {
        bytes += chunk.length;
        // The write is answered when the bytes are on the disk, and that answer is the credit
        // the host waits for — a slow disk here slows the copy instead of filling this memory
        file.write(chunk, done);
    };
    out.end = function () {
        file.end();
    };
    // Nothing comes back from a file until it is written, so there is nothing to hold back
    out.pause = function () {};
    out.resume = function () {};
    out.destroy = function () {
        out.destroyed = true;
        file.destroy();
        fs.rmSync(part, {force: true});
    };
    file.on('error', function (error) {
        out.emit('error', error);
    });
    // The last byte is in: the file takes the name it was sent under, and the host hears where
    // it landed
    file.on('finish', function () {
        try {
            if (mode !== null) {
                fs.chmodSync(part, mode);
            }
            fs.renameSync(part, written);
        }
        catch (error) {
            out.emit('error', error);
            return;
        }
        out.emit('data', Buffer.from(`${JSON.stringify({path: full, bytes, replaced})}\n`));
        out.emit('end');
        out.destroyed = true;
        out.emit('close');
    });
    return out;
}

// Where a folder the host names is on this machine. `~` is the home of the user the agent
// runs as, and a folder written without a root is under it — the reading a person sitting at
// this machine would give it.
module.exports = agent_file_put;
