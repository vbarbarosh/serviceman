// A machine's charts as its agent answered them, in the names this serviceman reads: {range,
// since, until, step_ms, points}, the ten minutes' with `after` too, the moment its points start
// after (null: all ten minutes'). An agent from before since/until names the span {from, to},
// and the ten minutes' `after` it names `since`: it is said again in the names of now. An agent
// stays from before until it takes the update, or for good where it cannot take one.
function metrics_answer_of(answer)
{
    if (answer.until !== undefined) {
        return answer;
    }
    const out = {range: answer.range, since: answer.from, until: answer.to, step_ms: answer.step_ms, points: answer.points};
    if (answer.since !== undefined) {
        out.after = answer.since;
    }
    return out;
}

module.exports = metrics_answer_of;
