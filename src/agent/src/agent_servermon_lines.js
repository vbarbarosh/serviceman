const agent_servermon_dir = require('./agent_servermon_dir');
const fs = require('fs');
const path = require('path');

// The end of the newest day file is read, never all of it: a day is some 50 MB, and a line
// some 600 bytes, so this holds the last hundred seconds
const TAIL_BYTES = 64*1024;
// What a second of servermon takes, with room: how far back a read for `since` starts
const SECOND_BYTES = 1024;

// servermon's last lines, oldest first, each with its time as `at` in ms: what the machine did
// lately, read from servermon's file and not from the machine. [] while there is none.
// With `since` (ms), the lines reach back to it at least: the end of the file is read further
// until it does, and the day before's file too when today's began after it (a read at midnight).
function agent_servermon_lines(since = null)
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
    let out = [];
    // The newest file, and the one before it while the lines read do not reach `since`
    for (const name of names.slice(-2).reverse()) {
        const found = file_read(path.join(dir, name), since);
        out = found.rows.concat(out);
        if ((since === null) || (found.whole === false) || ((out.length > 0) && (out[0].at <= since))) {
            break;
        }
    }
    return out;
}

// The file's last lines: TAIL_BYTES of it, or, with `since`, as much as reaches it. `whole`
// says the file was read from its start.
function file_read(file, since)
{
    let fd;
    try {
        fd = fs.openSync(file, 'r');
    }
    catch {
        return {rows: [], whole: true};
    }
    try {
        const size = fs.fstatSync(fd).size;
        let length = TAIL_BYTES;
        if (since !== null) {
            length = Math.max(TAIL_BYTES, Math.ceil((Date.now() - since)/1000)*SECOND_BYTES);
        }
        while (true) {
            length = Math.min(size, length);
            const rows = rows_of(tail_read(fd, size, length));
            const whole = (length === size);
            if (whole || (since === null) || ((rows.length > 0) && (rows[0].at <= since))) {
                return {rows, whole};
            }
            length *= 2;
        }
    }
    finally {
        fs.closeSync(fd);
    }
}

function tail_read(fd, size, length)
{
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
}

// The first line of a tail is cut, the last one may still be being written: both are skipped
function rows_of(text)
{
    const out = [];
    for (const line of text.split('\n')) {
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

module.exports = agent_servermon_lines;
