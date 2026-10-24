const agent_deleted_open = require('./agent_deleted_open');
const agent_du = require('./agent_du');
const agent_root_or = require('./agent_root_or');
const agent_shell = require('./agent_shell');
const fs = require('fs');
const mounts_read = require('./mounts_read');
const path = require('path');

// docker and journalctl say their sizes for people, docker in thousands, journald in 1024s
const DOCKER_UNITS = {B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12};
const JOURNAL_UNITS = {B: 1, K: 1024, M: 1024**2, G: 1024**3, T: 1024**4};
// The folders still to come, as many as a page shows of them
const WAITING_SHOWN = 20;

// The counts running now, by folder: what each has counted so far, for progress to answer
const counts = new Map();

// What takes the space in one folder of this machine, on its own disk alone (`du -x`): the
// folders in it with their sizes, biggest first, what lies in the folder itself, and the
// folders that could not be read, whose size is then in no folder here. Only names and sizes:
// nothing is read out of a file. It is counted as root where this machine has the agent's
// root half, which reads every folder, and as the agent's own user where it has none. With
// extras, what docker and the journal say they keep, and where docker keeps it, which a count
// as a user often cannot see into. A folder asked for again while it is counted joins that
// count.
//
// The same disk mounted again inside the folder on its own, which du -x stops at, is counted
// too and added where it sits: a btrfs subvolume (/home on @home), a part bound elsewhere
// (parts). A folder a disk is mounted at also says what files deleted but still open hold on
// that disk (deleted, null when not looked at): no folder shows them.
//
//     {path, total, files, folders: [{path, size}], unread: [path], rooted, took_ms,
//      type, parts: [{path, size}], deleted: {size, programs: [{pid, name, size}]}, extras}
async function agent_disk_usage(params, options)
{
    const folder = folder_asked(params);
    const count = counts.get(folder) || count_start(folder, options);
    const answer = await count.promise;
    if (answer.killed) {
        throw new Error(`counting ${folder} took longer than ${agent_du.DU_TIMEOUT_MS/60000} minutes: open a folder further down`);
    }
    const sizes = new Map(answer.sizes);
    const total = sizes.get(folder);
    if (total === undefined) {
        throw new Error(`du could not count ${folder}: ${answer.stderr.split('\n')[0] || 'it said nothing'}`);
    }
    sizes.delete(folder);
    const folders = Array.from(sizes, v => ({path: v[0], size: v[1]})).sort((a, b) => b.size - a.size);
    const out = {
        path: folder,
        total,
        files: Math.max(0, total - folders.reduce((sum, v) => sum + v.size, 0)),
        folders,
        unread: answer.unread,
        rooted: answer.rooted,
        took_ms: Date.now() - count.started,
        type: answer.type,
        parts: answer.parts,
        deleted: answer.deleted,
        extras: null,
    };
    if (params.extras === true) {
        const docker = await docker_info(options);
        out.extras = {docker: await docker_sizes(options), docker_root: docker.root, docker_driver: docker.driver, journal: await journal_size()};
    }
    return out;
}

// How a count of one folder goes while it runs: the folders counted so far, biggest first,
// and the ones still to come. counting is false when no count of it is running, which is
// also how a count that just ended answers: its whole answer is on its way.
//
//     {path, counting, took_ms, folders: [{path, size}], waiting, waiting_shown: [path]}
function agent_disk_usage_progress(params)
{
    const folder = folder_asked(params);
    const count = counts.get(folder);
    if (count === undefined) {
        return {path: folder, counting: false, took_ms: 0, folders: [], waiting: 0, waiting_shown: []};
    }
    const waiting = count.waiting.filter(v => (count.done.has(v) === false));
    return {
        path: folder,
        counting: true,
        took_ms: Date.now() - count.started,
        folders: Array.from(count.done, v => ({path: v[0], size: v[1]})).sort((a, b) => b.size - a.size),
        waiting: waiting.length,
        waiting_shown: waiting.slice(0, WAITING_SHOWN),
    };
}

// The root half's own count: du as root, each line said as du prints it, and the files
// deleted but still open on the folder's disk when asked
async function agent_disk_usage_root(params, say)
{
    const folder = folder_asked(params);
    return await du_with_deleted(folder, (params.deleted === true), v => say('stdout', v));
}

async function du_with_deleted(folder, deleted, on_line)
{
    const out = await agent_du(folder, on_line);
    out.deleted = deleted ? agent_deleted_open(folder) : null;
    return out;
}

