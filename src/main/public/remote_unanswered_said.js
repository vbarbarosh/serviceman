import format_ms from './format_ms.js';

// A machine says its numbers every 5 s; a silence longer than this is one it would have broken
const HEARD_WITHIN_MS = 8000;

// A machine whose answers do not come, in words: what was asked, how long it has waited, and
// whether the machine is heard at all; '' while it answers
function remote_unanswered_said(remote)
{
    const waiting = remote.unanswered;
    if ((remote.phase !== 'online') || (waiting === null) || (waiting === undefined)) {
        return '';
    }
    const heard = ((waiting.heard_ms !== null) && (waiting.heard_ms < HEARD_WITHIN_MS)) ? 'its link is up and its beats still come' : `nothing came from it for ${format_ms(waiting.heard_ms)}`;
    return `Not answering for ${format_ms(waiting.ms)}: serviceman asked it ${waiting.method} and waits for the answer; ${heard}`;
}

export default remote_unanswered_said;
