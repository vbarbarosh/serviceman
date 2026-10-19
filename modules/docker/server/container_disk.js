const http = require('http');
const path = require('path');
const stream = require('stream');

// Go's os.ModeDir, the bit docker sets in a folder's mode
const MODE_DIR = 2147483648;

// How many links in a row are followed before a name is taken for a loop
const LINK_HOPS = 8;

// One folder's names, kinds, sizes and dates, from inside the container: links are followed,
// so a link to a folder opens like one. find and stat are in every image with a shell —
// busybox has both.
const LIST_FORMAT = '%F/%s/%Y/%n';

// A File Manager disk inside one container, over the Engine API alone: nothing is installed
// in the container and nothing is mounted. A folder is listed by find and stat run in it, a
// file is read and written through its archive, a name is weighed by the archive's header,
// many files in one tar are unpacked by docker, and renaming, deleting, making a folder,
// packing several names and the room left (df) are commands run in it, as its own user. A
// container with no shell in it has no folder listing.
//
//     connect()   a stream to the Engine API, as the Docker module's host gives it
//     id          the container
function container_disk(connect, id)
{
    return {
        list: async function (asked) {
            const dir = ((asked === null) || (asked === '')) ? await working_dir(connect, id) : path.posix.normalize(asked);
            const answer = await exec_run(connect, id, ['find', dir, '-mindepth', '1', '-maxdepth', '1', '-exec', 'stat', '-L', '-c', LIST_FORMAT, '{}', '+']);
            if ((answer.code !== 0) && (answer.stdout === '')) {
                throw new Error(answer.stderr.trim() || `find ended with ${answer.code} in the container`);
            }
            const items = [];
            for (const line of answer.stdout.split('\n')) {
                const found = /^([^/]+)\/(\d+)\/(\d+)\/(.*)$/.exec(line);
                if (found !== null) {
                    const kind = (found[1] === 'directory') ? 'dir' : 'file';
                    items.push({name: path.posix.basename(found[4]), kind, size: (kind === 'file') ? Number(found[2]) : null, mtime_ms: Number(found[3])*1000});
                }
            }
            items.sort((a, b) => (a.kind === b.kind) ? a.name.localeCompare(b.name) : ((a.kind === 'dir') ? -1 : 1));
            return {path: dir, items};
        },
        stat: async function (asked) {
            return (await path_resolved(connect, id, path.posix.normalize(asked))).stat;
        },
        read: function (asked, range) {
            return stream.Readable.from(file_bytes(connect, id, path.posix.normalize(asked), range));
        },
        tar: function (dir, names) {
            return stream.Readable.from(exec_bytes(connect, id, ['tar', '-cf', '-', '-C', path.posix.normalize(dir)].concat(names)));
        },
        write: function (dir, name, source) {
            return file_put(connect, id, path.posix.normalize(dir), name, source);
        },
        write_tar: function (dir, source) {
            return tar_put(connect, id, path.posix.normalize(dir), source);
        },
        rename: function (from, to) {
            return exec_or_throw(connect, id, ['mv', path.posix.normalize(from), path.posix.normalize(to)]);
        },
        remove: function (asked) {
            const full = path.posix.normalize(asked);
            if (full === '/') {
                throw new Error('/ is not a thing the File Manager deletes');
            }
            return exec_or_throw(connect, id, ['rm', '-rf', full]);
        },
        mkdir: function (asked) {
            return exec_or_throw(connect, id, ['mkdir', '-p', path.posix.normalize(asked)]);
        },
        room: async function (asked) {
            return await disk_room(connect, id, ((asked === null) || (asked === '')) ? await working_dir(connect, id) : path.posix.normalize(asked));
        },
    };
}

// Where the container starts: its working folder, or the root
async function working_dir(connect, id)
{
    const answer = await engine_call(connect, 'GET', `/containers/${id}/json`);
    if (answer.status !== 200) {
        throw new Error(engine_said(answer));
    }
    const config = JSON.parse(answer.body).Config;
    return (config && config.WorkingDir) ? config.WorkingDir : '/';
}