function folder_asked(params)
{
    const asked = String(params.path || '');
    if (path.isAbsolute(asked) === false) {
        throw Object.assign(new Error('path: a folder from the root, /var'), {status: 400});
    }
    return path.resolve(asked);
}

// One count of a folder, kept while it runs: the folders du has said so far, and the folders
// it has yet to say, read from the folder itself (those on its own disk, as du -x counts, and
// the parts of it mounted there on their own)
function count_start(folder, options)
{
    const mounts = mounts_read('/proc/self/mountinfo');
    const parts = disk_parts(folder, mounts, dev_of);
    const out = {started: Date.now(), done: new Map(), waiting: folders_in(folder, parts), promise: null};
    out.promise = count_run(folder, options, mounts, parts, out.done).finally(function () {
        counts.delete(folder);
    });
    counts.set(folder, out);
    return out;
}

// du -x over the folder, then over each part of its disk mounted in it, one after another. A
// folder a part sits in is said as done once its parts are in it too.
//
//     {sizes, unread, rooted, killed, stderr, type, parts: [{path, size}], deleted}
async function count_run(folder, options, mounts, parts, done)
{
    const held = new Set(parts.map(v => first_level(folder, v)));
    const deleted = mounts.some(v => v.point === folder);
    const answer = await du_rooted(folder, options, deleted, function (line) {
        for (const [where, size] of du_read(line)) {
            if ((where !== folder) && (held.has(where) === false)) {
                done.set(where, size);
            }
        }
    });
    const own = mounts_read.mount_of(folder, mounts);
    const out = {
        sizes: du_read(answer.stdout),
        unread: unread_of(answer.stderr),
        rooted: answer.rooted,
        killed: answer.killed,
        stderr: answer.stderr,
        type: (own === null) ? null : own.type,
        parts: [],
        deleted: answer.deleted || null,
    };
    for (const part of parts) {
        if ((out.killed) || (out.sizes.has(folder) === false)) {
            break;
        }
        const one = await du_rooted(part, options, false, function () {});
        const size = du_read(one.stdout).get(part);
        out.killed = one.killed;
        out.unread.push(...unread_of(one.stderr));
        if (size !== undefined) {
            out.parts.push({path: part, size});
        }
    }
    out.sizes = sizes_with_parts(folder, out.sizes, out.parts);
    for (const where of held) {
        if (out.sizes.has(where)) {
            done.set(where, out.sizes.get(where));
        }
    }
    return out;
}

// As root where the root half is there, and older root halves count as no root half. A root
// half from before deleted files were looked at says nothing of them: deleted is then undefined.
async function du_rooted(folder, options, deleted, on_line)
{
    let rooted = true;
    const out = await agent_root_or(options, 'disk_usage', {path: folder, deleted}, function (stream, text) {
        if (stream === 'stdout') {
            on_line(text);
        }
    }, function () {
        rooted = false;
        return du_with_deleted(folder, deleted, on_line);
    });
    out.rooted = rooted;
    return out;
}

// The places in a folder where its own disk is mounted again on its own, and du -x stops: a
// btrfs subvolume mounted at /home, a folder of the disk bound somewhere. The filesystem is the
// same by mountinfo's dev; du stops where stat's dev changes. A place whose stat dev is one
// counted already (the folder's own subvolume bound again) is left out: it would count twice.
// Shallowest first.
//
//     [path]
function disk_parts(folder, mounts, dev_of_path)
{
    const own = mounts_read.mount_of(folder, mounts);
    if (own === null) {
        return [];
    }
    const seen = new Set([dev_of_path(folder)]);
    const out = [];
    const points = Array.from(new Set(mounts.map(v => v.point))).filter(v => (v !== folder) && mounts_read.inside_or_at(v, folder));
    for (const point of points.sort((a, b) => a.length - b.length)) {
        const dev = dev_of_path(point);
        if ((mounts_read.mount_of(point, mounts).dev !== own.dev) || (dev === null) || seen.has(dev)) {
            continue;
        }
        seen.add(dev);
        out.push(point);
    }
    return out;
}

