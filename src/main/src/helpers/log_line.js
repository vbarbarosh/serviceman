const log_trim = require('./log_trim');
const log_words = require('../../../helpers/log_words');
const log_write = require('./log_write');

const KEEP_LINES = 300;
const LINE_BYTES = 2000;
const TIME_BYTES = 26;
const ROOM = 16;

// One line of the log: the time, the group it belongs to, what happened, and the details that
// explain it. Three fields and nothing else — how long it took, what it answered, and every
// other measurement is part of the details.
//
//     [2026-08-17T16:09:20.185Z][cfzno1sw][service_start_begin] service=whoami remote=vps1
//
// The time is a field of its own, in UTC to the millisecond. A file needs it, because a file
// says nothing else about when a line was written; a runtime that stamps every line itself, as
// docker does, does not, and SERVICEMAN_LOG_TIME=off leaves it off stdout.
//
// Every line goes to all three places it can go — the file, the control page and stdout — so
// there is one log and no second, quieter one.
function log_line(app, uid, subject, words)
{
    const head = `[${uid}][${subject}]`;
    // The details are free text when the caller writes them itself, and key=value when it
    // hands over the values and lets this end write them
    const said = (typeof words === 'string') ? words : log_words(words);
    const tail = (said === '') ? head : `${head} ${log_trim(said, LINE_BYTES - TIME_BYTES - head.length - ROOM)}`;
    const line = `[${new Date().toISOString()}]${tail}`;
    log_write(app, line);
    app.log_lines.push(line);
    if (app.log_lines.length > KEEP_LINES) {
        app.log_lines.splice(0, app.log_lines.length - KEEP_LINES);
    }
    console.log((app.log_stdout_time === false) ? tail : line);
}

module.exports = log_line;
