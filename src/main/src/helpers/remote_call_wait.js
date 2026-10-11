const format_duration_ms = require('../../../helpers/format_duration_ms');

// Holds the promise of one call until the agent answers it, or until the wait is over
function remote_call_wait(remote, id, timeout_ms)
{
    return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
            delete remote.state.calls[id];
            reject(new Error(`remote ${remote.name} did not answer within ${format_duration_ms(timeout_ms)}`));
        }, timeout_ms);
        timer.unref();
        remote.state.calls[id] = {resolve, reject, timer};
    });
}

module.exports = remote_call_wait;
