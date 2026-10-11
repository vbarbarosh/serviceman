const agent_built = require('./agent_built');
const agent_root_ask = require('./agent_root_ask');
const agent_root_ping = require('./agent_root_ping');
const agent_say = require('./agent_say');
const timers = require('timers/promises');

// How long the system is given to start the new one before this end calls it gone
const BACK_WITHIN_MS = 15000;
const LOOK_EVERY_MS = 1000;

// Said once about one build, not once every half minute: a line that repeats forever is a
// line nobody reads
let said_about = null;

// The two halves of a machine run from the same file, and an update replaces that file under
// both of them — but only the session half is started again by it. The root half goes on
// running the code it read at boot, which is the old code, until something says so. This is
// that something: it is asked to stop, and the system that keeps it up starts the new one.
async function agent_root_current(options, group)
{
    const said = await agent_root_ping(options);
    if ((said === null) || (said.built === agent_built)) {
        said_about = null;
        return false;
    }
    // A root half that says nothing about being kept up is one from before it could say so —
    // the same update that left it behind. Installed by bin/install-root it is under systemd,
    // so it is asked, and this end watches for it to come back rather than assuming.
    if (said.supervised === false) {
        say_once(said, group, 'root_update_by_hand', {then: 'nothing would start it again'});
        return false;
    }
    agent_say(group, 'root_update_asked', {running: said.built, serving: agent_built});
    await agent_root_ask(options, 'restart', {});
    if (await back_again(options)) {
        said_about = null;
        return true;
    }
    say_once(said, group, 'root_update_gone', {then: 'nothing started it again — sudo systemctl start serviceman-agent-root on that machine'});
    return false;
}

// Whether the new one is answering. It is a socket on the same machine, so this is a second
// or two, not a wait worth making anybody sit through.
async function back_again(options)
{
    const until = Date.now() + BACK_WITHIN_MS;
    while (Date.now() < until) {
        await timers.setTimeout(LOOK_EVERY_MS);
        const said = await agent_root_ping(options);
        if (said !== null) {
            return true;
        }
    }
    return false;
}

function say_once(said, group, sender, words)
{
    if (said_about === String(said.built)) {
        return;
    }
    said_about = String(said.built);
    agent_say(group, sender, Object.assign({running: said.built, serving: agent_built}, words));
}

module.exports = agent_root_current;
