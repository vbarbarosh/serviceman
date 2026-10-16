const fs = require('fs');

// A file made here takes the run bits it had where it came from, for whoever may read it: a
// script stays runnable, and nothing more than this machine's own defaults is opened. `mode` is
// the file's mode there, as chmod takes it; without one the file is left as it was made.
function agent_exec_bits(file, mode)
{
    if ((Number.isInteger(mode) === false) || ((mode & 0o111) === 0)) {
        return;
    }
    const now = fs.statSync(file).mode & 0o7777;
    const runs = mode & 0o111 & ((now & 0o444) >> 2);
    if ((now | runs) !== now) {
        fs.chmodSync(file, now | runs);
    }
}

module.exports = agent_exec_bits;
