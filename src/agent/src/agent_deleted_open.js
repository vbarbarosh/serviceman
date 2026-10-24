const fs = require('fs');
const mounts_read = require('./mounts_read');

const BLOCK_BYTES = 512;
// The programs named, the biggest holders first
const PROGRAMS_SHOWN = 5;

// Files deleted while a program still holds them open, on the filesystem a folder is on: their
// space stays used until the last program closes them, and no folder shows it. Each file is
// counted once, however many hold it; one with another name left is in a folder still, and is
// not here. As root every program is looked at; as a user, only that user's own.
//
//     {size, programs: [{pid, name, size}]}
function agent_deleted_open(folder, proc = '/proc')
{
    const out = {size: 0, programs: []};
    const mounts = mounts_read(`${proc}/self/mountinfo`);
    const own = mounts_read.mount_of(folder, mounts);
    if (own === null) {
        return out;
    }
    const on_disk = new Set(mounts.filter(v => v.dev === own.dev).map(v => v.id));
    const seen = new Set();
    for (const pid of names_in(proc).filter(v => /^\d+$/.test(v))) {
        let size = 0;
        for (const fd of names_in(`${proc}/${pid}/fd`)) {
            const file = deleted_file(`${proc}/${pid}/fd/${fd}`, `${proc}/${pid}/fdinfo/${fd}`, on_disk);
            if ((file === null) || seen.has(file.key)) {
                continue;
            }
            seen.add(file.key);
            size += file.size;
        }
        if (size > 0) {
            out.size += size;
            out.programs.push({pid: Number(pid), name: program_name(`${proc}/${pid}`), size});
        }
    }
    out.programs = out.programs.sort((a, b) => b.size - a.size).slice(0, PROGRAMS_SHOWN);
    return out;
}

// One open file that is deleted, and on this disk by the mount it was opened through:
// {key, size}, or null
function deleted_file(fd, fdinfo, on_disk)
{
    try {
        if (fs.readlinkSync(fd).endsWith(' (deleted)') === false) {
            return null;
        }
        const mount = /^mnt_id:\s*(\d+)$/m.exec(fs.readFileSync(fdinfo, 'utf8'));
        if ((mount === null) || (on_disk.has(Number(mount[1])) === false)) {
            return null;
        }
        const stat = fs.statSync(fd);
        if ((stat.isFile() === false) || (stat.nlink > 0)) {
            return null;
        }
        return {key: `${stat.dev}:${stat.ino}`, size: stat.blocks*BLOCK_BYTES};
    }
    catch {
        // Closed since it was listed, or another user's
        return null;
    }
}

function names_in(dir)
{
    try {
        return fs.readdirSync(dir);
    }
    catch {
        return [];
    }
}

function program_name(base)
{
    try {
        return fs.readFileSync(`${base}/comm`, 'utf8').trim();
    }
    catch {
        return '';
    }
}

module.exports = agent_deleted_open;
