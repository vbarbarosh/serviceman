const link_carrying = require('./link_carrying');

// What a machine answers in a blink: what the host asks it every minute, and what a page asks
// it to show. None of them takes a machine a second; the slow ones, an upgrade, a pull, a
// delete of a big folder, are not here.
const QUICK = ['ping', 'stats', 'metrics', 'uptime', 'resources', 'fs_list', 'fs_stat', 'fs_room', 'file_part_stat', 'file_part_finish', 'file_part_remove', 'dir_create', 'fs_rename', 'link_create', 'proc_list', 'port_list', 'disk_list', 'term_list', 'ufw'];

// How long one of them may go without its answer before the machine is said not to answer
const SAID_AFTER_MS = 10000;

// The oldest quick call to this machine still waiting for its answer past SAID_AFTER_MS, or
// the call that ran out of time with no answer since, whichever was asked first: {method, ms,
// heard_ms, carrying}, ms how long it has waited, heard_ms how long since anything came from
// the machine at all, and carrying the files its link carries meanwhile (link_carrying); null
// while it answers. A machine whose beats come and whose answers do not is one whose link is up
// and whose calls wait in line: its page says so, until it answers.
function remote_unanswered(state, now)
{
    if ((state.phase !== 'online') || (state.calls === undefined)) {
        return null;
    }
    const since = (state.unanswered_since === undefined) ? null : state.unanswered_since;
    let oldest = (since === null) ? null : {method: state.unanswered_method, at: since};
    for (const id of Object.keys(state.calls)) {
        const call = state.calls[id];
        if ((QUICK.includes(call.method) === false) || (now - call.at < SAID_AFTER_MS)) {
            continue;
        }
        if ((oldest === null) || (call.at < oldest.at)) {
            oldest = call;
        }
    }
    if (oldest === null) {
        return null;
    }
    return {method: oldest.method, ms: now - oldest.at, heard_ms: (state.heard_at === null) ? null : now - state.heard_at, carrying: link_carrying(state, now)};
}

remote_unanswered.QUICK = QUICK;
remote_unanswered.SAID_AFTER_MS = SAID_AFTER_MS;

module.exports = remote_unanswered;
