const fs = require('fs');
const path = require('path');

// No more than this is kept aside. Past it a line Logline refuses waits in the spool, and every
// line behind it with it, until whoever owns the machine has made room: lines are held, never
// dropped, as the spool holds them at its cap.
const ASIDE_FILES = 1000;
const ASIDE_BYTES = 64*1024*1024;
// Logline's answer comes first in a file put aside (logline_ship writes {answer, batch}), so
// the head of the file is read for it; a file of another order is read whole up to this
const HEAD_BYTES = 64*1024;
const WHOLE_BYTES = 1024*1024;
// What of an answer is said, at most
const ANSWER_CHARS = 300;
const RE_ANSWER = /^\{"answer":("(?:[^"\\]|\\.)*")/;

// What Logline said it will never take, kept in refused/ of the spool's folder for whoever
// owns the machine: how many files, how many bytes, whether no more fit, what Logline answered
// for the newest of them, and when the oldest and the newest were put aside (null with no file).
//
// {files, bytes, full, answer, oldest_at, newest_at}
function logline_aside(dir)
{
    const out = {files: 0, bytes: 0, full: false, answer: null, oldest_at: null, newest_at: null};
    let oldest_ms = Infinity;
    let newest = null;
    let names = [];
    try {
        names = fs.readdirSync(path.join(dir, 'refused'));
    }
    catch {
        // No refused/ yet: nothing was put aside
    }
    for (const name of names.filter(v => v.endsWith('.json'))) {
        try {
            const stat = fs.statSync(path.join(dir, 'refused', name));
            out.bytes += stat.size;
            out.files += 1;
            oldest_ms = Math.min(oldest_ms, stat.mtimeMs);
            if ((newest === null) || (stat.mtimeMs >= newest.mtimeMs)) {
                newest = {name, mtimeMs: stat.mtimeMs, size: stat.size};
            }
        }
        catch {
            // Taken away between the two looks
        }
    }
    out.full = (out.files >= ASIDE_FILES) || (out.bytes >= ASIDE_BYTES);
    if (newest !== null) {
        out.oldest_at = new Date(oldest_ms).toISOString();
        out.newest_at = new Date(newest.mtimeMs).toISOString();
        out.answer = answer_read(path.join(dir, 'refused', newest.name), newest.size);
    }
    return out;
}

// What Logline answered for the lines of one file put aside, or null where it cannot be read:
// a file taken away meanwhile, cut short, or not one logline_ship wrote
function answer_read(file, size)
{
    const head = text_read(file, Math.min(size, HEAD_BYTES));
    const found = (head === null) ? null : RE_ANSWER.exec(head);
    let answer = null;
    try {
        if (found !== null) {
            answer = JSON.parse(found[1]);
        }
        else if ((head !== null) && (size <= WHOLE_BYTES)) {
            answer = JSON.parse((size <= HEAD_BYTES) ? head : text_read(file, size)).answer;
        }
    }
    catch {
        return null;
    }
    return (typeof answer === 'string') ? answer.slice(0, ANSWER_CHARS) : null;
}

// The first bytes of a file as text, or null where it cannot be read
function text_read(file, bytes)
{
    try {
        const fd = fs.openSync(file, 'r');
        try {
            const buffer = Buffer.alloc(bytes);
            return buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, bytes, 0));
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return null;
    }
}

module.exports = logline_aside;
