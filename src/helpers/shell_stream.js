const child_process = require('child_process');
const stream = require('stream');
const stream_each = require('@vbarbarosh/node-helpers/src/stream_each');
const stream_lines = require('@vbarbarosh/node-helpers/src/stream_lines');
const stream_terminal_text = require('./stream_terminal_text');

// What is kept for the caller, once the lines have been said. A `docker port` answer is one
// line and an `npm install` is a thousand; the last of them is what a reason is made of.
const KEEP_LINES = 200;

// Runs a command and says every line as it is printed, instead of holding all of it for the
// end. A line is worth reading the moment it is whole — that is when somebody watching the log
// wants it, not a minute later when the command finally stops.
function shell_stream(argv, options, say)
{
    const child = child_process.spawn(argv[0], argv.slice(1), Object.assign({stdio: ['ignore', 'pipe', 'pipe']}, options));
    const kept = {stdout: [], stderr: []};
    function read(name, source) {
        return stream.promises.pipeline(source, stream_terminal_text(), stream_lines(), stream_each(function (line) {
            kept[name].push(line);
            if (kept[name].length > KEEP_LINES) {
                kept[name].shift();
            }
            if ((say !== undefined) && (say !== null) && (line.trim() !== '')) {
                say(name, line);
            }
        }));
    }
    const done = new Promise(function (resolve) {
        child.once('error', function (error) {
            kept.stderr.push(error.message);
            resolve(-1);
        });
        child.once('close', function (code) {
            resolve(code);
        });
    });
    return Promise.all([done, read('stdout', child.stdout), read('stderr', child.stderr)]).then(v => ({ok: v[0] === 0, code: v[0], stdout: kept.stdout.join('\n').trim(), stderr: kept.stderr.join('\n').trim()}));
}

module.exports = shell_stream;
