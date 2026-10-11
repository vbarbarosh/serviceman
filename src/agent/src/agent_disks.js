const agent_disk = require('./agent_disk');
const agent_shell = require('./agent_shell');
const disk_list_from_df = require('./disk_list_from_df');

// Every disk of the machine taken together: the room used over the room there is, counted
// the way the Disks tab counts them. A machine that shows no disk of its own, a container
// above all, is the one filesystem the agent lives on.
async function agent_disks(dir)
{
    const answer = await agent_shell(['df', '-PkT']);
    const disks = (answer.ok ? disk_list_from_df(answer.stdout, '').filter(v => v.disk) : []);
    if (disks.length > 0) {
        let total = 0;
        let used = 0;
        for (const item of disks) {
            total += item.total;
            used += item.used;
        }
        return {count: disks.length, total, used};
    }
    const disk = await agent_disk(dir);
    if (disk.total === null) {
        return null;
    }
    return {count: 1, total: disk.total, used: disk.total - disk.free};
}

module.exports = agent_disks;
