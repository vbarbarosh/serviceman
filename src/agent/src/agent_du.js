const child_process = require('child_process');

// A count of a whole disk reads every folder on it: minutes on a big one, never forever
const DU_TIMEOUT_MS = 280000;
// The folders that cannot be read are a line each on stderr, and so is the first level of a
// count asked of a root half from before whole trees
const DU_OUTPUT = 64*1024*1024;

// du over one folder, on its own disk alone (`du -x`). du says a folder the moment it has
// counted all of it, the folders inside it before it, so each is told to hear.line as it
// comes: a page can show the folders done while the rest are still being read. With all,
// every folder of the walk is said, each name ended by a NUL (`-0`), which no name holds;
// without, the first level alone, a line each, and kept in stdout, as root halves from before
// whole trees answer. What du says it could not read goes to hear.error as it comes.
//
//     hear = {line: function (text), error: function (text)}
//     {stdout, stderr, killed}
function agent_du(folder, all, hear)
{
    return new Promise(function (resolve) {
        // In C, du says what it cannot read the same way on every machine: 'path', not ‘path’
        const argv = all ? ['-x', '-B1', '-0', '--', folder] : ['-x', '-B1', '-d1', '--', folder];
        const child = child_process.spawn('du', argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {LC_ALL: 'C'})});
        const end = all ? '\0' : '\n';
        const said = {stdout: '', stderr: '', killed: false};
        let rest = '';
        // A name cut between two chunks is put back together, not turned into two halves
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        const timer = setTimeout(function () {
            said.killed = true;
            child.kill('SIGKILL');
        }, DU_TIMEOUT_MS);
        child.stdout.on('data', function (text) {
            if ((all === false) && (said.stdout.length < DU_OUTPUT)) {
                said.stdout += text;
            }
            rest += text;
            const lines = rest.split(end);
            rest = lines.pop();
            for (const line of lines) {
                hear.line(line);
            }
        });
        child.stderr.on('data', function (text) {
            if (said.stderr.length < DU_OUTPUT) {
                said.stderr += text;
            }
            hear.error(text);
        });
        child.once('error', function (error) {
            said.stderr += error.message;
        });
        child.once('close', function () {
            clearTimeout(timer);
            if (rest !== '') {
                hear.line(rest);
            }
            resolve(said);
        });
    });
}

agent_du.DU_TIMEOUT_MS = DU_TIMEOUT_MS;

module.exports = agent_du;
