const fs = require('fs');

// /proc/<pid>/mountinfo, a mount a line, in the order they were mounted:
//
//     36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext3 /dev/root rw
//
// dev is its filesystem's: the same for every place one filesystem is mounted, a btrfs
// subvolume of its own included, though stat gives each subvolume a dev of its own. root is the
// folder of the filesystem mounted there, peers the fields between the options and the dash:
// shared:N, master:N.
//
//     [{id, dev, root, point, type, source, peers}]
function mounts_read(file)
{
    let text = '';
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch {
        return [];
    }
    const out = [];
    for (const line of text.split('\n')) {
        const halves = line.split(' - ');
        if (halves.length < 2) {
            continue;
        }
        const fields = halves[0].split(' ');
        const after = halves[1].split(' ');
        out.push({
            id: Number(fields[0]),
            dev: fields[2],
            root: octal_unescape(fields[3]),
            point: octal_unescape(fields[4]),
            type: after[0],
            source: octal_unescape(after[1]),
            peers: fields.slice(6),
        });
    }
    return out;
}

// The mount a folder is on: the deepest place above it, and of two at one place the one
// mounted last, which hides the other; null where nothing is mounted above it
function mount_of(folder, mounts)
{
    let out = null;
    for (const mount of mounts) {
        if (inside_or_at(folder, mount.point) && ((out === null) || (mount.point.length >= out.point.length))) {
            out = mount;
        }
    }
    return out;
}

function inside_or_at(file, folder)
{
    return (file === folder) || file.startsWith((folder === '/') ? '/' : `${folder}/`);
}

// mountinfo writes a space as \040, a tab as \011, a newline as \012 and a backslash as \134
function octal_unescape(text)
{
    return String(text).replace(/\\([0-7]{3})/g, (match, code) => String.fromCharCode(parseInt(code, 8)));
}

mounts_read.mount_of = mount_of;
mounts_read.inside_or_at = inside_or_at;

module.exports = mounts_read;
