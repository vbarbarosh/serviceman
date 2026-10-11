const EventEmitter = require('events');
const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');

// A file is told about once it has been quiet this long, so a file being written is not
// fetched half way; one written for longer is told about at least this often
const QUIET_MS = 300;
const QUIET_MAX_MS = 5000;
// Every folder of a tree is one inotify watch, and a machine has a few thousand of them for
// everything its user runs
const TREE_MAX_DIRS = 5000;

// The folders watched now, each once, however many listen to it: key → watch
const watches = new Map();

// One folder of this machine, watched: what is created in it, changed or removed comes out as a
// line of JSON, once it has been quiet for a moment. `tree` watches every folder under it too,
// but the names in `skip`, wherever they are. It answers the way a socket does, so the tunnel
// carries it to the host; closing it stops listening, and the last to close ends the watch.
//
//     target = {path, tree, skip}
//     {"type": "ready", "path", "tree", "skip"}                   first, once the watch holds
//     {"type": "created" | "changed" | "removed", "path", "kind", "size", "mtime_ms"}
//     {"type": "resync", "why"}                                   it lost track: list again
//
// `path` of an event is relative to the folder watched. A folder says created and removed, never
// changed.
function agent_fs_watch(target)
{
    const dir = agent_fs_path(((target.path === undefined) || (target.path === null) || (target.path === '')) ? '~' : String(target.path));
    const tree = (target.tree === true);
    const skip = (Array.isArray(target.skip) ? target.skip.map(String) : []).sort();
    const key = JSON.stringify([dir, tree, skip]);
    let watch = watches.get(key);
    if (watch === undefined) {
        watch = watch_start(dir, tree, skip);
        watches.set(key, watch);
    }
    const out = new EventEmitter();
    const queue = [];
    let paused = false;
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function () {};
    out.end = function () {
        out.destroy();
    };
    out.pause = function () {
        paused = true;
    };
    out.resume = function () {
        paused = false;
        while ((paused === false) && (queue.length > 0)) {
            out.emit('data', queue.shift());
        }
    };
    out.destroy = function () {
        if (out.destroyed) {
            return;
        }
        out.destroyed = true;
        watch.listeners.delete(out);
        if (watch.listeners.size === 0) {
            watch_stop(watch);
            watches.delete(key);
        }
        out.emit('close');
    };
    out.say = function (line) {
        const chunk = Buffer.from(`${JSON.stringify(line)}\n`);
        if (paused) {
            queue.push(chunk);
            return;
        }
        out.emit('data', chunk);
    };
    out.fail = function (error) {
        out.emit('error', error);
        out.destroy();
    };
    watch.listeners.add(out);
    // A watch that holds already answers at once; a new one when its first scan is over
    watch.ready.then(function () {
        if (out.destroyed === false) {
            out.say({type: 'ready', path: dir, tree, skip});
        }
    }, function (error) {
        if (out.destroyed === false) {
            out.fail(error);
        }
    });
    return out;
}

// The number of folders watched now, for the tests
agent_fs_watch.count = function () {
    return watches.size;
};

function watch_start(root, tree, skip)
{
    const out = {root, tree, skip, listeners: new Set(), known: new Map(), dirs: new Map(), timers: new Map(), stopped: false, ready: null};
    out.ready = scan(out);
    // Nobody may be listening when it fails; the listeners hear it through ready
    out.ready.catch(function () {});
    return out;
}

function watch_stop(watch)
{
    watch.stopped = true;
    for (const watcher of watch.dirs.values()) {
        watcher.close();
    }
    watch.dirs.clear();
    for (const timer of watch.timers.values()) {
        clearTimeout(timer.id);
    }
    watch.timers.clear();
}

// What is there now, so the first event about a file can tell created from changed
async function scan(watch)
{
    const stat = await fs.promises.stat(watch.root);
    if (stat.isDirectory() === false) {
        throw new Error(`${watch.root} is not a folder`);
    }
    await dir_add(watch, '', false);
}

