const fs = require('fs');

const DISKSTATS = '/proc/diskstats';
const SYS_BLOCK = '/sys/block';
// The kernel counts in sectors of 512 bytes, whatever the disk's own sector is
const SECTOR_BYTES = 512;

// The bytes read from the machine's disks and written to them since it booted. Whole disks
// only: a partition, a dm or an md device would count the same bytes again; loop and ram
// devices are not disks. null off linux.
function agent_disk_bytes()
{
    let text;
    try {
        text = fs.readFileSync(DISKSTATS, 'utf8');
    }
    catch {
        return null;
    }
    const out = {read: 0, written: 0};
    for (const line of text.split('\n')) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10) {
            continue;
        }
        const name = fields[2];
        if (fs.existsSync(`${SYS_BLOCK}/${name}/device`) === false) {
            continue;
        }
        out.read += parseInt(fields[5], 10)*SECTOR_BYTES;
        out.written += parseInt(fields[9], 10)*SECTOR_BYTES;
    }
    return out;
}

module.exports = agent_disk_bytes;
