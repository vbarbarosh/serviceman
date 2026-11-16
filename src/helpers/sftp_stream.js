const fs = require('fs');
const path = require('path');
const stream = require('stream');

// SFTP version 3, as OpenSSH speaks it (draft-ietf-secsh-filexfer-02), the packets sshfs sends
const FXP = {
    INIT: 1,
    VERSION: 2,
    OPEN: 3,
    CLOSE: 4,
    READ: 5,
    WRITE: 6,
    LSTAT: 7,
    FSTAT: 8,
    SETSTAT: 9,
    FSETSTAT: 10,
    OPENDIR: 11,
    READDIR: 12,
    REMOVE: 13,
    MKDIR: 14,
    RMDIR: 15,
    REALPATH: 16,
    STAT: 17,
    RENAME: 18,
    READLINK: 19,
    SYMLINK: 20,
    STATUS: 101,
    HANDLE: 102,
    DATA: 103,
    NAME: 104,
    ATTRS: 105,
    EXTENDED: 200,
    EXTENDED_REPLY: 201,
};
const FX = {
    OK: 0,
    EOF: 1,
    NO_SUCH_FILE: 2,
    PERMISSION_DENIED: 3,
    FAILURE: 4,
    BAD_MESSAGE: 5,
    OP_UNSUPPORTED: 8,
};
const ATTR = {
    SIZE: 0x1,
    UIDGID: 0x2,
    PERMISSIONS: 0x4,
    ACMODTIME: 0x8,
    EXTENDED: 0x80000000,
};
const PFLAG = {
    READ: 0x1,
    WRITE: 0x2,
    APPEND: 0x4,
    CREAT: 0x8,
    TRUNC: 0x10,
    EXCL: 0x20,
};
const PFLAGS_WRITE = PFLAG.WRITE | PFLAG.APPEND | PFLAG.CREAT | PFLAG.TRUNC | PFLAG.EXCL;
const VERSION = 3;
// A packet longer than this is no packet of a client's: OpenSSH takes 256 KB of data at most
const PACKET_MAX_BYTES = 512*1024;
const READ_MAX_BYTES = 256*1024;
const HANDLES_MAX = 256;
// Requests worked on at once, and answers not yet taken; past either, what comes in waits
const BUSY_MAX = 64;
const OUT_MAX_BYTES = 4*1024*1024;
const NAMES_PER_PACKET = 100;
const ST_RDONLY = 0x1;
// statvfs' answer to `df`, when the file system cannot be asked
const NAME_MAX = 255;
// What a user of the machine may make: the owner and the group read and write, the rest read
const UMASK_DIR = 0o755;
const MESSAGES = {
    ENOENT: 'no such file',
    ENOTDIR: 'not a folder',
    EISDIR: 'a folder',
    EEXIST: 'there already',
    ENOTEMPTY: 'the folder is not empty',
    EACCES: 'permission denied',
    EPERM: 'permission denied',
    EROFS: 'read-only',
    ELOOP: 'a link, not followed',
    ENOSPC: 'no space left',
    EDQUOT: 'over the quota',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One folder of this machine, served over SFTP to whoever is at the other end of the stream:
// sshfs on another machine mounts it. The folder is the whole of what it sees: `/` there is the
// folder here, `..` stops at it, and a link that leads out of it is not followed, neither by a
// path that goes through it nor once a file is open. `read_only` answers every change with
// "permission denied". It answers the way a socket does, so a link's tunnel carries it.
//
//     sftp_stream('/home/user/serviceman/data', {read_only: true})
function sftp_stream(dir, options)
{
    const ctx = {
        dir: String(dir),
        read_only: ((options !== undefined) && (options !== null) && (options.read_only === true)),
        root: null,
        handles: new Map(),
        next_handle: 0,
        busy: 0,
        waiting: [],
        input: Buffer.alloc(0),
        started: false,
        finishing: false,
        ended: false,
        out: null,
    };
    const out = new stream.Duplex({
        read: function () {
            packets_next(ctx);
        },
        write: function (chunk, encoding, callback) {
            ctx.input = Buffer.concat([ctx.input, chunk]);
            ctx.waiting.push(callback);
            packets_next(ctx);
        },
        // The client is done: its answers still on their way go out first
        final: function (callback) {
            ctx.finishing = true;
            callback();
            packets_next(ctx);
        },
        destroy: function (error, callback) {
            handles_close(ctx);
            callback(error);
        },
    });
    // A tunnel asks it of a socket; there is no Nagle here to turn off
    out.setNoDelay = function () {};
    ctx.out = out;
    return out;
}

// Takes the next whole packets in, as long as fewer than BUSY_MAX are being worked on; the
// writer is let go once all it sent is taken, so a client that sends faster than the disk
// answers is held back
function packets_next(ctx)
{
    if (ctx.out.destroyed) {
        return;
    }
    while ((ctx.busy < BUSY_MAX) && (ctx.out.readableLength < OUT_MAX_BYTES) && (ctx.input.length >= 4)) {
        const length = ctx.input.readUInt32BE(0);
        if ((length < 1) || (length > PACKET_MAX_BYTES)) {
            ctx.out.destroy(new Error(`an SFTP packet of ${length} bytes`));
            return;
        }
        if (ctx.input.length < 4 + length) {
            break;
        }
        const packet = ctx.input.subarray(4, 4 + length);
        ctx.input = ctx.input.subarray(4 + length);
        ctx.busy++;
        packet_answer(ctx, packet).catch(function (error) {
            ctx.out.destroy(error);
        }).finally(function () {
            ctx.busy--;
            packets_next(ctx);
        });
    }
    if ((ctx.busy < BUSY_MAX) && (ctx.input.length < 4 + PACKET_MAX_BYTES)) {
        for (const callback of ctx.waiting.splice(0)) {
            callback();
        }
    }
    if (ctx.finishing && (ctx.busy === 0) && (ctx.ended !== true)) {
        ctx.ended = true;
        ctx.out.push(null);
    }
}

async function packet_answer(ctx, packet)
{
    const reader = reader_make(packet);
    const type = reader.byte();
    if (type === FXP.INIT) {
        await init_answer(ctx, reader);
        return;
    }
    const id = reader.uint32();
    if (ctx.started === false) {
        send(ctx, FXP.STATUS, [u32(id), u32(FX.FAILURE), str('INIT first'), str('')]);
        return;
    }
    try {
        await request_answer(ctx, type, id, reader);
    }
    catch (error) {
        send_status(ctx, id, status_of(error), message_of(error));
    }
}

// The folder is looked up once, at the start: a folder that is not there ends the stream with
// the reason, for the mount to show
async function init_answer(ctx, reader)
{
    reader.uint32();
    try {
        ctx.root = await fs.promises.realpath(ctx.dir);
        const stat = await fs.promises.stat(ctx.root);
        if (stat.isDirectory() === false) {
            throw new Error(`${ctx.dir} is not a folder`);
        }
    }
    catch (error) {
        ctx.out.destroy(new Error((error.code === 'ENOENT') ? `no folder ${ctx.dir}` : error.message));
        return;
    }
    ctx.started = true;
    const extensions = [
        str('posix-rename@openssh.com'), str('1'),
        str('statvfs@openssh.com'), str('2'),
        str('fsync@openssh.com'), str('1'),
    ];
    send(ctx, FXP.VERSION, [u32(VERSION)].concat(extensions));
}

async function request_answer(ctx, type, id, reader)
{
    switch (type) {
    case FXP.REALPATH:
        name_send(ctx, id, [{name: virtual_of(reader.string_utf8()), attrs: null}]);
        return;
    case FXP.STAT:
        attrs_send(ctx, id, await fs.promises.stat(await real_of(ctx, reader.string_utf8(), true)));
        return;
    case FXP.LSTAT:
        attrs_send(ctx, id, await fs.promises.lstat(await real_of(ctx, reader.string_utf8(), false)));
        return;
    case FXP.FSTAT:
        attrs_send(ctx, id, await handle_of(ctx, reader.string(), 'file').file.stat());
        return;
    case FXP.OPEN:
        await open_answer(ctx, id, reader);
        return;
    case FXP.READ:
        await read_answer(ctx, id, reader);
        return;
    case FXP.WRITE:
        await write_answer(ctx, id, reader);
        return;
    case FXP.CLOSE:
        await close_answer(ctx, id, reader);
        return;
    case FXP.OPENDIR:
        await opendir_answer(ctx, id, reader);
        return;
    case FXP.READDIR:
        await readdir_answer(ctx, id, reader);
        return;
    case FXP.READLINK:
        name_send(ctx, id, [{name: await fs.promises.readlink(await real_of(ctx, reader.string_utf8(), false)), attrs: null}]);
        return;
    case FXP.SETSTAT:
        changes_allowed(ctx);
        await setstat(await real_of(ctx, reader.string_utf8(), true), attrs_read(reader));
        send_status(ctx, id, FX.OK, '');
        return;
    case FXP.FSETSTAT:
        changes_allowed(ctx);
        await fsetstat(handle_of(ctx, reader.string(), 'file').file, attrs_read(reader));
        send_status(ctx, id, FX.OK, '');
        return;
    case FXP.REMOVE:
        changes_allowed(ctx);
        await fs.promises.unlink(await real_of(ctx, reader.string_utf8(), false));
        send_status(ctx, id, FX.OK, '');
        return;
    case FXP.MKDIR:
        changes_allowed(ctx);
        await mkdir_answer(ctx, reader);
        send_status(ctx, id, FX.OK, '');
        return;
    case FXP.RMDIR:
        changes_allowed(ctx);
        await fs.promises.rmdir(await real_of(ctx, reader.string_utf8(), false));
        send_status(ctx, id, FX.OK, '');
        return;
    case FXP.RENAME:
        changes_allowed(ctx);
        await rename_answer(ctx, reader, false);
        send_status(ctx, id, FX.OK, '');
        return;
    case FXP.SYMLINK:
        // A link made here could lead a program of this machine out of the folder
        send_status(ctx, id, FX.OP_UNSUPPORTED, 'links are not made over this mount');
        return;
    case FXP.EXTENDED:
        await extended_answer(ctx, id, reader);
        return;
    default:
        send_status(ctx, id, FX.OP_UNSUPPORTED, `request ${type} is not served`);
    }
}

async function open_answer(ctx, id, reader)
{
    const name = reader.string_utf8();
    const pflags = reader.uint32();
    const attrs = attrs_read(reader);
    if ((pflags & PFLAGS_WRITE) !== 0) {
        changes_allowed(ctx);
    }
    handles_room(ctx);
    const real = await real_of(ctx, name, false);
    // The last part of the path is never followed: a link there may lead anywhere
    let flags = fs.constants.O_NOFOLLOW;
    if (((pflags & PFLAG.READ) !== 0) && ((pflags & (PFLAG.WRITE | PFLAG.APPEND)) !== 0)) {
        flags |= fs.constants.O_RDWR;
    }
    else if ((pflags & (PFLAG.WRITE | PFLAG.APPEND)) !== 0) {
        flags |= fs.constants.O_WRONLY;
    }
    else {
        flags |= fs.constants.O_RDONLY;
    }
    if ((pflags & PFLAG.APPEND) !== 0) {
        flags |= fs.constants.O_APPEND;
    }
    if ((pflags & PFLAG.CREAT) !== 0) {
        flags |= fs.constants.O_CREAT;
    }
    if ((pflags & PFLAG.TRUNC) !== 0) {
        flags |= fs.constants.O_TRUNC;
    }
    if ((pflags & PFLAG.EXCL) !== 0) {
        flags |= fs.constants.O_EXCL;
    }
    const mode = ((attrs.permissions === null) ? 0o644 : attrs.permissions) & 0o7777;
    const file = await fs.promises.open(real, flags, mode);
    try {
        await fd_inside(ctx, file.fd);
    }
    catch (error) {
        await file.close();
        throw error;
    }
    handle_send(ctx, id, {kind: 'file', file});
}

async function read_answer(ctx, id, reader)
{
    const found = handle_of(ctx, reader.string(), 'file');
    const offset = reader.uint64();
    const length = Math.min(reader.uint32(), READ_MAX_BYTES);
    const buffer = Buffer.alloc(length);
    const {bytesRead} = await found.file.read(buffer, 0, length, offset);
    if ((bytesRead === 0) && (length > 0)) {
        send_status(ctx, id, FX.EOF, 'end of file');
        return;
    }
    send(ctx, FXP.DATA, [u32(id), str(buffer.subarray(0, bytesRead))]);
}

async function write_answer(ctx, id, reader)
{
    changes_allowed(ctx);
    const found = handle_of(ctx, reader.string(), 'file');
    const offset = reader.uint64();
    const data = reader.string();
    let done = 0;
    while (done < data.length) {
        const {bytesWritten} = await found.file.write(data, done, data.length - done, offset + done);
        done += bytesWritten;
    }
    send_status(ctx, id, FX.OK, '');
}

async function close_answer(ctx, id, reader)
{
    const key = reader.string().toString('latin1');
    const found = ctx.handles.get(key);
    if (found === undefined) {
        send_status(ctx, id, FX.FAILURE, 'no such handle');
        return;
    }
    ctx.handles.delete(key);
    if (found.kind === 'file') {
        await found.file.close();
    }
    send_status(ctx, id, FX.OK, '');
}

// The names are read at once and handed out a hundred at a time; `.` and `..` lead first, as
// OpenSSH's do, and `..` of the folder itself is the folder
async function opendir_answer(ctx, id, reader)
{
    const name = reader.string_utf8();
    handles_room(ctx);
    const real = await real_of(ctx, name, true);
    const names = await fs.promises.readdir(real);
    const parent = (real === ctx.root) ? real : path.dirname(real);
    const entries = [{name: '.', real}, {name: '..', real: parent}].concat(names.sort().map(v => ({name: v, real: path.join(real, v)})));
    handle_send(ctx, id, {kind: 'dir', entries, at: 0});
}

async function readdir_answer(ctx, id, reader)
{
    const found = handle_of(ctx, reader.string(), 'dir');
    if (found.at >= found.entries.length) {
        send_status(ctx, id, FX.EOF, 'no more names');
        return;
    }
    const part = found.entries.slice(found.at, found.at + NAMES_PER_PACKET);
    found.at += part.length;
    const entries = [];
    for (const entry of part) {
        try {
            entries.push({name: entry.name, attrs: await fs.promises.lstat(entry.real)});
        }
        catch {
            // Gone since the folder was read: it is left out, as `ls` leaves it
        }
    }
    name_send(ctx, id, entries);
}

async function mkdir_answer(ctx, reader)
{
    const real = await real_of(ctx, reader.string_utf8(), false);
    const attrs = attrs_read(reader);
    await fs.promises.mkdir(real, ((attrs.permissions === null) ? UMASK_DIR : attrs.permissions) & 0o7777);
}

async function rename_answer(ctx, reader, posix)
{
    const from = await real_of(ctx, reader.string_utf8(), false);
    const to = await real_of(ctx, reader.string_utf8(), false);
    // SFTP's own rename does not take the place of a file that is there; posix-rename does
    if (posix === false) {
        const there = await fs.promises.lstat(to).then(() => true, () => false);
        if (there) {
            throw Object.assign(new Error(`${path.basename(to)} is there already`), {code: 'EEXIST'});
        }
    }
    await fs.promises.rename(from, to);
}

async function extended_answer(ctx, id, reader)
{
    const request = reader.string_utf8();
    switch (request) {
    case 'posix-rename@openssh.com':
        changes_allowed(ctx);
        await rename_answer(ctx, reader, true);
        send_status(ctx, id, FX.OK, '');
        return;
    case 'statvfs@openssh.com':
        if (fs.promises.statfs === undefined) {
            send_status(ctx, id, FX.OP_UNSUPPORTED, 'this node cannot tell the free space');
            return;
        }
        statvfs_send(ctx, id, await fs.promises.statfs(await real_of(ctx, reader.string_utf8(), true)));
        return;
    case 'fsync@openssh.com':
        await handle_of(ctx, reader.string(), 'file').file.sync();
        send_status(ctx, id, FX.OK, '');
        return;
    default:
        send_status(ctx, id, FX.OP_UNSUPPORTED, `${request} is not served`);
    }
}

function statvfs_send(ctx, id, stat)
{
    const numbers = [stat.bsize, stat.bsize, stat.blocks, stat.bfree, stat.bavail, stat.files, stat.ffree, stat.ffree, 0, ctx.read_only ? ST_RDONLY : 0, NAME_MAX];
    send(ctx, FXP.EXTENDED_REPLY, [u32(id)].concat(numbers.map(u64)));
}

async function setstat(real, attrs)
{
    if (attrs.uid !== null) {
        throw Object.assign(new Error('the owner is not changed over this mount'), {code: 'EPERM'});
    }
    if (attrs.size !== null) {
        await fs.promises.truncate(real, attrs.size);
    }
    if (attrs.permissions !== null) {
        await fs.promises.chmod(real, attrs.permissions & 0o7777);
    }
    if (attrs.atime !== null) {
        await fs.promises.utimes(real, attrs.atime, attrs.mtime);
    }
}

async function fsetstat(file, attrs)
{
    if (attrs.uid !== null) {
        throw Object.assign(new Error('the owner is not changed over this mount'), {code: 'EPERM'});
    }
    if (attrs.size !== null) {
        await file.truncate(attrs.size);
    }
    if (attrs.permissions !== null) {
        await file.chmod(attrs.permissions & 0o7777);
    }
    if (attrs.atime !== null) {
        await file.utimes(attrs.atime, attrs.mtime);
    }
}

function changes_allowed(ctx)
{
    if (ctx.read_only) {
        throw Object.assign(new Error('this mount is read-only'), {code: 'EROFS'});
    }
}

// The path the client names, as the folder sees it: from `/`, its `..` stopping at `/`
function virtual_of(name)
{
    return path.posix.resolve('/', name);
}

// The path of this machine a name stands for, inside the folder or refused. `follow` follows
// a link at its last part, as stat does; without it the last part is taken as it is, as lstat
// and unlink take it. A link anywhere before the last part is followed, and must land inside.
async function real_of(ctx, name, follow)
{
    const virtual = virtual_of(name);
    if (virtual === '/') {
        return ctx.root;
    }
    const joined = path.join(ctx.root, virtual);
    if (follow) {
        return inside(ctx, await fs.promises.realpath(joined));
    }
    const parent = inside(ctx, await fs.promises.realpath(path.dirname(joined)));
    return path.join(parent, path.basename(joined));
}

function inside(ctx, real)
{
    if ((real !== ctx.root) && (real.startsWith(ctx.root + path.sep) === false)) {
        throw Object.assign(new Error('a link leads out of the folder'), {code: 'EACCES'});
    }
    return real;
}

// What was opened, as the kernel sees it: a link put in the way between the look and the open
// is caught here. Where there is no /proc, the look before the open is all there is.
async function fd_inside(ctx, fd)
{
    let real;
    try {
        real = await fs.promises.readlink(`/proc/self/fd/${fd}`);
    }
    catch {
        return;
    }
    inside(ctx, real);
}

function handles_room(ctx)
{
    if (ctx.handles.size >= HANDLES_MAX) {
        throw new Error(`${HANDLES_MAX} files and folders are open already`);
    }
}

function handle_send(ctx, id, value)
{
    ctx.next_handle++;
    const key = String(ctx.next_handle);
    ctx.handles.set(key, value);
    send(ctx, FXP.HANDLE, [u32(id), str(Buffer.from(key, 'latin1'))]);
}

function handle_of(ctx, handle, kind)
{
    const found = ctx.handles.get(handle.toString('latin1'));
    if ((found === undefined) || (found.kind !== kind)) {
        throw new Error('no such handle');
    }
    return found;
}

function handles_close(ctx)
{
    for (const found of ctx.handles.values()) {
        if (found.kind === 'file') {
            found.file.close().catch(function () {});
        }
    }
    ctx.handles.clear();
}

function attrs_send(ctx, id, stat)
{
    send(ctx, FXP.ATTRS, [u32(id), attrs_bytes(stat)]);
}

function name_send(ctx, id, entries)
{
    const parts = [u32(id), u32(entries.length)];
    for (const entry of entries) {
        parts.push(str(entry.name));
        parts.push(str((entry.attrs === null) ? entry.name : longname_of(entry.name, entry.attrs)));
        parts.push((entry.attrs === null) ? u32(0) : attrs_bytes(entry.attrs));
    }
    send(ctx, FXP.NAME, parts);
}

function send_status(ctx, id, code, message)
{
    send(ctx, FXP.STATUS, [u32(id), u32(code), str(message), str('')]);
}

function send(ctx, type, parts)
{
    if (ctx.out.destroyed || ctx.ended) {
        return;
    }
    const body = Buffer.concat([Buffer.from([type])].concat(parts));
    ctx.out.push(Buffer.concat([u32(body.length), body]));
}

// A system call's own message names the path on this machine, which the other end has no
// business knowing: it is told the kind of failure alone
function message_of(error)
{
    if (error.syscall === undefined) {
        return error.message;
    }
    return MESSAGES[error.code] || 'failure';
}

function status_of(error)
{
    switch (error.code) {
    case 'ENOENT':
    case 'ENOTDIR':
        return FX.NO_SUCH_FILE;
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
    case 'ELOOP':
        return FX.PERMISSION_DENIED;
    case 'EBADMSG':
        return FX.BAD_MESSAGE;
    default:
        return FX.FAILURE;
    }
}

function attrs_bytes(stat)
{
    return Buffer.concat([
        u32(ATTR.SIZE | ATTR.UIDGID | ATTR.PERMISSIONS | ATTR.ACMODTIME),
        u64(stat.size),
        u32(stat.uid),
        u32(stat.gid),
        u32(stat.mode),
        u32(Math.floor(stat.atimeMs/1000)),
        u32(Math.floor(stat.mtimeMs/1000)),
    ]);
}

function attrs_read(reader)
{
    const flags = reader.uint32();
    const out = {size: null, uid: null, gid: null, permissions: null, atime: null, mtime: null};
    if ((flags & ATTR.SIZE) !== 0) {
        out.size = reader.uint64();
    }
    if ((flags & ATTR.UIDGID) !== 0) {
        out.uid = reader.uint32();
        out.gid = reader.uint32();
    }
    if ((flags & ATTR.PERMISSIONS) !== 0) {
        out.permissions = reader.uint32();
    }
    if ((flags & ATTR.ACMODTIME) !== 0) {
        out.atime = reader.uint32();
        out.mtime = reader.uint32();
    }
    if ((flags & ATTR.EXTENDED) !== 0) {
        const count = reader.uint32();
        for (let i = 0; i < count; i++) {
            reader.string();
            reader.string();
        }
    }
    return out;
}

// The line `ls -l` prints, which sftp's own ls shows; sshfs reads the attributes instead
function longname_of(name, stat)
{
    const date = new Date(stat.mtimeMs);
    const when = `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2)} ${date.getUTCFullYear()}`;
    return `${mode_text(stat.mode)} ${stat.nlink} ${stat.uid} ${stat.gid} ${String(stat.size).padStart(8)} ${when} ${name}`;
}

function mode_text(mode)
{
    const kinds = {0o040000: 'd', 0o120000: 'l', 0o100000: '-', 0o020000: 'c', 0o060000: 'b', 0o010000: 'p', 0o140000: 's'};
    const kind = kinds[mode & 0o170000] || '?';
    const letters = 'rwxrwxrwx';
    let out = kind;
    for (let i = 0; i < 9; i++) {
        out += ((mode & (1 << (8 - i))) !== 0) ? letters[i] : '-';
    }
    return out;
}

function reader_make(buffer)
{
    let at = 0;
    function need(bytes) {
        if (at + bytes > buffer.length) {
            throw Object.assign(new Error('a packet cut short'), {code: 'EBADMSG'});
        }
    }
    return {
        byte: function () {
            need(1);
            return buffer[at++];
        },
        uint32: function () {
            need(4);
            const out = buffer.readUInt32BE(at);
            at += 4;
            return out;
        },
        uint64: function () {
            need(8);
            const out = Number(buffer.readBigUInt64BE(at));
            at += 8;
            return out;
        },
        string: function () {
            const length = this.uint32();
            need(length);
            const out = buffer.subarray(at, at + length);
            at += length;
            return out;
        },
        string_utf8: function () {
            return this.string().toString('utf8');
        },
    };
}

function u32(value)
{
    const out = Buffer.alloc(4);
    out.writeUInt32BE(value >>> 0);
    return out;
}

function u64(value)
{
    const out = Buffer.alloc(8);
    out.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(Number(value)))));
    return out;
}

function str(value)
{
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    return Buffer.concat([u32(bytes.length), bytes]);
}

module.exports = sftp_stream;
