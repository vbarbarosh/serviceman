// How far before the end of an answer its newest point may stand and still be said as now: five
// seconds of servermon's silence, as the agent's own numbers allow (agent_stats), or two steps
// and a half of a range of longer steps, the gap that breaks a chart's line
const SILENT_MS = 5000;

// The newest point of a machine's charts that says a value: the point its head's number and
// History's are both said from, so the head says the number History's line ends on. Null where
// no point says it, or where the newest that does is too old to be now (servermon stopped): a
// number from minutes before is never said as the machine's now.
//
//     data    an answer of the machine's: {until, step_ms, points: [{at, cpu, mem, …}]}; null or
//             undefined for none
//     has     (point) -> whether the point says the value: v => (share_of(v.cpu, 1) !== null)
//     ->      the point: {at, cpu, mem, …}, or null
function chart_newest_of(data, has)
{
    if ((data === null) || (data === undefined) || (Array.isArray(data.points) === false)) {
        return null;
    }
    const found = data.points.findLast(has);
    if (found === undefined) {
        return null;
    }
    return (data.until - found.at > Math.max(SILENT_MS, 2.5*data.step_ms)) ? null : found;
}

export default chart_newest_of;
