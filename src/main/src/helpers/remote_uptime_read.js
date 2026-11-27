const remote_call = require('./remote_call');
const uptime_answer_of = require('./uptime_answer_of');

// How long a machine has to answer
const READ_TIMEOUT_MS = 15000;

// A machine's uptime by day for the last `days`, counted by its agent from servermon's lines, and
// kept in its state, to be shown while it is away. Throws what the machine answered, or that it
// did not.
//
//     await remote_uptime_read(app, remote, 30)   // {tz, until, days: [{day, known_ms, down_ms, down, down_more}]}
async function remote_uptime_read(app, remote, days)
{
    const answer = uptime_answer_of(await remote_call(app, remote, 'uptime', {days}, READ_TIMEOUT_MS));
    remote.state.uptime = answer;
    return answer;
}

module.exports = remote_uptime_read;
