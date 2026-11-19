import clock_of from './clock_of.js';
import machine_icons from './machine_icons.js';
import size_words from './size_words.js';

// The share of memory used past which a machine's meter is orange
const MEMORY_LOW = 0.85;

// A machine as a step's tile draws it, from its remote in the status, how the Canvas draws it
// (server, laptop, home) and how many services it runs: {value, title, icon, dot, lines,
// meter, away}. lines are what it is and its services, or its free disk for a step that keeps
// files there (disk true), then its free memory of all, or since when it is offline; meter is
// the share of memory used, 0 to 1, and whether it runs low, or null when the agent has not said
function machine_card(remote, kind, count, disk)
{
    const machine = ((remote.machine === undefined) || (remote.machine === null)) ? null : remote.machine;
    const online = (remote.phase === 'online');
    const disk_free = ((disk === true) && (machine !== null) && (machine.disk !== undefined) && (machine.disk.free !== null)) ? machine.disk.free : null;
    const services = (count === 1) ? '1 service' : `${count} services`;
    const lines = [[(remote.title && (remote.title !== remote.name)) ? remote.title : '', (disk_free === null) ? services : `${size_words(disk_free)} disk free`].filter(v => v !== '').join(' · ')];
    let meter = null;
    if (online === false) {
        lines.push(((remote.left_at === null) || (remote.left_at === undefined)) ? 'not connected yet' : `offline since ${clock_of(remote.left_at)}`);
    }
    else if ((machine !== null) && (machine.mem !== undefined) && (machine.mem.free !== null) && (machine.mem.total > 0)) {
        lines.push(`${size_words(machine.mem.free)} of ${size_words(machine.mem.total)} free`);
        const used = 1 - (machine.mem.free/machine.mem.total);
        meter = {used: Math.min(1, Math.max(0, used)), low: (used > MEMORY_LOW)};
    }
    return {value: remote.name, title: remote.name, icon: machine_icons[kind] || machine_icons.server, dot: online ? 'on' : 'off', lines, meter, away: (online === false)};
}

export default machine_card;
