const EventEmitter = require('events');
const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');
const tar_parser = require('../../../modules/file_manager/server/tar_parser');

// Many files the host is copying onto this machine as one tar, read as its bytes come. It
// answers the way a socket does, so the tunnel carries it without knowing the difference, and
// the one line it says back is what was written: {path, files, bytes}.
//
// Each file goes to a name of its own beside the real one until its last byte is in, then
// takes the real name and the time the tar gives it. A stream that stops halfway leaves the
// files that were whole, and never half a file under the name of a whole one.
function agent_tar_put(target)
{
    const dir = agent_fs_path(target.dir);
    fs.mkdirSync(dir, {recursive: true});
    const parser = tar_parser();
    const out = new EventEmitter();
    // The file being written: {full, written, part, mode, mtime_s, handle}
    let file = null;
    let files = 0;
    let bytes = 0;
    let failed = false;
    // One chunk is written after the other, each answered when it is on the disk
    let chain = Promise.resolve();
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function (chunk, done) {
        let events;
        try {
            events = parser.push(chunk);
        }
        catch (error) {
            fail(error);
            return;
        }
        step(async function () {
            await events_write(events);
            // The answer is the credit the host waits for: a slow disk here slows the copy
            // instead of filling this memory
            done();
        });
    };
    out.end = function () {
        step(async function () {
            const error = parser.end();
            if (error !== null) {
                throw error;
            }
            out.emit('data', Buffer.from(`${JSON.stringify({path: dir, files, bytes})}\n`));
            out.emit('end');
            out.destroyed = true;
            out.emit('close');
        });
    };
    // Nothing comes back until the end, so there is nothing to hold back
    out.pause = function () {};
    out.resume = function () {};
    out.destroy = function () {
        out.destroyed = true;
        chain = chain.then(part_drop);
    };

    function step(work) {
        chain = chain.then(function () {
            if (out.destroyed || failed) {
                return null;
            }
            return work();
        }).catch(fail);
    }

    function fail(error) {
        if (out.destroyed || failed) {
            return;
        }
        failed = true;
        out.emit('error', error);
    }

    async function events_write(events) {
        for (const event of events) {
            if (out.destroyed || failed) {
                return;
            }
            if (event.type === 'dir') {
                fs.mkdirSync(path.join(dir, event.name), {recursive: true});
            }
            else if (event.type === 'file') {
                await file_open(event);
            }
            else if (event.type === 'data') {
                await bytes_write(event.bytes);
            }
            else if (event.type === 'file_end') {
                await file_close();
            }
        }
    }

    async function file_open(event) {
        const full = path.join(dir, event.name);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        const replaced = fs.existsSync(full);
        // A file that is there is written over as itself: through a link to the file the link
        // points at, and with the permissions it had
        const written = (replaced ? fs.realpathSync(full) : full);
        const part = path.join(path.dirname(written), `.${path.basename(written)}.part`);
        file = {written, part, mode: (replaced ? fs.statSync(written).mode & 0o7777 : null), mtime_s: event.mtime_s, handle: null};
        file.handle = await fs.promises.open(part, 'w');
    }

    async function bytes_write(chunk) {
        let at = 0;
        while (at < chunk.length) {
            const said = await file.handle.write(chunk, at, chunk.length - at);
            at += said.bytesWritten;
        }
        bytes += chunk.length;
    }

    // The last byte is in: the file takes its name and the time it had where it came from,
    // which is how a listing tells it from one cut short
    async function file_close() {
        await file.handle.close();
        file.handle = null;
        if (out.destroyed) {
            return;
        }
        if (file.mode !== null) {
            fs.chmodSync(file.part, file.mode);
        }
        fs.renameSync(file.part, file.written);
        fs.utimesSync(file.written, file.mtime_s, file.mtime_s);
        files++;
        file = null;
    }

    async function part_drop() {
        if (file === null) {
            return;
        }
        if (file.handle !== null) {
            await file.handle.close().catch(function () {});
        }
        fs.rmSync(file.part, {force: true});
        file = null;
    }

    return out;
}

module.exports = agent_tar_put;
