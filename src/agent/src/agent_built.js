// When the file was made, written in by the bundler. Run from the repo there is no build to
// date, and the line that says what this agent is leaves it out.
//
// SERVICEMAN_AGENT_BUILT says it instead, for a test that needs to be an older agent than the
// host it dials.
const agent_built = process.env.SERVICEMAN_AGENT_BUILT || null;

module.exports = agent_built;
