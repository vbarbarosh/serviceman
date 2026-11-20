import clock_of from './clock_of.js';
import machine_shares from './machine_shares.js';

// A machine's CPU, Memory and Disk as its head's facts: online, each with its bar, Memory and
// Disk said out of how much; away, the last numbers serviceman has, dim and with no bar, CPU
// with when it said it. None while it never said a number.
//
//     view      a remote of the status: {phase, left_at, machine: {cpu_busy, mem, disk}}
//     ->        [{label: 'Memory', value: '35%', small: 'of 8 GB', share: 0.35, dim: false}, …]
function remote_facts(view)
{
    const machine = view.machine;
    if ((machine === null) || (machine === undefined)) {
        return [];
    }
    const online = (view.phase === 'online');
    const shares = machine_shares(machine);
    const mem = machine.mem;
    const disk = machine.disk;
    const at = ((online === false) && (view.left_at !== null)) ? `at ${clock_of(view.left_at)}` : '';
    const title = online ? 'the whole machine, now' : 'the last it said, before it went away';
    return [
        {label: 'CPU', value: percent(shares.cpu), small: online ? '' : at, share: shares.cpu, dim: (online === false), title},
        {label: 'Memory', value: percent(shares.memory), small: (mem.total > 0) ? (online ? `of ${size_short(mem.total)}` : part_of(mem.total - mem.free, mem.total)) : '', share: shares.memory, dim: (online === false), title},
        {label: 'Disk', value: percent(shares.disk), small: (disk.total > 0) ? `of ${size_short(disk.total)}` : '', share: shares.disk, dim: (online === false), title},
    ];
}

// A share as a head says it, — for one not said
function percent(share)
{
    return (share === null) ? '—' : `${Math.round(share*100)}%`;
}

// A size in a few characters: "2 TB", "160 GB", "8 GB", "6.2 GB", "512 MB"
function size_short(bytes)
{
    const gb = bytes/(1024*1024*1024);
    if (gb >= 1024) {
        return `${Number((gb/1024).toFixed((gb >= 10240) ? 0 : 1))} TB`;
    }
    if (gb >= 1) {
        return `${Number(gb.toFixed((gb >= 10) ? 0 : 1))} GB`;
    }
    return `${Math.round(bytes/(1024*1024))} MB`;
}

// A part of a whole in one unit where both share it: "21 of 64 GB", "512 MB of 8 GB"
function part_of(part, whole)
{
    const a = size_short(part);
    const b = size_short(whole);
    const unit = / [A-Z]+$/;
    return (a.match(unit)[0] === b.match(unit)[0]) ? `${a.replace(unit, '')} of ${b}` : `${a} of ${b}`;
}

export default remote_facts;
