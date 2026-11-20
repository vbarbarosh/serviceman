const agent_root_ask = require('./agent_root_ask');
const agent_say = require('./agent_say');
const log_uid = require('../../helpers/log_uid');

// Whether the root half answered last time, so a stop and a return are each said once
let was = null;

// Whether this machine has a root half the agent may ask. It is asked, not looked for: a
// socket file that nothing answers is a socket file, and the host is told what is true now.
async function agent_root_there(options)
{
    return (await agent_root_state(options)) === 'answers';
}

// How the root half stands: 'answers'; 'none', no socket or one nothing listens on; 'stuck', it
// took the ping and did not answer it, its one thread stopped. A stop is said in the log, and
// so is its return.
async function agent_root_state(options)
{
    let state = 'answers';
    try {
        await agent_root_ask(options, 'ping', {});
    }
    catch (error) {
        state = (error.code === 'ROOTSTUCK') ? 'stuck' : 'none';
    }
    if ((state === 'stuck') && (was !== 'stuck')) {
        agent_say(log_uid(), 'root_stuck', {reason: 'the root agent did not answer a ping', then: 'asked again with every job; sudo systemctl status serviceman-agent-root'});
    }
    if ((state === 'answers') && (was === 'stuck')) {
        agent_say(log_uid(), 'root_back', undefined);
    }
    was = state;
    return state;
}

agent_root_there.state = agent_root_state;

module.exports = agent_root_there;