// A link followed to what it names, the way the agent's own file manager follows one: a
// link's size is the length of the path it holds, and docker may archive the link itself
async function path_resolved(connect, id, full)
{
    let at = full;
    for (let hop = 0; hop < LINK_HOPS; hop++) {
        const found = await path_stat(connect, id, at);
        if (found === null) {
            throw new Error(`ENOENT: ${full} is not in the container`);
        }
        if ((found.link === null) || (found.link === at)) {
            return {full: at, stat: {kind: found.kind, size: found.size, mtime_ms: found.mtime_ms, mode: found.mode}};
        }
        at = path.posix.resolve(path.posix.dirname(at), found.link);
    }
    throw new Error(`${full} is a link that goes round in circles`);
}

// A name's kind, size and date, from the header docker puts on its archive; null for none
async function path_stat(connect, id, full)
{
    const answer = await engine_call(connect, 'HEAD', `/containers/${id}/archive?path=${encodeURIComponent(full)}`);
    if (answer.status === 404) {
        return null;
    }
    if (answer.status !== 200) {
        throw new Error(engine_said(answer));
    }
    const said = JSON.parse(Buffer.from(String(answer.headers['x-docker-container-path-stat']), 'base64').toString('utf8'));
    const dir = (said.isDir === true) || (Math.floor(said.mode/MODE_DIR) % 2 === 1);
    return {kind: dir ? 'dir' : 'file', size: said.size, mtime_ms: Date.parse(said.mtime), mode: said.mode % 4096, link: said.linkTarget ? said.linkTarget : null};
}

// The bytes of one file, out of the archive docker writes of it: past the headers (a long name
// comes as a header of its own), as many as the entry says, the range of them asked for
async function* file_bytes(connect, id, asked, range)
{
    const full = (await path_resolved(connect, id, asked)).full;
    const answer = await engine_stream(connect, 'GET', `/containers/${id}/archive?path=${encodeURIComponent(full)}`);
    if (answer.statusCode !== 200) {
        throw new Error(engine_said({status: answer.statusCode, body: await body_text(answer)}));
    }
    const first = (range === null) ? 0 : range.start;
    const last = (range === null) ? Infinity : range.end;
    let held = Buffer.alloc(0);
    // Bytes of a header about the next entry, still to pass over
    let skip = 0;
    // Bytes of the file still to come, once its header is read
    let left = null;
    let at = 0;
    try {
        for await (const chunk of answer) {
            held = Buffer.concat([held, chunk]);
            for (;;) {
                if (skip > 0) {
                    const passed = Math.min(skip, held.length);
                    held = held.subarray(passed);
                    skip -= passed;
                    if (skip > 0) {
                        break;
                    }
                }
                if (left === null) {
                    if (held.length < 512) {
                        break;
                    }
                    const size = parseInt(held.subarray(124, 136).toString('latin1').replace(/\0.*$/, '').trim() || '0', 8);
                    const type = String.fromCharCode(held[156]);
                    held = held.subarray(512);
                    // A long name or other extended header comes as an entry of its own
                    if ((type === 'x') || (type === 'g') || (type === 'L') || (type === 'K')) {
                        skip = Math.ceil(size/512)*512;
                        continue;
                    }
                    left = size;
                    if (left === 0) {
                        return;
                    }
                }
                const take = held.subarray(0, left);
                held = held.subarray(take.length);
                left -= take.length;
                const from = Math.max(0, first - at);
                const to = Math.min(take.length, last - at + 1);
                if (to > from) {
                    yield take.subarray(from, to);
                }
                at += take.length;
                if ((left === 0) || (at > last)) {
                    return;
                }
                break;
            }
        }
    }
    finally {
        answer.destroy();
    }
}

// The room left on the disk a folder of the container is on, or will be on once made, as df
// says it: free bytes, and free inodes where its df counts them (busybox may have no -i)
async function disk_room(connect, id, full)
{
    let at = full;
    while ((await path_stat(connect, id, at) === null) && (at !== path.posix.dirname(at))) {
        at = path.posix.dirname(at);
    }
    const bytes = await exec_run(connect, id, ['df', '-Pk', at]);
    const blocks = df_numbers(bytes.stdout);
    if ((bytes.code !== 0) || (blocks === null)) {
        throw new Error(bytes.stderr.trim() || `df ended with ${bytes.code} in the container`);
    }
    const inodes = await exec_run(connect, id, ['df', '-Pi', at]);
    const counted = (inodes.code === 0) ? df_numbers(inodes.stdout) : null;
    return {bytes_free: blocks.free*1024, inodes_free: ((counted === null) || (counted.total === 0)) ? null : counted.free};
}