// One folder taken into the watch: its watcher first, so nothing made while it is read is
// missed, then what it holds. In a tree its folders follow; a folder made after the start says
// what it already holds as created, since it was filled before its watcher was there.
async function dir_add(watch, rel, tell)
{
    if (watch.stopped || watch.dirs.has(rel)) {
        return;
    }
    if (watch.dirs.size >= TREE_MAX_DIRS) {
        throw new Error(`more than ${TREE_MAX_DIRS} folders to watch; skip some of them`);
    }
    const abs = path.join(watch.root, rel);
    let watcher;
    try {
        watcher = fs.watch(abs, {persistent: false}, function (kind, name) {
            if (name === null) {
                resync(watch, `${abs} said something changed, but not what`);
                return;
            }
            heard(watch, path.join(rel, String(name)));
        });
    }
    catch (error) {
        if (error.code === 'ENOSPC') {
            throw new Error('this machine has no inotify watches left (fs.inotify.max_user_watches)');
        }
        throw error;
    }
    watcher.on('error', function (error) {
        dir_drop(watch, rel);
        if (rel === '') {
            for (const listener of Array.from(watch.listeners)) {
                listener.fail(new Error(`${watch.root}: ${error.message}`));
            }
        }
    });
    watch.dirs.set(rel, watcher);
    const entries = await fs.promises.readdir(abs, {withFileTypes: true});
    for (const entry of entries) {
        if (watch.skip.includes(entry.name)) {
            continue;
        }
        const child = path.join(rel, entry.name);
        const item = await item_read(path.join(watch.root, child));
        if ((item === null) || watch.stopped) {
            continue;
        }
        watch.known.set(child, item);
        if (tell) {
            say_all(watch, Object.assign({type: 'created', path: child}, item));
        }
        if (watch.tree && (item.kind === 'dir')) {
            await dir_add(watch, child, tell);
        }
    }
}

// A folder that went: its watcher and those under it stop, and what was known under it goes
function dir_drop(watch, rel)
{
    for (const [dir, watcher] of Array.from(watch.dirs)) {
        if ((dir === rel) || dir.startsWith(`${rel}${path.sep}`) || (rel === '')) {
            watcher.close();
            watch.dirs.delete(dir);
        }
    }
    for (const name of Array.from(watch.known.keys())) {
        if (name.startsWith(`${rel}${path.sep}`)) {
            watch.known.delete(name);
        }
    }
}

// Something happened to a name: it is looked at once it has been quiet, or after the longest
// wait if it never is
function heard(watch, rel)
{
    if (watch.skip.includes(path.basename(rel))) {
        return;
    }
    const now = Date.now();
    const found = watch.timers.get(rel);
    const first = ((found === undefined) ? now : found.first);
    if (found !== undefined) {
        clearTimeout(found.id);
    }
    const wait = Math.max(0, Math.min(QUIET_MS, first + QUIET_MAX_MS - now));
    const id = setTimeout(function () {
        watch.timers.delete(rel);
        look(watch, rel).catch(function (error) {
            resync(watch, `${rel}: ${error.message}`);
        });
    }, wait);
    id.unref();
    watch.timers.set(rel, {id, first});
}

// What a name is now, against what it was: created, changed, removed, or nothing worth saying
async function look(watch, rel)
{
    if (watch.stopped) {
        return;
    }
    // The folder itself went: there is nothing left to watch
    if (await item_read(watch.root) === null) {
        for (const listener of Array.from(watch.listeners)) {
            listener.fail(new Error(`${watch.root} is gone`));
        }
        return;
    }
    const item = await item_read(path.join(watch.root, rel));
    const was = watch.known.get(rel);
    if (item === null) {
        if (was === undefined) {
            return;
        }
        watch.known.delete(rel);
        if (was.kind === 'dir') {
            dir_drop(watch, rel);
        }
        say_all(watch, {type: 'removed', path: rel, kind: was.kind, size: null, mtime_ms: null});
        return;
    }
    watch.known.set(rel, item);
    if ((was === undefined) || (was.kind !== item.kind)) {
        say_all(watch, Object.assign({type: 'created', path: rel}, item));
        if (watch.tree && (item.kind === 'dir')) {
            try {
                await dir_add(watch, rel, true);
            }
            catch (error) {
                resync(watch, `${rel}: ${error.message}`);
            }
        }
        return;
    }
    if ((item.kind === 'file') && ((item.size !== was.size) || (item.mtime_ms !== was.mtime_ms))) {
        say_all(watch, Object.assign({type: 'changed', path: rel}, item));
    }
}

// A name as the list call shows it, or null when it is not there. A link is not followed into,
// so a tree never walks out of itself.
async function item_read(abs)
{
    let stat;
    try {
        stat = await fs.promises.lstat(abs);
    }
    catch {
        return null;
    }
    const kind = (stat.isDirectory() ? 'dir' : 'file');
    return {kind, size: ((kind === 'file') ? stat.size : null), mtime_ms: Math.round(stat.mtimeMs)};
}

function resync(watch, why)
{
    say_all(watch, {type: 'resync', why});
}

function say_all(watch, line)
{
    for (const listener of watch.listeners) {
        listener.say(line);
    }
}

module.exports = agent_fs_watch;
