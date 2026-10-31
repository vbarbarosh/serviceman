// What the link adds to the numbers: when the last beat went out, how long each answer took to
// come back since the last sample, and the answers of the last minutes with their times, for the
// ten-minute chart. One object for the life of the agent; the link comes and goes, and a sample
// taken with no link has no ping.
const agent_metrics_state = {beat_sent_at: null, pings: [], pings_lately: []};

module.exports = agent_metrics_state;
