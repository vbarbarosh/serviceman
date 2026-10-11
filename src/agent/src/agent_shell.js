const child_process = require('child_process');

const MAX_OUTPUT = 4*1024*1024;

// The agent runs on a bare machine, so it asks node for nothing but child_process:
// a failed command is a value here, not an exception
function agent_shell(argv, options)
{
    return new Promise(function (resolve) {
        child_process.execFile(argv[0], argv.slice(1), Object.assign({maxBuffer: MAX_OUTPUT}, options), function (error, stdout, stderr) {
            resolve({
                ok: (error === null),
                // What it ended with, for the times a command fails quietly: a status is the
                // only thing a program that says nothing still says
                code: ((error === null) ? 0 : ((typeof error.code === 'number') ? error.code : -1)),
                // Whether it was stopped rather than finished — a command given a deadline and
                // still going is a different answer from one that failed
                killed: ((error !== null) && (error.killed === true)),
                stdout: String(stdout).trim(),
                stderr: ((error === null) ? String(stderr).trim() : String(stderr || error.message).trim()),
            });
        });
    });
}

module.exports = agent_shell;
