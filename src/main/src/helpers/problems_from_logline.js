// A machine's lines on their way to Logline, and what keeps them from it: Logline refusing
// them, nothing sent for a while though lines wait, lines Logline will never take put aside on
// the machine, or the store on the machine near its cap, past which collecting stops and what
// Docker drops in the meantime is lost.
//
//     status   remote.state.stats.logline, as the agent says it (agent_logline.status)
const SILENT_MS = 10*60*1000;
const NEAR_CAP = 0.8;
// The 4xx answers an agent waits through, as its logline_ship has them, besides the token's
// 401 and 403: any other 4xx is Logline saying it will never take the lines as they are
const WAITED = ['404', '408', '425', '429'];

function problems_from_logline(remote, status, now)
{
    const out = [];
    if ((status === null) || (status === undefined) || (status.collecting !== true)) {
        return out;
    }
    const waiting = status.waiting;
    const oldest = ((waiting === undefined) || (waiting.oldest === null)) ? null : Date.parse(waiting.oldest);
    const since = Number.isFinite(oldest) ? oldest : null;
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
    const aside = status.aside;
    if ((aside !== null) && (aside !== undefined) && (aside.files > 0)) {
        out.push(problem_of_aside(remote, aside, refusal(answer), since));
    }
    if ((waiting !== undefined) && Number.isFinite(status.cap_bytes) && (status.cap_bytes > 0) && (waiting.bytes >= status.cap_bytes*NEAR_CAP)) {
        const full = (waiting.bytes >= status.cap_bytes);
        out.push({
            key: `logline_full:${remote}`,
            kind: 'logline',
            remote,
            subject: full ? `${remote} has stopped collecting its lines` : `${remote}'s lines near the limit of what it keeps`,
            cause: `${mb(waiting.bytes)} of ${mb(status.cap_bytes)} wait to be sent`,
            fix: full ? 'New lines stay with Docker until there is room, and what Docker rotates away meanwhile is lost: let Logline take them first.' : 'Once it is full, collecting stops: let Logline take what waits first.',
            since,
        });
    }
    return out;
}

// Lines put aside on the machine. They hold nothing back while refused/ has room, nor once it is
// full until Logline refuses one more line: only then does that line wait, with every line
// behind it, and the card turns from a warning to a failure that says since when. An agent from
// before the answer and the times leaves them out, and the card says what it can.
function problem_of_aside(remote, aside, refused, since)
{
    const held = aside.full && refused;
    const files = `${aside.files.toLocaleString('en-US')} ${(aside.files === 1) ? 'file' : 'files'}`;
    const answered = (typeof aside.answer === 'string') && (aside.answer !== '');
    const oldest = (typeof aside.oldest_at === 'string') ? Date.parse(aside.oldest_at) : NaN;
    let subject = `Logline will not take some of ${remote}'s lines`;
    let fix = 'Each file holds the lines and what Logline answered, and nothing sends them again: send them by hand once fixed, or delete them. This goes when the folder is empty.';
    if (held) {
        subject = `${remote} sends Logline nothing until its refused/ has room`;
        fix = 'No more fit there, so the line Logline refuses now waits, and every line behind it: move the files away or delete them.';
    }
    else if (aside.full) {
        subject = `Logline refused ${remote}'s lines, and no more fit aside`;
        fix = 'Lines still go. Once Logline refuses one more, it waits with every line behind it: move the files away or delete them.';
    }
    return {
        key: `logline_aside:${remote}`,
        kind: 'logline',
        remote,
        level: held ? 'bad' : 'warn',
        subject,
        cause: answered ? `Logline answered: ${aside.answer} · ${files} kept on the machine, in logline/spool/refused of its agent's folder` : `${files} of lines Logline refused ${(aside.files === 1) ? 'is' : 'are'} kept on the machine, in logline/spool/refused of its agent's folder`,
        fix,
        since: held ? since : (Number.isFinite(oldest) ? oldest : null),
    };
}

// Whether Logline's answer says it will never take the lines as they are: a 4xx the agent does
// not wait through, its token's 401 and 403 aside
function refusal(answer)
{
    return (typeof answer === 'string') && /^4\d\d\b/.test(answer) && (/^401|^403/.test(answer) === false) && (WAITED.includes(answer.slice(0, 3)) === false);
}

function fix_of(answer)
{
    if (/not from an address this token was issued for/.test(answer)) {
        return 'Logline sees the machine at another address, most often after Tailscale was updated on Logline\'s machine: restart Docker there.';
    }
    if (/^401|^403/.test(answer)) {
        return 'Its token is not taken: give the machine a new one from its Logs tab.';
    }
    if (refusal(answer)) {
        return 'Logline runs, and will never take these lines as they are: its answer says why. The machine puts such lines aside in refused/, in its spool, and sends the rest; when that folder is full it waits for room there.';
    }
    return 'Logline or the way to it is down: see that Logline runs and answers at its endpoint.';
}

function minutes(ms)
{
    const m = Math.round(ms/60000);
    return (m < 120) ? `${m} min` : `${Math.round(m/60)} h`;
}

function mb(bytes)
{
    return `${Math.round(bytes/1024/1024).toLocaleString('en-US')} MB`;
}

module.exports = problems_from_logline;
