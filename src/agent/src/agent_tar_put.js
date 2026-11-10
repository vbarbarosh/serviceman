const EventEmitter = require('events');
const agent_exec_bits = require('./agent_exec_bits');
const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');
const tar_parser = require('../../../modules/file_manager/server/tar_parser');

// Many files the host is copying onto this machine as one tar, read as its bytes come. It
// answers the way a socket does, so the tunnel carries it without knowing the difference, and
// the one line it says back is what was written: {path, files, bytes}.
//
// Each file goes to a name of its own beside the real one until its last byte is in, then
// takes the real name and the time the tar gives it; a new one takes its run bits too. A stream that stops halfway leaves the
// files that were whole, and never half a file under the name of a whole one.
function agent_tar_put(target)
{
    const dir = agent_fs_path(target.dir, target.root);
    fs.mkdirSync(dir, {recursive: true});
    const parser = tar_parser();
    const out = new EventEmitter();
    // The file being written: {full, written, part, mode, mode_there, mtime_s, handle}
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
            const refusal = parser.end();
            if (refusal !== null) {
                throw refusal;
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
        // A part that cannot be dropped, a folder put under its name meanwhile, stays: nobody
        // is left to hear of it, and a promise that fails in nobody's hands stops the agent
        chain = chain.then(part_drop).catch(function () {});
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
        for (const piece of events) {
            if (out.destroyed || failed) {
                return;
            }
            if (piece.type === 'dir') {
                fs.mkdirSync(agent_fs_path(path.join(dir, piece.name), target.root), {recursive: true});
            }
            else if (piece.type === 'file') {
                await file_open(piece);
            }
            else if (piece.type === 'data') {
                await bytes_write(piece.bytes);
            }
            else if (piece.type === 'file_end') {
                await file_close();
            }
        }
    }

    async function file_open(event) {
        // A name of the tar may lead out of the folder through a link already there
        const full = agent_fs_path(path.join(dir, event.name), target.root);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        const replaced = fs.existsSync(full);
        // A file that is there is written over as itself: through a link to the file the link
        // points at, and with the permissions it had
        const written = replaced ? fs.realpathSync(full) : full;
        const part = path.join(path.dirname(written), `.${path.basename(written)}.part`);
        const mode = replaced ? fs.statSync(written).mode & 0o7777 : null;
        // The part is a file this agent makes, never one that was waiting there: a link planted
        // under that name would carry the bytes to wherever it points. A part a cut-off tar left
        // behind is cleared first, and the name is opened for a new file alone, following no
        // link. Only a part that was opened is this tar's to drop: a folder under that name
        // refuses the file and stays.
        fs.rmSync(part, {force: true});
        const handle = await fs.promises.open(part, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW);
        file = {written, part, mode, mode_there: event.mode, mtime_s: event.mtime_s, handle};
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
        // Still the file this agent wrote, not something put in its place meanwhile: a link
        // there would take the mode to the file it points at, and then the file's name
        if (fs.lstatSync(file.part).isFile() === false) {
            throw new Error(`${file.part} is not the file that was written`);
        }
        if (file.mode !== null) {
            fs.chmodSync(file.part, file.mode);
        }
        else {
            agent_exec_bits(file.part, file.mode_there);
        }
        fs.renameSync(file.part, file.written);
        // The time is given to the name itself, never through a link to the file it points at
        fs.lutimesSync(file.written, file.mtime_s, file.mtime_s);
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