// The numbers of df -P's one line about a disk: total, used, free, then a share and where it is
// mounted; null for anything else
function df_numbers(text)
{
    const found = /\s(\d+)\s+(\d+)\s+(\d+)\s+(?:\d+%|-)\s+\/.*$/.exec(text.trim().split('\n').pop());
    if (found === null) {
        return null;
    }
    return {total: Number(found[1]), used: Number(found[2]), free: Number(found[3])};
}

// A file into a folder of the container, as an archive of one entry that docker unpacks there.
// A file that is there keeps its permissions — an edited script stays runnable.
async function file_put(connect, id, dir, name, source)
{
    const size = Number((source.headers === undefined) ? NaN : source.headers['content-length']);
    if (Number.isInteger(size) === false) {
        throw new Error('a file goes into a container with its length said first');
    }
    if (Buffer.byteLength(name) > 100) {
        throw new Error(`${name} is a name too long for a container's archive`);
    }
    // A file that is there is written over as itself: through a link to the file it names,
    // with the permissions that file has
    let where = {dir, name, mode: 0o644, replaced: false};
    if (await path_stat(connect, id, path.posix.join(dir, name)) !== null) {
        const found = await path_resolved(connect, id, path.posix.join(dir, name));
        where = {dir: path.posix.dirname(found.full), name: path.posix.basename(found.full), mode: found.stat.mode, replaced: true};
    }
    const header = tar_header(where.name, size, where.mode);
    const pad = Buffer.alloc((512 - size % 512) % 512 + 1024);
    const answer = await new Promise(function (resolve, reject) {
        const request = http.request({createConnection: connect, method: 'PUT', path: `/containers/${id}/archive?path=${encodeURIComponent(where.dir)}`, headers: {'host': 'docker', 'content-type': 'application/x-tar', 'content-length': header.length + size + pad.length}}, resolve);
        request.on('error', reject);
        request.write(header);
        source.on('data', function (chunk) {
            if (request.write(chunk) === false) {
                source.pause();
                request.once('drain', () => source.resume());
            }
        });
        source.on('end', () => request.end(pad));
        source.on('aborted', () => request.destroy(new Error('the copy was given up before the file was in')));
        source.on('error', function (error) {
            request.destroy(error);
        });
    });
    const said = await body_text(answer);
    if (answer.statusCode !== 200) {
        throw new Error(engine_said({status: answer.statusCode, body: said}));
    }
    return {path: path.posix.join(dir, name), bytes: size, replaced: where.replaced};
}

// Many files as one tar, unpacked by docker into a folder of the container, which is made first
// when it is not there; docker makes the folders under it. The body goes on as it comes, with
// its length when the request said one. Docker does not say what it unpacked, so the counts
// are left to whoever read the tar on its way here.
async function tar_put(connect, id, dir, source)
{
    if (await path_stat(connect, id, dir) === null) {
        await exec_or_throw(connect, id, ['mkdir', '-p', dir]);
    }
    const size = Number((source.headers === undefined) ? NaN : source.headers['content-length']);
    const headers = Number.isInteger(size) ? {'host': 'docker', 'content-type': 'application/x-tar', 'content-length': size} : {'host': 'docker', 'content-type': 'application/x-tar'};
    const answer = await new Promise(function (resolve, reject) {
        const request = http.request({createConnection: connect, method: 'PUT', path: `/containers/${id}/archive?path=${encodeURIComponent(dir)}`, headers}, resolve);
        request.on('error', reject);
        source.on('aborted', () => request.destroy(new Error('the copy was given up before the tar was in')));
        source.on('error', function (error) {
            request.destroy(error);
        });
        source.pipe(request);
    });
    const said = await body_text(answer);
    if (answer.statusCode !== 200) {
        throw new Error(engine_said({status: answer.statusCode, body: said}));
    }
    return {files: null, bytes: null};
}

