const object_from_line = require('../../helpers/object_from_line');
const worker_threads = require('worker_threads');

// How long past its own time an ask may keep this process, should the agent that is to stop it
// be stopped itself
const SPARE_MS = 10000;

// The reader of a SQLite file, a node process of its own the agent starts for one ask
// (agent_sqlite_read). The ask comes as one line of JSON on its stdin, {file, steps, ms}; a thread
// of its own reads the file (agent_sqlite_worker), and each message it says is a line of JSON on
// stdout, as it is said. SQLite runs in that thread, where nothing stops a statement before its
// end; this one stays free to watch the agent. The agent's end of stdin closed, or an answer that
// cannot be written to it, and the agent is gone or done with the ask: the process is killed
// whatever its statement is doing. A recursive query that would run for hours ends with the agent
// that asked for it, a restart of the agent included. Nothing else is ever left running by it.
//
//     node <agent> --sqlite-read
function agent_sqlite_child()
{
    let text = '';
    let worker = null;
    let done = false;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (chunk) {
        if (worker !== null) {
            return;
        }
        text += chunk;
        const end = text.indexOf('\n');
        if (end < 0) {
            return;
        }
        const ask = object_from_line(text.slice(0, end));
        if ((ask === null) || (Array.isArray(ask.steps) === false)) {
            say({error: 'the ask is no JSON object with steps', code: 'reader'});
            done = true;
            process.stdin.destroy();
            return;
        }
        setTimeout(die, ((typeof ask.ms === 'number') ? ask.ms : 0) + SPARE_MS).unref();
        worker = new worker_threads.Worker(process.argv[1], {argv: ['--sqlite-worker'], workerData: ask});
        worker.on('message', say);
        worker.on('error', function (error) {
            say({error: `the reader's thread failed: ${error.message}`, code: 'reader'});
        });
        worker.on('exit', function () {
            done = true;
            process.stdin.destroy();
        });
    });
    process.stdin.on('end', die_unless_done);
    process.stdin.on('close', die_unless_done);
    // An answer written to an agent that is gone fails, and so may anything here: ended as a
    // process ends, it would wait for its thread to stop, which waits for its statement, maybe
    // for hours, with this thread blocked meanwhile. It is killed instead.
    process.stdout.on('error', die);
    process.stdin.on('error', die);
    process.on('uncaughtException', die);
    function die_unless_done() {
        if (done === false) {
            die();
        }
    }
}

function say(message)
{
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

// Killed at once, its thread with it, wherever its statement is
function die()
{
    process.kill(process.pid, 'SIGKILL');
}

module.exports = agent_sqlite_child;