// What du -x said, with each part's size in the folder of the first level it sits in, and in
// the whole. A part that is that folder takes the place of what du said of its mount point.
function sizes_with_parts(folder, sizes, parts)
{
    const out = new Map(sizes);
    if (out.has(folder) === false) {
        return out;
    }
    for (const part of parts) {
        const level = first_level(folder, part.path);
        const before = (level === part.path) ? (out.get(level) || 0) : 0;
        out.set(level, (out.get(level) || 0) - before + part.size);
        out.set(folder, out.get(folder) - before + part.size);
    }
    return out;
}

// /home/user/cache in / -> /home
function first_level(folder, file)
{
    const rest = file.slice((folder === '/') ? 1 : folder.length + 1);
    return path.join(folder, rest.split('/')[0]);
}

function dev_of(file)
{
    try {
        return fs.statSync(file).dev;
    }
    catch {
        return null;
    }
}

// The folders right in this one that du is about to count: those on its disk, as du -x counts
// them, and those the disk is mounted at again. A folder this user cannot list has none to
// tell, and du as root counts them all the same.
function folders_in(folder, parts)
{
    try {
        const disk = fs.statSync(folder).dev;
        const out = [];
        for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
            if (entry.isDirectory() === false) {
                continue;
            }
            const where = path.join(folder, entry.name);
            if ((dev_of(where) === disk) || parts.includes(where)) {
                out.push(where);
            }
        }
        return out;
    }
    catch {
        return [];
    }
}

// "4096\t/var/log" a line; a name with a tab or a newline in it is cut there, and is dropped
function du_read(text)
{
    const out = new Map();
    for (const line of text.split('\n')) {
        const tab = line.indexOf('\t');
        const size = Number(line.slice(0, tab));
        if ((tab > 0) && Number.isFinite(size)) {
            out.set(line.slice(tab + 1), size);
        }
    }
    return out;
}

// du: cannot read directory '/var/lib/docker': Permission denied
// (or /usr/bin/du:, and ‘’ for quotes where a locale got past LC_ALL)
function unread_of(text)
{
    const out = [];
    for (const match of text.matchAll(/^(?:\S*\/)?du: cannot (?:read directory|access) ['‘](.+)['’]: (?:Permission denied|Operation not permitted)$/gm)) {
        out.push(match[1]);
    }
    return out;
}

// Images, containers, volumes, the build cache: [{what, size}], null where docker is not here
async function docker_sizes(options)
{
    const answer = await agent_shell([options.docker, 'system', 'df', '--format', '{{json .}}'], {timeout: 60000});
    if (answer.ok === false) {
        return null;
    }
    const out = [];
    for (const line of answer.stdout.split('\n').filter(v => v !== '')) {
        const row = JSON.parse(line);
        const size = human_bytes(row.Size, DOCKER_UNITS);
        if (size > 0) {
            out.push({what: String(row.Type).toLowerCase(), size});
        }
    }
    return out;
}

// Where docker keeps what it has, /var/lib/docker unless it was told otherwise, and how: on
// btrfs (driver btrfs) each layer is a subvolume of its own, which du -x does not go into.
// Nulls where docker is not here.
//
//     {root, driver}
async function docker_info(options)
{
    const answer = await agent_shell([options.docker, 'info', '--format', '{{.Driver}}\t{{.DockerRootDir}}'], {timeout: 30000});
    const tab = answer.stdout.indexOf('\t');
    if ((answer.ok === false) || (tab === -1)) {
        return {root: null, driver: null};
    }
    return {root: answer.stdout.slice(tab + 1) || null, driver: answer.stdout.slice(0, tab) || null};
}

// "Archived and active journals take up 3.9G in the file system."; null where it cannot say
async function journal_size()
{
    const answer = await agent_shell(['journalctl', '--disk-usage'], {timeout: 30000});
    const match = /take up ([\d.]+)([BKMGT])/.exec(answer.stdout);
    return (match === null) ? null : human_bytes(`${match[1]}${match[2]}`, JOURNAL_UNITS);
}

function human_bytes(text, units)
{
    const match = /^([\d.]+)\s*([A-Za-z]*)/.exec(String(text).trim());
    if ((match === null) || (units[match[2] || 'B'] === undefined)) {
        return 0;
    }
    return Math.round(parseFloat(match[1])*units[match[2] || 'B']);
}

agent_disk_usage.progress = agent_disk_usage_progress;
agent_disk_usage.root = agent_disk_usage_root;
agent_disk_usage.unread_of = unread_of;
agent_disk_usage.disk_parts = disk_parts;
agent_disk_usage.sizes_with_parts = sizes_with_parts;

module.exports = agent_disk_usage;
