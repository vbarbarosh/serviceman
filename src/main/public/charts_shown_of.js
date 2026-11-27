// History's charts as a machine's page gives them: the head's reading where History shows the
// head's range, its own reading otherwise, loading while the span picked is on its way. Each
// chart's number is the newest point of the head's reading at every span, so the number at the
// head is the one History says, and both move at the head's rate.
//
//     range        the span History shows: '24h'
//     head_range   the head's: '10m', or '1h' on an agent from before the ten minutes
//     head         the head's reading: {range, data, error, old}, data undefined before the first
//     history      History's own reading, for a span longer than the head's, the same shape
//     ->           {range, data, now, error, old, loading}: now is the head's answer
function charts_shown_of(range, head_range, head, history)
{
    const read = (range === head_range) ? head : history;
    return {range, data: read.data, now: head.data, error: read.error, old: read.old, loading: (read.data === undefined) || (read.range !== range)};
}

export default charts_shown_of;
