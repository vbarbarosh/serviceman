import clock_of from './clock_of.js';
import format_ms from './format_ms.js';

// The lines of its own a note shows, the newest
const LINES_SHOWN = 3;

// What the note under a service's head says of how it stands, or null when the head says it
// all: on its way up, stopped by you, failed, stopping badly over and over, or its machine away.
// The note says why and what to do; Start and Stop stay in the head.
//
//     view      the service as the status has it
//     machine   the machine it runs on as the status has it ({name, phase, left_at}), or null
//     now       the time now, in ms
//
//     {tone: 'acc', icon: 'clock', title: 'Starting on vps1 · 12s so far',
//      text: 'It is up once it answers on port 8080.', lines: ['…'], progress: 0.4,
//      action: 'logs'}
//
// tone is acc, idle, bad or busy; icon clock, stop, bad, again or away; progress null when
// nothing says how far; action logs (All logs) or machine (See the machine)
function service_note_said(view, machine, now)
{
    if ((view.type === 'external') || (view.type === 'files')) {
        return null;
    }
    // A program runs as one copy: the first says how it went
    const first = (view.instances.length === 0) ? null : view.instances[0];
    const lines = view.said.slice(-LINES_SHOWN);
    if ((machine !== null) && (machine.phase !== 'online')) {
        const since = ((machine.left_at === null) || (machine.left_at === undefined)) ? '' : ` since ${time_said(machine.left_at, now)}`;
        const then = (view.held === true) ? 'It stays stopped there until you start it.' : 'serviceman takes it up there as soon as the machine dials in again.';
        return {tone: 'busy', icon: 'away', title: `${machine.name} is offline${since}`, text: `${then} Nothing is lost: its settings wait here.`, lines: [], progress: null, action: 'machine'};
    }
    // Stopping badly over and over: waiting for its next try, or on its way up again after one
    const again = (first !== null) && (first.restarts > 1) && ((first.next_try_ms !== null) || (view.phase === 'starting'));
    if (again) {
        const next = (first.next_try_ms === null) ? 'it is starting again' : `the next try in ${format_ms(first.next_try_ms)}`;
        const how = (first.exit === null) ? 'it stopped' : `it ended with ${first.exit}`;
        const ran = (first.ran_ms === null) ? '' : ` after ${format_ms(first.ran_ms)}`;
        return {tone: 'busy', icon: 'again', title: `It stopped badly ${first.restarts} times since ${time_said(first.restarts_since, now)}; ${next}`, text: `The last time ${how}${ran}. Stop ends it now.`, lines, progress: null, action: 'logs'};
    }
    // A new version or an image on its way is said the same way, its copy shown in the note
    if ((view.phase === 'starting') || (view.doing !== null) || ((view.copy !== null) && (view.copy !== undefined))) {
        const where = (machine === null) ? '' : ` on ${machine.name}`;
        // On its way up, what it waits for is the text, not the title; other work is the title
        const doing = ((view.doing === null) || (view.phase === 'starting')) ? null : view.doing;
        const word = (doing === null) ? (((view.copy !== null) && (view.copy !== undefined)) ? 'A new version on its way' : 'Starting') : capital(doing);
        const far = ((first === null) || (first.starting_ms === null)) ? '' : ` · ${format_ms(first.starting_ms)} so far`;
        const port = view.publish.port;
        const text = (view.progress_text !== null) ? view.progress_text : ((port === null) ? 'It is up as soon as its program runs.' : `It is up once it answers on port ${port}.`);
        return {tone: 'acc', icon: 'clock', title: `${word}${where}${far}`, text, lines, progress: view.progress, action: 'logs'};
    }
    if (view.phase === 'failed') {
        const how = ((first === null) || (first.exit === null)) ? 'It failed' : `It ended with ${first.exit}`;
        const ended = ((first === null) || (first.stopped_at === null) || (first.stopped_at === undefined)) ? view.stopped_at : first.stopped_at;
        const when = (ended === null) ? '' : ` at ${time_said(ended, now)}`;
        const tries = (view.failures > 1) ? `, ${view.failures} starts in a row` : '';
        const gave_up = view.gave_up ? '; serviceman stopped trying' : '';
        const next = ((first !== null) && (first.next_try_ms !== null)) ? `; the next try in ${format_ms(first.next_try_ms)}` : '';
        // Its own lines say why best; with none, serviceman's reason, its name taken off the front
        const reason = ((view.error === null) || (view.error === undefined)) ? '' : capital(view.error.replace(`${view.name}: `, '').replace(/ — serviceman stopped trying after .*$/, ''));
        return {tone: 'bad', icon: 'bad', title: `${how}${when}${tries}${gave_up}${next}`, text: (lines.length > 0) ? 'Its last lines:' : reason, lines, progress: null, action: 'logs'};
    }
    if ((view.phase === 'stopped') && (view.held === true)) {
        const when = (view.stopped_at === null) ? '' : ` at ${time_said(view.stopped_at, now)}`;
        const ran = ((first === null) || (first.ran_ms === null)) ? '' : `It ran ${format_ms(first.ran_ms)}. `;
        const sleeps = (view.policy.start !== 'always') ? ' A visit still wakes it.' : '';
        return {tone: 'idle', icon: 'stop', title: `Stopped by you${when}`, text: `${ran}It stays stopped until you start it; a Save or its machine coming back does not start it.${sleeps}`, lines: [], progress: null, action: ''};
    }
    return null;
}

// A time as the note says it: 14:18 today, 18 Nov 14:18 another day
function time_said(ms, now)
{
    if ((ms === null) || (ms === undefined)) {
        return 'a while';
    }
    const at = new Date(ms);
    if (at.toDateString() === new Date(now).toDateString()) {
        return clock_of(ms);
    }
    return `${at.getDate()} ${at.toLocaleString('en', {month: 'short'})} ${clock_of(ms)}`;
}

function capital(text)
{
    return text.slice(0, 1).toUpperCase() + text.slice(1);
}

export default service_note_said;