// The 512 bytes that say one file of an archive: name, mode, size, date, and their checksum
function tar_header(name, size, mode)
{
    const out = Buffer.alloc(512);
    out.write(name, 0, 100, 'utf8');
    out.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 'latin1');
    out.write('0000000\0', 108, 'latin1');
    out.write('0000000\0', 116, 'latin1');
    out.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
    out.write(`${Math.floor(Date.now()/1000).toString(8).padStart(11, '0')}\0`, 136, 'latin1');
    out.write('        ', 148, 'latin1');
    out.write('0', 156, 'latin1');
    out.write('ustar\0', 257, 'latin1');
    out.write('00', 263, 'latin1');
    let sum = 0;
    for (const byte of out) {
        sum += byte;
    }
    out.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    return out;
}

async function exec_or_throw(connect, id, cmd)
{
    const answer = await exec_run(connect, id, cmd);
    if (answer.code !== 0) {
        throw new Error(answer.stderr.trim() || `${cmd[0]} ended with ${answer.code} in the container`);
    }
    return {};
}

// A command run in the container to its end: what it printed on each stream, and its code
async function exec_run(connect, id, cmd)
{
    const started = await exec_start(connect, id, cmd);
    const chunks = {stdout: [], stderr: []};
    for await (const frame of frames(started.answer)) {
        chunks[frame.stream].push(frame.data);
    }
    return {code: await exec_code(connect, started.exec), stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8')};
}

// A command's output as it comes, for one that writes much — a tar of a folder. A command that
// fails having written nothing is an error, with what it said.
async function* exec_bytes(connect, id, cmd)
{
    const started = await exec_start(connect, id, cmd);
    const said = [];
    let wrote = false;
    try {
        for await (const frame of frames(started.answer)) {
            if (frame.stream === 'stdout') {
                wrote = true;
                yield frame.data;
            }
            else {
                said.push(frame.data);
            }
        }
    }
    finally {
        started.answer.destroy();
    }
    const code = await exec_code(connect, started.exec);
    if ((code !== 0) && (wrote === false)) {
        throw new Error(Buffer.concat(said).toString('utf8').trim() || `${cmd[0]} ended with ${code} in the container`);
    }
}

async function exec_start(connect, id, cmd)
{
    const created = await engine_call(connect, 'POST', `/containers/${id}/exec`, {AttachStdout: true, AttachStderr: true, Tty: false, Cmd: cmd});
    if (created.status !== 201) {
        throw new Error(engine_said(created));
    }
    const exec = JSON.parse(created.body).Id;
    const answer = await engine_stream(connect, 'POST', `/exec/${exec}/start`, {Detach: false, Tty: false});
    return {exec, answer};
}

async function exec_code(connect, exec)
{
    const answer = await engine_call(connect, 'GET', `/exec/${exec}/json`);
    return (answer.status === 200) ? JSON.parse(answer.body).ExitCode : null;
}

// Docker's two streams in one, without a terminal: each frame is 8 bytes — the stream, three
// zeros, the length — then that many bytes
async function* frames(answer)
{
    let held = Buffer.alloc(0);
    for await (const chunk of answer) {
        held = Buffer.concat([held, chunk]);
        while (held.length >= 8) {
            const size = held.readUInt32BE(4);
            if (held.length < 8 + size) {
                break;
            }
            yield {stream: (held[0] === 2) ? 'stderr' : 'stdout', data: held.subarray(8, 8 + size)};
            held = held.subarray(8 + size);
        }
    }
}

// One request to the Engine API, answered whole
async function engine_call(connect, method, pathname, value)
{
    const answer = await engine_stream(connect, method, pathname, value);
    return {status: answer.statusCode, headers: answer.headers, body: await body_text(answer)};
}

// One request to the Engine API, its answer as it streams
function engine_stream(connect, method, pathname, value)
{
    return new Promise(function (resolve, reject) {
        const body = (value === undefined) ? null : JSON.stringify(value);
        const headers = (body === null) ? {host: 'docker'} : {'host': 'docker', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body)};
        const request = http.request({createConnection: connect, method, path: pathname, headers}, resolve);
        request.on('error', reject);
        request.end((body === null) ? undefined : body);
    });
}

async function body_text(answer)
{
    const chunks = [];
    for await (const chunk of answer) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function engine_said(answer)
{
    try {
        return `docker answered ${answer.status}: ${JSON.parse(answer.body).message}`;
    }
    catch {
        return `docker answered ${answer.status}`;
    }
}

module.exports = container_disk;
