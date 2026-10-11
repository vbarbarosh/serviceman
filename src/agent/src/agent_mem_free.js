const fs = require('fs');
const os = require('os');

const MEMINFO = '/proc/meminfo';

// Free memory as linux means it: the cache is free room, and os.freemem() does not say so
function agent_mem_free()
{
    try {
        const found = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync(MEMINFO, 'utf8'));
        if (found !== null) {
            return parseInt(found[1], 10)*1024;
        }
    }
    catch {
        // not a linux box
    }
    return os.freemem();
}

module.exports = agent_mem_free;
