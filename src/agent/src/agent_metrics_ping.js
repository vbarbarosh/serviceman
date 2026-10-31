const agent_metrics_state = require('./agent_metrics_state');

// The answers kept with their times: the ten-minute chart's span, and a beat more
const LATELY_MS = 11*60*1000;

// A beat's way there and back, `ms`, its answer heard at `at`: for the next half-minute line,
// and for the ten-minute chart, which says each second the last one heard
function agent_metrics_ping(ms, at)
{
    agent_metrics_state.pings.push(ms);
    const lately = agent_metrics_state.pings_lately;
    lately.push({at, ms});
    while ((lately.length > 0) && (lately[0].at < at - LATELY_MS)) {
        lately.shift();
    }
}

module.exports = agent_metrics_ping;
