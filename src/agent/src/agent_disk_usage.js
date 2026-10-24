const agent_shell = require('./agent_shell');
const path = require('path');

// A count of a whole disk reads every folder on it: minutes on a big one, never forever
const DU_TIMEOUT_MS = 280000;
const DU_OUTPUT = 64*1024*1024;
// docker and journalctl say their sizes for people, docker in thousands, journald in 1024s
const DOCKER_UNITS = {B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12};
const JOURNAL_UNITS = {B: 1, K: 1024, M: 1024**2, G: 1024**3, T: 1024**4};

// What takes the space in one folder of this machine, on its own disk alone (`du -x`): the
// folders in it with their sizes, biggest first, what lies in the folder itself, and the
// folders that could not be read, whose size is then in no folder here. Only names and sizes:
// nothing is read out of a file. With extras, what docker and the journal say they keep, which
// a count as a user often cannot see into.
//
//     {path, total, files, folders: [{path, size}], unread: [path], took_ms, extras}
async function agent_disk_usage(params, options)
{
    const asked = String(params.path || '');
    if (path.isAbsolute(asked) === false) {
        throw Object.assign(new Error('path: a folder from the root, /var'), {status: 400});
    }
    const folder = path.resolve(asked);
    const started = Date.now();
    const answer = await agent_shell(['du', '-x', '-B1', '-d1', '--', folder], {timeout: DU_TIMEOUT_MS, maxBuffer: DU_OUTPUT});
    if (answer.killed) {
        throw new Error(`counting ${folder} took longer than ${DU_TIMEOUT_MS/60000} minutes: open a folder further down`);
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
        took_ms: Date.now() - started,
        extras: null,
    };
    if (params.extras === true) {
        out.extras = {docker: await docker_sizes(options), journal: await journal_size()};
    }
    return out;
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
function unread_of(text)
{
    const out = [];
    for (const match of text.matchAll(/^du: cannot (?:read directory|access) '(.+)': (?:Permission denied|Operation not permitted)$/gm)) {
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

module.exports = agent_disk_usage;
