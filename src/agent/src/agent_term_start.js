const agent_term_holder_py = require('./agent_term_holder_py');
const agent_term_read = require('./agent_term_read');
const agent_terms_dir = require('./agent_terms_dir');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const term_name_valid = require('../../helpers/term_name_valid');

// How long a new holder has to open its socket
const HOLDER_WAIT_MS = 5000;
const HOLDER_POLL_MS = 50;

// The terminal `name` kept on this machine, started when no holder runs it: answers once its
// socket is open. The holder is detached and writes to nothing this agent holds, so a restart
// of the agent leaves it running.
async function agent_term_start(name, cols, rows)
{
    if (term_name_valid(name) === false) {
        throw new Error(`not a terminal name: ${JSON.stringify(name)}`);
    }
    if (agent_term_read(name) !== null) {
        return {name, created: false};
    }
    const base = path.join(agent_terms_dir(), name);
    fs.mkdirSync(path.dirname(base), {recursive: true, mode: 0o700});
    const shell = process.env.SHELL || '/bin/bash';
    const child = child_process.spawn('python3', ['-c', agent_term_holder_py, base, String(cols), String(rows), shell, '-l'], {
        cwd: os.homedir(),
        env: Object.assign({}, process.env, {TERM: 'xterm-256color'}),
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
    const time0 = Date.now();
    while (agent_term_read(name) === null) {
        if (Date.now() - time0 > HOLDER_WAIT_MS) {
            throw new Error(`the terminal ${name} did not start: is python3 on this machine?`);
        }
        await new Promise(v => setTimeout(v, HOLDER_POLL_MS));
    }
    return {name, created: true};
}

module.exports = agent_term_start;
