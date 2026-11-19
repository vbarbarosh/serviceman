const agent_link = require('./agent_link');
const agent_programs_dir = require('./agent_programs_dir');
const agent_say = require('./agent_say');
const fs = require('fs');
const link_send_message = require('../../helpers/link_send_message');
const path = require('path');
const proc_start_time = require('./proc_start_time');

// The last words of a program, kept for whoever asks for its log
const KEEP_LINES = 400;
const READ_EVERY_MS = 500;
// The last words sent with the word that it ended: why it ended is in them, and once it has
// ended no one can ask for them any more
const END_LINES = 20;
// A file a program writes for weeks is emptied at this size; what it said is in the agent's
// log by then, line by line
const FILE_MAX_BYTES = 8*1024*1024;

// Keeps watch over a program this agent started, or one an agent before it started and wrote
// down: what it prints goes from its files into the agent's log as it prints it, and when it
// ends, the host is told and its note on the disk is taken away. `child` is the process when
// this agent spawned it; a program taken back has none, and its end is seen by its pid.
//
//     record = {name, slot, pid, started, cwd, dir, argv}
function agent_program_follow(programs, record, child, group)
{
    const key = `${record.name}#${record.slot}`;
    const base = path.join(agent_programs_dir(), `${record.name}.${record.slot}`);
    // What its files hold now, and from where each is read on: a line a program writes at once,
    // between the two, would be in neither
    const outs = file_read(`${base}.out`);
    const errs = file_read(`${base}.err`);
    const output = outs.lines.concat(errs.lines).slice(-KEEP_LINES);
    // A program this agent just spawned wrote them since: they go to the log as every line
    // does. One taken back wrote them for the agent before, which logged them.
    if (child !== null) {
        for (const [lines, sender] of [[outs.lines, 'program_stdout'], [errs.lines, 'program_stderr']]) {
            for (const line of lines.filter(v => v.trim() !== '')) {
                agent_say(group, sender, line, record.name);
            }
        }
    }
    const out = {pid: record.pid, started: record.started, cwd: record.dir, output};
    const readers = [reader(`${base}.out`, outs.size, 'program_stdout', group, record, output), reader(`${base}.err`, errs.size, 'program_stderr', group, record, output)];
    const timer = setInterval(function () {
        for (const read of readers) {
            read();
        }
        if ((child === null) && (proc_start_time(record.pid) !== record.started)) {
            finish(null, null, 'gone');
        }
    }, READ_EVERY_MS);
    timer.unref();
    let over = false;
    function finish(code, signal, how) {
        if (over) {
            return;
        }
        over = true;
        clearInterval(timer);
        for (const read of readers) {
            read();
        }
        agent_say(group, 'program_end', {service: record.name, slot: record.slot, how});
        if (programs[key] === out) {
            delete programs[key];
        }
        record_remove(`${base}.json`, record.pid);
        ended_told(record, code, signal, output.filter(v => v.trim() !== '').slice(-END_LINES));
    }
    if (child !== null) {
        child.on('exit', function (code, signal) {
            finish(code, signal, (signal === null) ? `code ${code}` : signal);
        });
        // A command that cannot be run at all — no such program, a folder that is not there —
        // ends here instead of exiting, and it ends the same way for the host: as a program
        // that failed
        child.on('error', function (error) {
            output.push(error.message);
            finish(null, null, error.message);
        });
    }
    programs[key] = out;
    return out;
}

// What a file of a program says from here on, a line at a time. A file emptied because it grew
// too big is read again from its start.
//
// A look that cannot read the file or empty it (a disk gone read-only, the file taken away
// between two looks) is tried again at the next one. It is said once, not twice a second;
// thrown from the timer, where nothing catches, it ended the agent, and the machine's link
// with it.
function reader(file, from, sender, group, record, output)
{
    let offset = from;
    let rest = '';
    let failed = false;
    return function () {
        try {
            look();
            failed = false;
        }
        catch (error) {
            if (failed === false) {
                failed = true;
                agent_say(group, 'program_follow_error', {service: record.name, slot: record.slot, file: path.basename(file), reason: error.message});
            }
        }
    };

    function look() {
        let size = file_size(file);
        if (size > FILE_MAX_BYTES) {
            fs.truncateSync(file, 0);
            size = 0;
        }
        if (size < offset) {
            offset = 0;
            rest = '';
        }
        if (size === offset) {
            return;
        }
        const buffer = Buffer.alloc(size - offset);
        const fd = fs.openSync(file, 'r');
        try {
            fs.readSync(fd, buffer, 0, buffer.length, offset);
        }
        finally {
            fs.closeSync(fd);
        }
        offset = size;
        const lines = (rest + buffer.toString('utf8')).split('\n');
        rest = lines.pop();
        for (const line of lines) {
            output.push(line);
            if (line.trim() !== '') {
                agent_say(group, sender, line, record.name);
            }
        }
        output.splice(0, Math.max(0, output.length - KEEP_LINES));
    }
}

// The lines a program printed before this agent started watching it, and how many bytes they
// are, for the reader to go on from there: an agent that was restarted shows the same log the
// one before it did
function file_read(file)
{
    try {
        const buffer = fs.readFileSync(file);
        return {lines: buffer.toString('utf8').split('\n').filter(v => v !== ''), size: buffer.length};
    }
    catch {
        return {lines: [], size: 0};
    }
}

// The note on the disk goes with the program it is about; a note a newer start wrote over it
// belongs to that one
function record_remove(file, pid)
{
    try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === pid) {
            fs.rmSync(file, {force: true});
        }
    }
    catch {
        // No note, or half of one: nothing to take away
    }
}

function file_size(file)
{
    try {
        return fs.statSync(file).size;
    }
    catch {
        return 0;
    }
}

// The host holds the restart policy, so it is told the fact apart from the line: a line is for
// reading, this is for acting on. A machine with no link says it to nobody, and the host finds
// out the usual way when it asks again.
function ended_told(record, code, signal, said)
{
    const socket = agent_link();
    if ((socket === null) || socket.destroyed) {
        return;
    }
    try {
        link_send_message(socket, {type: 'program_end', service: record.name, slot: record.slot, code, signal, said});
    }
    catch {
        // The link went while this was being written; the host will ask
    }
}

module.exports = agent_program_follow;
