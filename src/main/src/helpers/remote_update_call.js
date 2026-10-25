const agent_bundle = require('../../../agent/bundler/agent_bundle');
const agent_signature = require('./agent_signature');
const remote_call = require('./remote_call');

// How an agent from before 2026-10-06 answers the first ask after an update that worked: it
// read the end of that run, which bin/update writes after the new agent started, as its own
const STALE_REFUSAL = 'bin/update ran to the end, and this agent is still the old one';

// The ask to update, with the new agent in it and the host's signature of it, which a machine
// that knows this host's key checks before it writes the file. Such an agent drops that log as
// it answers, so one more ask runs bin/update for real.
async function remote_update_call(app, remote)
{
    const answer = await remote_call(app, remote, 'update', asked(app));
    if ((answer.started === false) && String(answer.reason).startsWith(STALE_REFUSAL)) {
        return remote_call(app, remote, 'update', asked(app));
    }
    return answer;
}

function asked(app)
{
    const text = agent_bundle();
    return {text, signature: agent_signature(app, text)};
}

module.exports = remote_update_call;
