const child_process = require('child_process');
const readline = require('readline');

// What a command says on stderr is kept up to this, its first lines being the ones that say why
const STDERR_MAX = 64*1024;

// Runs a command and hands its output to `line_take` a line at a time, as it comes, so a log of
// a day costs no more memory than one line of it. A command still going after `timeout_ms` is
// stopped: `killed` says so. A command that cannot be run is an answer here, as with
// agent_shell, never an exception.
//
//     -> {ok, code, killed, stderr}
function agent_lines_read(argv, timeout_ms, line_take)
{
    return new Promise(function (resolve) {
        let stderr = '';
        let killed = false;
        let done = false;
        const child = child_process.spawn(argv[0], argv.slice(1), {stdio: ['ignore', 'pipe', 'pipe']});
        const timer = setTimeout(function () {
            killed = true;
            child.kill('SIGKILL');
        }, timeout_ms);
        function end(ok, code, text) {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            resolve({ok, code, killed, stderr: text.trim()});
        }
        child.stderr.on('data', function (chunk) {
            if (stderr.length < STDERR_MAX) {
                stderr += chunk.toString('utf8');
            }
        });
        const lines = readline.createInterface({input: child.stdout, crlfDelay: Infinity});
        lines.on('line', line_take);
        child.on('error', function (error) {
            end(false, -1, error.message);
        });
        // The last lines are taken before the end is said: close comes after stdout has ended
        child.on('close', function (code) {
            end((code === 0) && (killed === false), (typeof code === 'number') ? code : -1, stderr);
        });
    });
}

module.exports = agent_lines_read;
