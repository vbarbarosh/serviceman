const agent_dir = require('./agent_dir');
const agent_root_ask = require('./agent_root_ask');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

// Takes this agent off this machine: the root half first, then the unit that keeps the session
// half up, then the folder it all lives in. Asked for by the host, once, when the machine has
// been taken out of its config — a machine nobody manages should not go on dialling a host
// that will not have it.
//
// Nothing here is done to an agent running from the repo. The file is read first and must be
// the one the bundler wrote: a checkout is somebody's work, and `rm -rf` on it would be the
// worst kind of obedience.
async function agent_uninstall(options)
{
    const own = path.resolve(process.argv[1]);
    if (bundled(own) === false) {
        return {removed: false, reason: `${own} is not a bundled agent — this one runs from a checkout, and nothing here will delete that`};
    }
    const dir = agent_dir();
    if (path.dirname(own) !== dir) {
        return {removed: false, reason: `${own} does not live in ${dir} — this agent was not put here by the installer`};
    }
    // The root half is asked to take itself away while there is still something to ask with
    const root = await root_gone(options);
    // The rest happens after this process is gone: it is the thing being stopped, and a unit
    // stopping itself never reaches the line after
    const line = `sleep 1; "${dir}/bin/uninstall" >/dev/null 2>&1; rm -rf "${dir}"`;
    const child = child_process.spawn('/bin/sh', ['-c', line], {detached: true, stdio: 'ignore'});
    child.unref();
    return {removed: true, dir, root};
}

async function root_gone(options)
{
    try {
        await agent_root_ask(options, 'uninstall', {});
        return true;
    }
    catch {
        // There was none, or it would not go; the line above says what was taken away
        return false;
    }
}

function bundled(file)
{
    try {
        // Any generation of the bundle: modules["agent_main"] once, modules["agent/index"] now
        return fs.readFileSync(file, 'utf8').includes('modules["agent');
    }
    catch {
        return false;
    }
}

module.exports = agent_uninstall;
