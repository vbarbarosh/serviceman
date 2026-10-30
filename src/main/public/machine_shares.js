// How full a machine is, each a share between 0 and 1, or null where it says no number: how
// busy its cores are, how much of its memory is taken, and how much of the disk it lives on.
// Its Overview's tiles and its row in the rail read the same.
function machine_shares(machine)
{
    const mem = machine.mem;
    const disk = machine.disk;
    return {
        cpu: ((machine.cpu_busy === null) || (machine.cpu_busy === undefined)) ? null : machine.cpu_busy,
        memory: ((mem.free === null) || (mem.total > 0) === false) ? null : 1 - mem.free/mem.total,
        disk: ((disk.free === null) || (disk.total > 0) === false) ? null : 1 - disk.free/disk.total,
    };
}

export default machine_shares;
