import clock_of from './clock_of.js';
import format_ms from './format_ms.js';

// The phases a restart is not over in
const UNDERWAY = ['asking', 'going', 'down', 'back'];

// Where a machine's restart stands, as a card says it under the problem it mends: `text` the
// words, `tone` '' (under way, with a spinner), 'ok' or 'bad', `underway` whether it is not over.
// Null where no restart was asked since serviceman started.
//
//     restart  the machine's restart, as the status has it (machine_restart), or null
//     now      ms, the page's clock
function restart_said(restart, now)
{
    if ((restart === null) || (restart === undefined)) {
        return null;
    }
    const since = format_ms(Math.max(0, now - restart.asked_at));
    if (restart.phase === 'asking') {
        return {text: 'Asking it to restart…', tone: '', underway: true};
    }
    if (restart.phase === 'going') {
        return {text: `Going down · ${since}: it said ${restart.by}`, tone: '', underway: true};
    }
    if (restart.phase === 'down') {
        return {text: `Restarting · ${since}: waiting for its agent to dial in`, tone: '', underway: true};
    }
    if (restart.phase === 'back') {
        return {text: `Back after ${format_ms(restart.back_at - restart.down_at)} away: looking at it again`, tone: '', underway: true};
    }
    if (restart.phase === 'done') {
        return {text: `Restarted at ${clock_of(restart.back_at)}, away ${format_ms(restart.back_at - restart.down_at)}`, tone: 'ok', underway: false};
    }
    return {text: restart.error, tone: 'bad', underway: false};
}

restart_said.underway = function (restart) {
    return (restart !== null) && (restart !== undefined) && UNDERWAY.includes(restart.phase);
};

export default restart_said;
