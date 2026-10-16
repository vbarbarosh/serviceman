// A machine's lines on their way to Logline, and what keeps them from it: Logline refusing
// them, nothing sent for a while though lines wait, or the store on the machine near its cap,
// past which collecting stops and what Docker drops in the meantime is lost.
//
//     status   remote.state.stats.logline, as the agent says it (agent_logline.status)
const SILENT_MS = 10*60*1000;
const NEAR_CAP = 0.8;

function problems_from_logline(remote, status, now)
{
    const out = [];
    if ((status === null) || (status === undefined) || (status.collecting !== true)) {
        return out;
    }
    const waiting = status.waiting;
    const oldest = (((waiting === undefined) || (waiting.oldest === null)) ? null : Date.parse(waiting.oldest));
    const since = (Number.isFinite(oldest) ? oldest : null);
    const answer = status.last_answer;
    if ((answer !== null) && (answer !== undefined) && (answer !== 'ok')) {
        out.push({
            key: `logline_refused:${remote}`,
            kind: 'logline',
            remote,
            subject: `Logline does not take ${remote}'s lines`,
            cause: `it answers "${answer}"`,
            fix: fix_of(answer),
            since,
        });
    }
    else if ((waiting !== undefined) && (waiting.lines > 0) && (status.last_sent_at !== null) && (now - Date.parse(status.last_sent_at) >= SILENT_MS)) {
        out.push({
            key: `logline_silent:${remote}`,
            kind: 'logline',
            remote,
            subject: `${remote} sends Logline nothing`,
            cause: `${waiting.lines.toLocaleString('en-US')} lines wait, and the last went ${minutes(now - Date.parse(status.last_sent_at))} ago`,
            fix: 'Its Logs tab says what Logline answered last; the agent\'s log on the machine says more.',
            since: Date.parse(status.last_sent_at),
        });
    }
    if ((waiting !== undefined) && Number.isFinite(status.cap_bytes) && (status.cap_bytes > 0) && (waiting.bytes >= status.cap_bytes*NEAR_CAP)) {
        const full = (waiting.bytes >= status.cap_bytes);
        out.push({
            key: `logline_full:${remote}`,
            kind: 'logline',
            remote,
            subject: (full ? `${remote} has stopped collecting its lines` : `${remote}'s lines near the limit of what it keeps`),
            cause: `${mb(waiting.bytes)} of ${mb(status.cap_bytes)} wait to be sent`,
            fix: (full ? 'New lines stay with Docker until there is room, and what Docker rotates away meanwhile is lost: let Logline take them first.' : 'Once it is full, collecting stops: let Logline take what waits first.'),
            since,
        });
    }
    return out;
}

function fix_of(answer)
{
    if (/not from an address this token was issued for/.test(answer)) {
        return 'Logline sees the machine at another address, most often after Tailscale was updated on Logline\'s machine: restart Docker there.';
    }
    if (/^401|^403/.test(answer)) {
        return 'Its token is not taken: give the machine a new one from its Logs tab.';
    }
    return 'Logline or the way to it is down: see that Logline runs and answers at its endpoint.';
}

function minutes(ms)
{
    const m = Math.round(ms/60000);
    return ((m < 120) ? `${m} min` : `${Math.round(m/60)} h`);
}

function mb(bytes)
{
    return `${Math.round(bytes/1024/1024).toLocaleString('en-US')} MB`;
}

module.exports = problems_from_logline;
