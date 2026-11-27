const metrics_answer_of = require('./metrics_answer_of');
const remote_call = require('./remote_call');

// How long a machine has to answer
const READ_TIMEOUT_MS = 15000;

// A machine's charts for one range, read from its agent, which keeps the numbers on its own disk,
// and kept in its state, the last answer for each range, to be shown while it is away. The ten
// minutes are asked only for the seconds after the last point kept, and the answer is the kept
// points with those added. Throws what the machine answered, or that it did not.
//
//     await remote_metrics_read(app, remote, '1h')   // {range, since, until, step_ms, points}
async function remote_metrics_read(app, remote, range)
{
    const kept = remote.state.metrics[range];
    const after = ((range === '10m') && (kept !== undefined) && (kept.points.length > 0)) ? kept.points[kept.points.length - 1].at : null;
    let answer = metrics_answer_of(await remote_call(app, remote, 'metrics', (after === null) ? {range} : {range, after}, READ_TIMEOUT_MS));
    if (after !== null) {
        const added = answer.points.filter(v => v.at > after);
        answer = Object.assign({}, answer, {after: null, points: kept.points.filter(v => v.at > answer.since).concat(added)});
    }
    remote.state.metrics[range] = answer;
    return answer;
}

module.exports = remote_metrics_read;
