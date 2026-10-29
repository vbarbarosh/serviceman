import format_ms from './format_ms.js';

// A machine's state in a few words beside its name: online with its round trip, not answering
// with how long its calls have waited, or offline
function remote_state_text(remote)
{
    if (remote.phase !== 'online') {
        return 'offline';
    }
    if ((remote.unanswered !== null) && (remote.unanswered !== undefined)) {
        return `not answering · ${format_ms(remote.unanswered.ms)}`;
    }
    return `online · ${(remote.latency_ms === null) ? '…' : `${remote.latency_ms}ms`}`;
}

export default remote_state_text;
