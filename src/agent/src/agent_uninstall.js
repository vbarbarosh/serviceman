const agent_dir = require('./agent_dir');
const agent_root_ask = require('./agent_root_ask');
const agent_token_set_aside = require('./agent_token_set_aside');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

// Takes this agent out of this machine's systemd: the root half first, then the unit that keeps
// the session half up, by the installer's own bin/uninstall. Asked for by the host, once, when
// the machine has been taken out of its config — a machine nobody manages should not go on
// dialling a host that will not have it.
//
// Nothing on the disk is deleted. The folder stays as it was, with what the host installed in
// services/ and each app's data/, the logs and env: "removed" is the word of whoever answered
// the dial, and the last word on a person's files is that person's. bin/uninstall says the
// same, and names the `rm -rf` that is theirs to run.
//
// Nothing here is done to an agent the installer did not put where it is. The file is read
// first and must be the one the bundler wrote, in the folder the agent keeps its things in,
// with the installer's bin/uninstall beside it: a checkout is somebody's work, and beside one
// file fetched and run by hand bin/ is whatever that folder holds.
async function agent_uninstall(options)
{
    const own = path.resolve(process.argv[1]);
    if (bundled(own) === false) {
        return {reason: `${own} is not a bundled agent — this one runs from a checkout: it stops, and nothing else is done`};
    }
    const dir = agent_dir();
    if (path.dirname(own) !== dir) {
        return {reason: `${own} does not live in ${dir} — this agent was not put here by the installer`};
    }
    const script = path.join(dir, 'bin', 'uninstall');
    if (fs.existsSync(script) === false) {
        return {reason: `${script} is not here — this agent was not put here by the installer: it stops, and nothing else is done`};
    }
    // The root half is asked to take itself away while there is still something to ask with
    const root = await root_gone(options);
    // The rest happens after this process is gone: it is the thing being stopped, and a unit
    // stopping itself never reaches the line after
    const child = child_process.spawn('/bin/sh', ['-c', 'sleep 1; "$0" >/dev/null 2>&1', script], {detached: true, stdio: 'ignore'});
    child.unref();
    // With its unit gone, the next start of this agent is a person's: it dials with the token
    // they start it with, not with one the host has taken out
    const aside = agent_token_set_aside(options.token);
    return {
        dir,
        root,
        kept: 'the folder and everything in it: nothing is deleted',
        token: (aside === null) ? null : `set aside as ${aside}`,
        then: 'bin/uninstall stops the agent and takes it out of systemd',
    };
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
