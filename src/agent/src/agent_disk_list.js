const agent_shell = require('./agent_shell');
const argv_line = require('../../helpers/argv_line');
const disk_list_from_df = require('./disk_list_from_df');

const SPACE_ARGV = ['df', '-PkT'];
const INODES_ARGV = ['df', '-PiT'];

// Every filesystem this machine has mounted: how much room each has, and how many files it
// may still hold — a disk can be full of inodes with space to spare, and then nothing new
// can be written to it at all
//
// df ends with 1 when a single mount cannot be read — an sshfs whose program died says "Transport
// endpoint is not connected" — though it printed every other one: those are the answer, and the
// one it could not read is left out, never the whole list
async function agent_disk_list()
{
    const space = await agent_shell(SPACE_ARGV);
    if ((space.ok === false) && (space.stdout.split('\n').length < 2)) {
        throw new Error(`df: ${space.stderr}`);
    }
    // A df that cannot count inodes still says how much room there is; one that could not read a
    // single mount counted all the others
    const inodes = await agent_shell(INODES_ARGV);
    const counted = (inodes.stdout.split('\n').length > 1) ? inodes.stdout : '';
    return {at: Date.now(), items: disk_list_from_df(space.stdout, counted), commands: [argv_line(SPACE_ARGV), argv_line(INODES_ARGV)]};
}

module.exports = agent_disk_list;
