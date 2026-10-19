const agent_link = require('./agent_link');
const agent_log = require('./agent_log');
const link_send_message = require('../../helpers/link_send_message');
const log_words = require('../../helpers/log_words');

// One line, in the shape every serviceman line has: `[time][group][sender] details`. The group
// is the attempt this line belongs to, so one dial-in reads as one story on both ends.
//
// It goes four ways: to stdout, to the daily file beside the agent, up the link to the host —
// the machine that asked for the work is the one that wants to watch it happen — and to
// whatever takes the agent's own lines for Logline, when something does.
function agent_say(group, sender, details, service)
{
    // Free text when the caller writes it itself — a line a command printed is already a line,
    // and nothing is gained by wrapping it in a key
    const words = (typeof details === 'string') ? details : log_words(details);
    const time = new Date().toISOString();
    const tail = `[${group}][${sender}]${(words === '') ? '' : ` ${words}`}`;
    const line = `[${time}]${tail}`;
    console.log(line);
    agent_log(line);
    told(group, sender, details, service);
    if (sink.fn !== null) {
        sink.fn(time, tail);
    }
}

// Where the agent's own lines go besides: set by collection, so this file needs nothing of it
const sink = {fn: null};

agent_say.sink_set = function (fn) {
    sink.fn = fn;
};

function told(group, sender, details, service)
{
    const socket = agent_link();
    if ((socket === null) || socket.destroyed) {
        return;
    }
    try {
        // The service travels beside the line, not inside it: the host needs it for the page
        // somebody is waiting on, and a reader needs the line as the command wrote it
        link_send_message(socket, {type: 'log', group, sender, words: (details === undefined) ? {} : details, service});
    }
    catch {
        // The link went while this was being written. The line is already in this machine's
        // own log, which is the copy that matters here.
    }
}

module.exports = agent_say;
