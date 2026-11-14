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
// A count keeps the folders inside every folder of at least this much: a smaller one is
// counted again when opened, a moment for so little, and a whole disk's tree stays megabytes
// where every folder of it would be a hundred
const KEPT_LEAST = 16*1024**2;
// A count is kept this long after it was last asked for, then let go
const KEPT_IDLE_MS = 60*60*1000;

// The counts, running and kept, by the folder each counts
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
// du walks every folder under the one it counts, and the count keeps what it said of each
// (the folders of KEPT_LEAST and more with what is inside them) for an hour after it was last
// asked for. With kept, a folder that count holds is answered from it: at once once du has
// said it, while the count still runs too, and age_ms says how long ago it was counted. A
// folder it does not hold, or keeps without its insides, is counted on its own.
//
// The same disk mounted again inside the folder on its own, which du -x stops at, is counted
// too and added where it sits: a btrfs subvolume (/home on @home), a part bound elsewhere
// (parts). A folder a disk is mounted at also says what files deleted but still open hold on
// that disk (deleted, null when not looked at): no folder shows them.
//
//     params = {path, extras, kept}
//     {path, total, files, folders: [{path, size}], unread: [path], rooted, took_ms, age_ms,
//      type, parts: [{path, size}], deleted: {size, programs: [{pid, name, size}]}, extras}
async function agent_disk_usage(params, options)
{
    const folder = folder_asked(params);
    const kept = (params.kept === true) ? count_holding(folder, false) : null;
    let out = (kept === null) ? null : await answer_from(kept, folder);
    if (out === null) {
        const running = counts.get(folder);
        out = await answer_from(((running !== undefined) && (running.ended === null)) ? running : count_start(folder, options), folder);
    }
    if (params.extras === true) {
        const docker = await docker_info(options);
        out.extras = {docker: await docker_sizes(options), docker_root: docker.root, docker_driver: docker.driver, journal: await journal_size()};
    }
    return out;
}

// How a count of one folder goes while it runs, its own or that of a folder above it: the
// folders in it counted so far, biggest first, and the ones still to come. counting is false
// when no count holding it is running, which is also how a count that just ended answers: its
// whole answer is on its way.
//
//     {path, counting, took_ms, folders: [{path, size}], waiting, waiting_shown: [path]}
function agent_disk_usage_progress(params)
{
    const folder = folder_asked(params);
    const count = count_holding(folder, true);
    if (count === null) {
        return {path: folder, counting: false, took_ms: 0, folders: [], waiting: 0, waiting_shown: []};
    }
    const found = node_found(count, folder);
    const node = found.said ? found.node : undefined;
    const kids = found.said ? (((node === null) || (node === undefined)) ? null : node.kids) : count.tree.pending.get(folder);
    // A folder a part of the disk sits in is said once that part is in it too
    const held = new Set(count.parts.filter(v => (v !== folder) && mounts_read.inside_or_at(v, folder)).map(v => first_level(folder, v)));
    const folders = Array.from(kids || [], v => ({path: path.join(folder, v[0]), size: v[1].size})).filter(v => (held.has(v.path) === false)).sort((a, b) => b.size - a.size);
    if (count.listed.has(folder) === false) {
        count.listed.set(folder, folders_in(folder, count.parts));
    }
    const done = new Set(folders.map(v => v.path));
    const waiting = count.listed.get(folder).filter(v => (done.has(v) === false));
    return {
        path: folder,
        counting: true,
        took_ms: Date.now() - count.started,
        folders,
        waiting: waiting.length,
        waiting_shown: waiting.slice(0, WAITING_SHOWN),
    };
}

// The root half's own count: du as root, each folder said as du prints it, and the files
// deleted but still open on the folder's disk when asked. An agent that asks for depth all
// is told so first, and hears every folder of the walk and what du could not read; one from
// before hears the first level, as it always did.
async function agent_disk_usage_root(params, say)
{
    const folder = folder_asked(params);
    const all = (params.depth === 'all');
    if (all) {
        say('depth', 'all');
    }
    return await du_with_deleted(folder, all, (params.deleted === true), {
        line: function (text) {
            say('stdout', text);
        },
        error: function (text) {
            if (all) {
                say('stderr', text);
            }
        },
    });
}

