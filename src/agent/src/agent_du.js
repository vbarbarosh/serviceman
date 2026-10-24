const child_process = require('child_process');

// A count of a whole disk reads every folder on it: minutes on a big one, never forever
const DU_TIMEOUT_MS = 280000;
// Each line is one folder, and the folders that cannot be read are a line each on stderr
const DU_OUTPUT = 64*1024*1024;

// du over one folder, on its own disk alone (`du -x`), its folders one level down. du says a
// folder the moment it has counted all of it, so each line is told to on_line as it comes:
// a page can show the folders done while the rest are still being read.
//
//     {stdout, stderr, killed}
function agent_du(folder, on_line)
{
    return new Promise(function (resolve) {
        // In C, du says what it cannot read the same way on every machine: 'path', not ‘path’
        const child = child_process.spawn('du', ['-x', '-B1', '-d1', '--', folder], {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {LC_ALL: 'C'})});
        const said = {stdout: '', stderr: '', killed: false};
        let rest = '';
        const timer = setTimeout(function () {
            said.killed = true;
            child.kill('SIGKILL');
        }, DU_TIMEOUT_MS);
        child.stdout.on('data', function (chunk) {
            const text = chunk.toString('utf8');
            if (said.stdout.length < DU_OUTPUT) {
                said.stdout += text;
            }
            rest += text;
            const lines = rest.split('\n');
            rest = lines.pop();
            for (const line of lines) {
                on_line(line);
            }
        });
        child.stderr.on('data', function (chunk) {
            if (said.stderr.length < DU_OUTPUT) {
                said.stderr += chunk.toString('utf8');
            }
        });
        child.once('error', function (error) {
            said.stderr += error.message;
        });
        child.once('close', function () {
            clearTimeout(timer);
            if (rest !== '') {
                on_line(rest);
            }
            resolve(said);
        });
    });
}

agent_du.DU_TIMEOUT_MS = DU_TIMEOUT_MS;

module.exports = agent_du;
