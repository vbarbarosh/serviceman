const link_send_message = require('../../../helpers/link_send_message');
const remote_call_wait = require('./remote_call_wait');

const DEFAULT_TIMEOUT_MS = 60000;

// Asks the agent to do one thing and answers with what it did
function remote_call(app, remote, method, params, timeout_ms)
{
    const state = remote.state;
    if (state.phase !== 'online') {
        return Promise.reject(new Error(`remote ${remote.name} is ${state.phase} — its agent is not dialled in`));
    }
    const id = ++state.next_call_id;
    const out = remote_call_wait(remote, id, ((timeout_ms === undefined) ? DEFAULT_TIMEOUT_MS : timeout_ms));
    try {
        link_send_message(state.socket, {type: 'call', id, method, params: ((params === undefined) ? {} : params)});
    }
    catch (error) {
        // The link went while this call was being written. The wait is already standing, so it
        // is answered here and now: left alone, it would fire into nobody's hands a minute
        // later, and an answer nobody is holding takes the process down with it.
        const call = state.calls[id];
        delete state.calls[id];
        clearTimeout(call.timer);
        call.reject(error);
    }
    return out;
}

module.exports = remote_call;
