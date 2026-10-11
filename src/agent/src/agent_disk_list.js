const agent_shell = require('./agent_shell');
const argv_line = require('../../helpers/argv_line');
const disk_list_from_df = require('./disk_list_from_df');

const SPACE_ARGV = ['df', '-PkT'];
const INODES_ARGV = ['df', '-PiT'];

// Every filesystem this machine has mounted: how much room each has, and how many files it
// may still hold — a disk can be full of inodes with space to spare, and then nothing new
// can be written to it at all
async function agent_disk_list()
{
    const space = await agent_shell(SPACE_ARGV);
    if (space.ok === false) {
        throw new Error(`df: ${space.stderr}`);
    }
    // A df that cannot count inodes still says how much room there is
    const inodes = await agent_shell(INODES_ARGV);
    return {at: Date.now(), items: disk_list_from_df(space.stdout, inodes.ok ? inodes.stdout : ''), commands: [argv_line(SPACE_ARGV), argv_line(INODES_ARGV)]};
}

module.exports = agent_disk_list;
