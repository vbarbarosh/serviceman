import machine_shares from './machine_shares.js';

// A machine's CPU, Memory and Disk as a head's facts, each with its bar: the whole machine's,
// not one program's; none it says no number for, and none while it is away
//
//     remote    a remote of the status: {phase, machine: {cpu_busy, mem, disk}}
//     ->        [{label: 'Memory', value: '66%', small: '41 of 62 GB', share: 0.66}, …]
function machine_facts(remote)
{
    if ((remote === null) || (remote === undefined) || (remote.phase !== 'online') || (remote.machine === null) || (remote.machine === undefined)) {
        return [];
    }
    const shares = machine_shares(remote.machine);
    const mem = remote.machine.mem;
    const out = [];
    if (shares.cpu !== null) {
        out.push({label: 'CPU', value: percent(shares.cpu), small: '', share: shares.cpu});
    }
    if (shares.memory !== null) {
        out.push({label: 'Memory', value: percent(shares.memory), small: `${gb(mem.total - mem.free)} of ${gb(mem.total)} GB`, share: shares.memory});
    }
    if (shares.disk !== null) {
        out.push({label: 'Disk', value: percent(shares.disk), small: '', share: shares.disk});
    }
    return out;
}

function percent(share)
{
    return `${Math.round(share*100)}%`;
}

// Gigabytes, whole from ten up and with no ".0": 41, 8, 6.2
function gb(bytes)
{
    const n = bytes/(1024*1024*1024);
    return (n >= 10) ? String(Math.round(n)) : String(Number(n.toFixed(1)));
}

export default machine_facts;
