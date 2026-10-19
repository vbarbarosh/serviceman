// How far servermon's day files are counted, and the stretches with no line in them: one object
// for the life of the agent, read from uptime.json when it starts and written back after every
// count (agent_uptime).
//
//     file       the day file counted last, 20261019.jsonl
//     offset     the bytes of it counted: its next line starts there
//     first_at   servermon's first line ever counted: the time before it is not known
//     last_at    the last line counted, and the boot time it said
//     last_boot
//     down       the stretches with no line, {from, to, why}, oldest first; why is reboot (the
//                line after says another boot), stopped (the same boot: servermon stopped or
//                the machine slept) or null (lines from before servermon said its boot)
const agent_uptime_state = {file: null, offset: 0, first_at: null, last_at: null, last_boot: null, down: []};

module.exports = agent_uptime_state;
