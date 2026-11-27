// A machine's uptime as its agent answered it, in the names this serviceman reads: each day's
// stretches {since, until, why}. An agent from before since/until names a stretch {from, to,
// why}: it is said again in the names of now; a day or a stretch already so is kept as it is.
function uptime_answer_of(answer)
{
    if (Array.isArray(answer.days) === false) {
        return answer;
    }
    const days = answer.days.map(function (day) {
        if (Array.isArray(day.down) === false) {
            return day;
        }
        return Object.assign({}, day, {down: day.down.map(stretch_of)});
    });
    return Object.assign({}, answer, {days});
}

function stretch_of(stretch)
{
    if (stretch.until !== undefined) {
        return stretch;
    }
    return {since: stretch.from, until: stretch.to, why: stretch.why};
}

module.exports = uptime_answer_of;
