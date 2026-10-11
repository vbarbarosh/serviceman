// What the door routes by, and the link it hands the rest to. One object for the life of the
// agent: the table comes from disk at start and from serviceman when it says so, the link comes
// and goes with serviceman.
//
// table: {version, self, token, names: {host: rule}, services: {name: where}, peers: {machine:
// {addresses, port, token}}}, or null for a machine that was never told any.
// link: the state of the link that is up now, or null.
// seen: when each service of this machine last had a request from a door, {name: ms} — told to
// serviceman with the numbers, so a service in use is not stopped as idle.
const agent_doors_state = {table: null, link: null, seen: {}};

module.exports = agent_doors_state;
