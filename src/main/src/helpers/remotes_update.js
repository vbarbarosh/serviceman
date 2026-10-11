const agent_bundle = require('../../../agent/bundler/agent_bundle');
const log_event = require('./log_event');
const remote_update_call = require('./remote_update_call');

// A machine is asked again at most this often. An update replaces the agent, so the next hello
// is either the new build or the same one — and the same one over and over is a machine that
// cannot update itself, not a machine to keep asking.
const ASK_AGAIN_MS = 600000;
// How the page says an update was answered and did not happen
const NOT_TAKEN = 'it says it started, and it still runs its old build after';

// Machines running an older agent than this host serves are asked to fetch the current one.
// Asked when they dial in, and asked again on a clock — a machine that has been connected for
// a week would otherwise never hear that the agent moved on.
function remotes_update(app)
{
    if (app.config.agent_update === false) {
        return;
    }
    const serves = agent_bundle.built_at();
    for (const remote of app.remotes) {
        offer(app, remote, serves);
    }
}

function offer(app, remote, serves)
{
    const state = remote.state;
    // An agent that names no build at all is from before the stamp — the oldest kind there
    // is, and the one that needs the offer most
    if ((state.phase !== 'online') || (state.agent_built === serves)) {
        if (state.agent_built === serves) {
            state.update_refused = null;
            state.update_not_taken = 0;
        }
        return;
    }
    if ((state.update_asked_at !== null) && (Date.now() - state.update_asked_at < ASK_AGAIN_MS)) {
        return;
    }
    // Asked before and still the same build: whatever it answered, the update did not take.
    // Said here, where it shows for an agent of any age — one too old to say why says nothing.
    if ((state.update_asked_at !== null) && (state.update_asked_build === state.agent_built)) {
        state.update_not_taken++;
        log_event(app, 'remote_update_not_taken', {remote: remote.name, running: state.agent_built, serving: serves, asked: state.update_not_taken});
        if ((state.update_refused === null) || state.update_refused.startsWith(NOT_TAKEN)) {
            state.update_refused = `${NOT_TAKEN} ${state.update_not_taken} ${(state.update_not_taken === 1) ? 'ask' : 'asks'} — bin/update run by hand on that machine shows why`;
        }
    }
    state.update_asked_at = Date.now();
    state.update_asked_build = state.agent_built;
    log_event(app, 'remote_update_asked', {remote: remote.name, running: state.agent_built, serving: serves});
    // The new agent rides along in the ask: a machine whose agent was not put there by the
    // installer — a container above all — has no bin/update to run, but it can write this
    // file over its own and leave the restart to whatever keeps it up
    const promise = remote_update_call(app, remote);
    promise.then(function (answer) {
        if (answer.started === false) {
            state.update_refused = answer.reason;
            log_event(app, 'remote_update_refused', {remote: remote.name, reason: answer.reason});
        }
        // A start is not an update: why the last one failed stands until the machine runs what
        // this host serves
    }, function (error) {
        state.update_refused = error.message;
        log_event(app, 'remote_update_refused', {remote: remote.name, reason: error.message});
    });
}

module.exports = remotes_update;
