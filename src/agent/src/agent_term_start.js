const agent_term_holder_py = require('./agent_term_holder_py');
const agent_term_read = require('./agent_term_read');
const agent_terms_dir = require('./agent_terms_dir');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const term_create_refusal = require('../../helpers/term_create_refusal');
const term_name_valid = require('../../helpers/term_name_valid');

// How long a new holder has to open its socket
const HOLDER_WAIT_MS = 5000;
const HOLDER_POLL_MS = 50;

// The terminal `name` kept on this machine, started when no holder runs it: answers once its
// socket is open. The holder is detached and writes to nothing this agent holds, so a restart
// of the agent leaves it running. Its shell has this agent's variables with `env` over them, and
// starts in `cwd`, under home when it is not absolute; a terminal running already keeps its own.
async function agent_term_start(name, cols, rows, env, cwd)
{
    if (term_name_valid(name) === false) {
        throw new Error(`not a terminal name: ${JSON.stringify(name)}`);
    }
    const refused = term_create_refusal(env, cwd);
    if (refused !== null) {
        throw new Error(refused);
    }
    if (agent_term_read(name) !== null) {
        return {name, created: false};
    }
    const dir = path.resolve(os.homedir(), (typeof cwd === 'string') ? cwd : '.');
    if ((fs.existsSync(dir) === false) || (fs.statSync(dir).isDirectory() === false)) {
        throw new Error(`no folder ${dir} on this machine`);
    }
    const base = path.join(agent_terms_dir(), name);
    fs.mkdirSync(path.dirname(base), {recursive: true, mode: 0o700});
    const shell = process.env.SHELL || '/bin/bash';
    const child = child_process.spawn('python3', ['-c', agent_term_holder_py, base, String(cols), String(rows), shell, '-l'], {
        cwd: dir,
        env: Object.assign({}, process.env, {TERM: 'xterm-256color'}, env),
        detached: true,
        stdio: 'ignore',
    });
    // A spawn that fails says so as an event, and unheard it would take the agent down with it
    let failed = null;
    child.on('error', e => failed = e);
    child.unref();
    const time0 = Date.now();
    while (agent_term_read(name) === null) {
        if (failed !== null) {
            throw new Error(`the terminal ${name} did not start: ${failed.message}`);
        }
        if (Date.now() - time0 > HOLDER_WAIT_MS) {
            throw new Error(`the terminal ${name} did not start: is python3 on this machine?`);
        }
        await new Promise(v => setTimeout(v, HOLDER_POLL_MS));
    }
    return {name, created: true};
}

module.exports = agent_term_start;
