// What the link adds to the numbers: when the last beat went out, and how long each answer
// took to come back since the last sample. One object for the life of the agent; the link
// comes and goes, and a sample taken with no link has no ping.
const agent_metrics_state = {beat_sent_at: null, pings: []};

module.exports = agent_metrics_state;
