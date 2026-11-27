// A machine's charts for one range, as its page reads them for its head and History: serviceman's
// answer, or what is shown kept where the machine is slow to answer (502) or serviceman does not
// answer, with why; none, with why, where it has none to give (an agent before charts, a machine
// away that was never read).
//
//     name     the machine: 'vps1'
//     range    '10m', '1h', '24h', '7d', '30d'
//     shown    the answer shown for that range, kept where no new one comes; null for none
//     ->       {range: '10m', data: {since, until, step_ms, points, away} or null, error: null or why,
//               old: whether its agent is from before charts}
async function charts_read(name, range, shown)
{
    try {
        const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(name)}/metrics?range=${range}`, {cache: 'no-store'});
        const body = await answer.json();
        if (answer.ok) {
            return {range, data: body, error: null, old: false};
        }
        return {range, data: (answer.status === 502) ? shown : null, error: body.error, old: (body.old_agent === true)};
    }
    catch (error) {
        return {range, data: shown, error: `Could not read the charts: ${error.message}`, old: false};
    }
}

export default charts_read;
