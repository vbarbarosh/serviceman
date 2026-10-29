import format_bytes from './format_bytes.js';
import format_ms from './format_ms.js';

// A machine says its numbers every 5 s; a silence longer than this is one it would have broken
const HEARD_WITHIN_MS = 8000;
// Bytes that moved this recently are bytes that move: the far end says what it wrote every
// window, many times a second on a link that carries anything
const MOVING_MS = 3000;

// A machine whose answers do not come, in words: what was asked, how long it has waited,
// whether the machine is heard at all, and the file its link carries meanwhile, how far it got
// and when its bytes last moved; '' while it answers
function remote_unanswered_said(remote)
{
    const waiting = remote.unanswered;
    if ((remote.phase !== 'online') || (waiting === null) || (waiting === undefined)) {
        return '';
    }
    const heard = ((waiting.heard_ms !== null) && (waiting.heard_ms < HEARD_WITHIN_MS)) ? 'its link is up and its beats still come' : `nothing came from it for ${format_ms(waiting.heard_ms)}`;
    return `Not answering for ${format_ms(waiting.ms)}: serviceman asked it ${waiting.method} and waits for the answer; ${heard}${carrying_said(waiting.carrying)}`;
}

// "; the link carries big.tar to it meanwhile, 12.4MB sent and 8.4MB written there, nothing more
// for 1m 3s"
function carrying_said(carrying)
{
    if ((carrying === null) || (carrying === undefined) || (carrying.count === 0)) {
        return '';
    }
    const first = carrying.files[0];
    const which = (carrying.count === 1) ? first.name : `${carrying.count} files, the furthest along ${first.name}`;
    const moved = (first.still_ms < MOVING_MS) ? 'and growing' : `nothing more for ${format_ms(first.still_ms)}`;
    if (first.way === 'to') {
        return `; the link carries ${which} to it meanwhile, ${format_bytes(first.bytes)} sent and ${format_bytes(first.taken)} written there, ${moved}`;
    }
    return `; the link carries ${which} from it meanwhile, ${format_bytes(first.bytes)} come, ${moved}`;
}

export default remote_unanswered_said;
