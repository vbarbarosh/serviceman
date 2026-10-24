const agent_du = require('./agent_du');
const agent_root_or = require('./agent_root_or');
const agent_shell = require('./agent_shell');
const fs = require('fs');
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
//     {path, total, files, folders: [{path, size}], unread: [path], rooted, took_ms, extras}
async function agent_disk_usage(params, options)
{
    const folder = folder_asked(params);
    const count = counts.get(folder) || count_start(folder, options);
    const answer = await count.promise;
    if (answer.killed) {
        throw new Error(`counting ${folder} took longer than ${agent_du.DU_TIMEOUT_MS/60000} minutes: open a folder further down`);
    }
    const sizes = du_read(answer.stdout);
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
        unread: unread_of(answer.stderr),
        rooted: answer.rooted,
        took_ms: Date.now() - count.started,
        extras: null,
    };
    if (params.extras === true) {
        out.extras = {docker: await docker_sizes(options), docker_root: await docker_root(options), journal: await journal_size()};
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

// The root half's own count: du as root, each line said as du prints it
async function agent_disk_usage_root(params, say)
{
    const folder = folder_asked(params);
    return await agent_du(folder, v => say('stdout', v));
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
// it has yet to say, read from the folder itself (those on its own disk, as du -x counts)
function count_start(folder, options)
{
    const out = {started: Date.now(), done: new Map(), waiting: folders_in(folder), promise: null};
    function on_line(line) {
        const one = du_read(line);
        for (const [where, size] of one) {
            if (where !== folder) {
                out.done.set(where, size);
            }
        }
    }
    out.promise = du_rooted(folder, options, on_line).finally(function () {
        counts.delete(folder);
    });
    counts.set(folder, out);
    return out;
}

// As root where the root half is there, and older root halves count as no root half
async function du_rooted(folder, options, on_line)
{
    let rooted = true;
    const out = await agent_root_or(options, 'disk_usage', {path: folder}, function (stream, text) {
        if (stream === 'stdout') {
            on_line(text);
        }
    }, function () {
        rooted = false;
        return agent_du(folder, on_line);
    });
    out.rooted = rooted;
    return out;
}

// The folders right in this one that are on its disk: what du -x is about to count. A folder
// this user cannot list has none to tell, and du as root counts them all the same.
function folders_in(folder)
{
    try {
        const disk = fs.statSync(folder).dev;
        const out = [];
        for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
            if (entry.isDirectory() === false) {
                continue;
            }
            const where = path.join(folder, entry.name);
            try {
                if (fs.lstatSync(where).dev === disk) {
                    out.push(where);
                }
            }
            catch {
                // Gone since it was listed, or not to be looked at: du says which
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

// Where docker keeps what it has, /var/lib/docker unless it was told otherwise; null where
// docker is not here
async function docker_root(options)
{
    const answer = await agent_shell([options.docker, 'info', '--format', '{{.DockerRootDir}}'], {timeout: 30000});
    return ((answer.ok === false) || (answer.stdout === '')) ? null : answer.stdout;
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

module.exports = agent_disk_usage;
