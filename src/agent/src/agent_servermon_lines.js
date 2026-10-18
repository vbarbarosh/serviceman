const agent_servermon_dir = require('./agent_servermon_dir');
const fs = require('fs');
const path = require('path');

// The end of the newest day file is read, never all of it: a day is some 50 MB, and a line
// some 600 bytes, so this holds the last hundred seconds
const TAIL_BYTES = 64*1024;

// servermon's last lines, oldest first, each with its time as `at` in ms: what the machine did
// lately, read from servermon's file and not from the machine. [] while there is none.
function agent_servermon_lines()
{
    const dir = agent_servermon_dir();
    if (dir === null) {
        return [];
    }
    let names;
    try {
        names = fs.readdirSync(dir).filter(v => /^\d{8}\.jsonl$/.test(v)).sort();
    }
    catch {
        return [];
    }
    if (names.length === 0) {
        return [];
    }
    const out = [];
    for (const line of tail_read(path.join(dir, names[names.length - 1])).split('\n')) {
        // The first line of the tail is cut, the last one may still be being written
        let row;
        try {
            row = JSON.parse(line);
        }
        catch {
            continue;
        }
        out.push(Object.assign({at: Date.parse(row.time)}, row));
    }
    return out;
}

function tail_read(file)
{
    const fd = fs.openSync(file, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const length = Math.min(size, TAIL_BYTES);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, size - length);
        return buffer.toString('utf8');
    }
    finally {
        fs.closeSync(fd);
    }
}

module.exports = agent_servermon_lines;
