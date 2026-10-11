const crypto = require('crypto');

// What the folder of a program is marked with once it is installed: the line that installed it,
// as a short hash. The same line is never run twice, and a line that changed is run again.
function program_mark(install)
{
    return crypto.createHash('sha256').update(String(install)).digest('hex').slice(0, 12);
}

module.exports = program_mark;
