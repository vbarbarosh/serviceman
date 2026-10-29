const format_duration_ms = require('../../../helpers/format_duration_ms');

// Holds the promise of one call until the agent answers it, or until the wait is over. The call
// keeps what it asked and when, so a machine whose answers stop coming can be seen to
// (remote_unanswered); a wait that runs out says so through `timed_out`, when given.
function remote_call_wait(remote, id, timeout_ms, method, timed_out)
{
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
            delete remote.state.calls[id];
            reject(new Error(`remote ${remote.name} did not answer within ${format_duration_ms(timeout_ms)}`));
            if (timed_out !== undefined) {
                timed_out();
            }
        }, timeout_ms);
        timer.unref();
        remote.state.calls[id] = {resolve, reject, timer, method: (method === undefined) ? null : method, at: Date.now()};
    });
}

module.exports = remote_call_wait;
