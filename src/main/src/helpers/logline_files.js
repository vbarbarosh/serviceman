const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Logline as this serviceman carries it, in its image beside src/
const LOGLINE_DIR = path.join(__dirname, '..', '..', '..', '..', 'logline');
// What makes Logline on its machine: its compose file, its config, its viewer and its lines
// server. Its tests, its scripts, what npm brings and what it keeps are not Logline's to send.
const PARTS = ['docker-compose.yml', 'config', 'log-ui', 'lines'];
const SKIP = ['node_modules', 'tests', 'bin', 'data'];

// Logline's files with their sha256, by path relative to its folder, / between the parts
//
//     out   [{path, sha256, abs}], by path
function logline_files(dir)
{
    const root = ((dir === undefined) ? LOGLINE_DIR : dir);
    const files = [];
    for (const part of PARTS) {
        walk(root, part, files);
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(root, relative, out)
{
    const abs = path.join(root, relative);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
        for (const name of fs.readdirSync(abs)) {
            if (SKIP.includes(name) || name.endsWith('.test.js')) {
                continue;
            }
            walk(root, `${relative}/${name}`, out);
        }
        return;
    }
    out.push({path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'), abs});
}

logline_files.dir = LOGLINE_DIR;

module.exports = logline_files;