async function du_with_deleted(folder, all, deleted, hear)
{
    const out = await agent_du(folder, all, hear);
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

// The newest count that holds a folder, running or kept, or running alone: one of a folder at
// or above it, on the same disk, or in a part of that disk it counts too. null where none does.
function count_holding(folder, running)
{
    let out = null;
    for (const count of counts.values()) {
        if ((running && (count.ended !== null)) || (count_holds(count, folder) === false)) {
            continue;
        }
        if ((out === null) || (count.started >= out.started)) {
            out = count;
        }
    }
    return out;
}

function count_holds(count, folder)
{
    if (mounts_read.inside_or_at(folder, count.folder) === false) {
        return false;
    }
    const mount = mounts_read.mount_of(folder, count.mounts);
    if ((mount === null) || (count.own === null)) {
        return (mount === count.own);
    }
    return (mount.point === count.own.point) || count.parts.includes(mount.point);
}

// One count of a folder, kept while it runs and after: the tree du has said so far, and the
// folders it has yet to say, read from a folder when asked (those on its own disk, as du -x
// counts, and the parts of it mounted there on their own). A count of a folder takes the place
// of those kept of it and of the folders in it.
function count_start(folder, options)
{
    for (const count of Array.from(counts.values())) {
        if ((count.ended !== null) && mounts_read.inside_or_at(count.folder, folder)) {
            count_drop(count);
        }
    }
    const mounts = mounts_read('/proc/self/mountinfo');
    const out = {
        folder,
        started: Date.now(),
        ended: null,
        mounts,
        own: mounts_read.mount_of(folder, mounts),
        parts: disk_parts(folder, mounts, dev_of),
        tree: tree_new(folder),
        rooted: null,
        unread: [],
        deleted: null,
        parts_counted: [],
        failed: null,
        waiters: [],
        listed: new Map(),
        timer: null,
    };
    counts.set(folder, out);
    count_run(out, options).then(function (failed) {
        count_end(out, failed);
    }, function (error) {
        count_end(out, error);
    });
    return out;
}

// du -x over the folder, then over each part of its disk mounted in it, one after another,
// each put into the tree where it sits. A folder waited for is answered as soon as du has
// said it. Answers why there is no count, or null.
async function count_run(count, options)
{
    const deleted = count.mounts.some(v => v.point === count.folder);
    const answer = await du_rooted(count.folder, options, deleted, {
        rooted: function (value) {
            count.rooted = value;
        },
        all: function () {
            count.tree.all = true;
        },
        line: function (text) {
            const where = tree_line(count.tree, text);
            if ((where !== null) && (count.waiters.length > 0)) {
                waiters_wake(count, where);
            }
        },
        error: function (text) {
            count.unread.push(...unread_of(text));
        },
    });
    count.rooted = answer.rooted;
    count.unread = unread_of(answer.stderr);
    count.deleted = (answer.deleted === undefined) ? null : answer.deleted;
    const root = count.tree.root;
    if (answer.killed) {
        return new Error(`counting ${count.folder} took longer than ${agent_du.DU_TIMEOUT_MS/60000} minutes: open a folder further down`);
    }
    if (root === null) {
        return new Error(`du could not count ${count.folder}: ${answer.stderr.split('\n')[0] || 'it said nothing'}`);
    }
    tree_trusted(count.tree);
    for (const part of count.parts) {
        const tree = tree_new(part);
        const one = await du_rooted(part, options, false, {
            rooted: function () {},
            all: function () {
                tree.all = true;
            },
            line: function (text) {
                tree_line(tree, text);
            },
            error: function () {},
        });
        count.unread.push(...unread_of(one.stderr));
        if (one.killed) {
            return new Error(`counting ${part} took longer than ${agent_du.DU_TIMEOUT_MS/60000} minutes: open a folder further down`);
        }
        if (tree.root !== null) {
            tree_trusted(tree);
            tree_graft(root, count.folder, part, tree.root);
            count.parts_counted.push({path: part, size: tree.root.size});
        }
    }
    return null;
}

// A count that ended is kept, one that failed is let go; whoever waited on it is answered
function count_end(count, failed)
{
    count.ended = Date.now();
    count.failed = failed;
    count.tree.pending = new Map();
    if (failed === null) {
        count_keep(count);
    }
    else {
        count_drop(count);
    }
    waiters_wake(count, null);
}

// Kept another hour from now
function count_keep(count)
{
    if (count.ended === null) {
        return;
    }
    clearTimeout(count.timer);
    count.timer = setTimeout(function () {
        count_drop(count);
    }, KEPT_IDLE_MS);
    count.timer.unref();
}

function count_drop(count)
{
    clearTimeout(count.timer);
    if (counts.get(count.folder) === count) {
        counts.delete(count.folder);
    }
}

// A folder's answer from a count, once the count has it; null where the count does not hold
// it, keeps it without its insides or failed: it is then counted on its own. The count's own
// folder is answered when the count ends, and so is a folder a part of the disk is in or at.
async function answer_from(count, folder)
{
    if (count_ready(count, folder) === false) {
        await new Promise(function (resolve) {
            count.waiters.push({folder, resolve});
        });
    }
    if (count.failed !== null) {
        if (folder === count.folder) {
            throw count.failed;
        }
        return null;
    }
    const node = node_found(count, folder).node;
    if ((node === null) || (node === undefined) || (node.kids === null)) {
        return null;
    }
    count_keep(count);
    return answer_of(count, folder, node);
}

function count_ready(count, folder)
{
    if (count.ended !== null) {
        return true;
    }
    if ((count.tree.all === false) || (folder === count.folder) || count.parts.some(v => mounts_read.inside_or_at(v, folder) || mounts_read.inside_or_at(folder, v))) {
        return false;
    }
    return node_found(count, folder).said;
}

// The ones waiting for a folder du has just said, or for anything it holds (where null): those
// whose answer is now there
function waiters_wake(count, where)
{
    count.waiters = count.waiters.filter(function (waiter) {
        if (((where !== null) && (mounts_read.inside_or_at(waiter.folder, where) === false)) || (count_ready(count, waiter.folder) === false)) {
            return true;
        }
        waiter.resolve();
        return false;
    });
}

function answer_of(count, folder, node)
{
    const folders = Array.from(node.kids, v => ({path: path.join(folder, v[0]), size: v[1].size})).sort((a, b) => b.size - a.size);
    const mount = mounts_read.mount_of(folder, count.mounts);
    const ended = (count.ended === null) ? Date.now() : count.ended;
    return {
        path: folder,
        total: node.size,
        files: Math.max(0, node.size - folders.reduce((sum, v) => sum + v.size, 0)),
        folders,
        unread: count.unread.filter(v => mounts_read.inside_or_at(v, folder)),
        rooted: count.rooted,
        took_ms: ended - count.started,
        age_ms: Date.now() - ended,
        type: (mount === null) ? null : mount.type,
        parts: count.parts_counted.filter(v => (v.path !== folder) && mounts_read.inside_or_at(v.path, folder)),
        deleted: (folder === count.folder) ? count.deleted : null,
        extras: null,
    };
}

// A folder in a count: said once du has said it or a folder above it, its node undefined
// where it is not in the count and null where a folder above it is kept without its insides
//
//     {said, node}
function node_found(count, folder)
{
    const tree = count.tree;
    if (tree.root !== null) {
        return {said: true, node: node_under(tree.root, count.folder, folder)};
    }
    // Until the count's own folder is said, the folders said wait in their parents' lists
    for (let at = folder; (at !== count.folder) && (at !== '/'); at = path.dirname(at)) {
        const kids = tree.pending.get(path.dirname(at));
        const node = (kids === undefined) ? undefined : kids.get(path.basename(at));
        if (node !== undefined) {
            return {said: true, node: node_under(node, at, folder)};
        }
    }
    return {said: false, node: undefined};
}

function node_under(node, at, folder)
{
    let out = node;
    for (const name of path.relative(at, folder).split('/').filter(v => (v !== ''))) {
        if (out.kids === null) {
            return null;
        }
        out = out.kids.get(name);
        if (out === undefined) {
            return undefined;
        }
    }
    return out;
}

// What du says of one folder, as a tree: every folder it said, in the folder above it
//
//     {top, all, pending: Map(path -> Map(name -> node)), root: node | null}
//     node = {size, kids: Map(name -> node) | null}
function tree_new(top)
{
    return {top, all: false, pending: new Map(), root: null};
}

// One folder du has said, "4096\t/var/log": du says every folder in it before it, and they
// wait under its name; they go into it, and it waits in its parent's. One under KEPT_LEAST
// keeps its size alone. Answers the folder, or null for a line that is none.
function tree_line(tree, text)
{
    const tab = text.indexOf('\t');
    const size = Number(text.slice(0, tab));
    const where = text.slice(tab + 1);
    if ((tab <= 0) || (Number.isFinite(size) === false) || (tree.root !== null) || (mounts_read.inside_or_at(where, tree.top) === false)) {
        return null;
    }
    const kids = tree.pending.get(where) || new Map();
    tree.pending.delete(where);
    const node = {size, kids: ((size >= KEPT_LEAST) || (where === tree.top)) ? kids : null};
    if (where === tree.top) {
        tree.root = node;
        return where;
    }
    const parent = path.dirname(where);
    if (tree.pending.has(parent) === false) {
        tree.pending.set(parent, new Map());
    }
    tree.pending.get(parent).set(path.basename(where), node);
    return where;
}

// A root half from before whole trees said the first level alone: what is inside those
// folders is not known, and they are counted on their own when opened
function tree_trusted(tree)
{
    if ((tree.all === false) && (tree.root !== null)) {
        for (const node of tree.root.kids.values()) {
            node.kids = null;
        }
    }
}

// A part of the disk mounted inside the folder on its own, counted apart, put where it sits:
// in place of what du said of its mount point, every folder above it grown by what it adds.
// Under a folder kept without its insides, only the folders above grow.
function tree_graft(root, folder, part, node)
{
    const names = path.relative(folder, part).split('/');
    const before = node_under(root, folder, part);
    const added = node.size - (((before === null) || (before === undefined)) ? 0 : before.size);
    let here = root;
    here.size += added;
    for (const [at, name] of names.entries()) {
        if (here.kids === null) {
            return;
        }
        if (at === (names.length - 1)) {
            here.kids.set(name, node);
            return;
        }
        here = here.kids.get(name);
        if (here === undefined) {
            return;
        }
        here.size += added;
    }
}

// As root where the root half is there, and older root halves count as no root half. A root
// half from before deleted files were looked at says nothing of them: deleted is then
// undefined. hear.all is told when every folder of the walk is said, not the first level
// alone, and hear.rooted as soon as it is known who counts.
//
//     hear = {rooted: function (yes), all: function (), line: function (text), error: function (text)}
async function du_rooted(folder, options, deleted, hear)
{
    let rooted = true;
    let told = false;
    const out = await agent_root_or(options, 'disk_usage', {path: folder, deleted, depth: 'all'}, function (stream, text) {
        if (told === false) {
            told = true;
            hear.rooted(true);
        }
        if (stream === 'depth') {
            hear.all();
        }
        else if (stream === 'stdout') {
            hear.line(text);
        }
        else if (stream === 'stderr') {
            hear.error(text);
        }
    }, function () {
        rooted = false;
        hear.rooted(false);
        hear.all();
        return du_with_deleted(folder, true, deleted, hear);
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
agent_disk_usage.tree_graft = tree_graft;
agent_disk_usage.KEPT_LEAST = KEPT_LEAST;

module.exports = agent_disk_usage;
