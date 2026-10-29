const format_duration_ms = require('../../../helpers/format_duration_ms');
const link_carrying = require('./link_carrying');
const link_send_message = require('../../../helpers/link_send_message');
const log_event = require('./log_event');
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
    const wait_ms = (timeout_ms === undefined) ? DEFAULT_TIMEOUT_MS : timeout_ms;
    const out = remote_call_wait(remote, id, wait_ms, method, function () {
        unanswered(app, remote, method, wait_ms);
    });
    try {
        link_send_message(state.socket, {type: 'call', id, method, params: (params === undefined) ? {} : params});
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

// A machine whose answer did not come is said once, until it answers again (remote_attach):
// its link may stay up and its beats keep coming while what is sent to it waits in line, and
// without this line the log says nothing of it at all. A file its link carries meanwhile is
// said with it, and how long its bytes have stood: a link that is full, or one that carries
// nothing at all.
function unanswered(app, remote, method, wait_ms)
{
    if ((remote.state.unanswered_since !== null) && (remote.state.unanswered_since !== undefined)) {
        return;
    }
    remote.state.unanswered_since = Date.now() - wait_ms;
    remote.state.unanswered_method = method;
    log_event(app, 'remote_unanswered', Object.assign({remote: remote.name, method, waited: format_duration_ms(wait_ms)}, link_carrying.words(link_carrying(remote.state, Date.now()))));
}

module.exports = remote_call;
