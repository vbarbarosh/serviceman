const fs = require('fs');
const path = require('path');

const POWER_SUPPLY = '/sys/class/power_supply';

// How much is left in the laptop, and whether it is filling or emptying. A machine with no
// battery — a desktop, a server, a container — has nothing to say, and that is null.
function agent_battery()
{
    for (const name of names_read()) {
        const dir = path.join(POWER_SUPPLY, name);
        if (line_read(dir, 'type') !== 'Battery') {
            continue;
        }
        const percent = parseInt(line_read(dir, 'capacity'), 10);
        if (Number.isFinite(percent) === false) {
            continue;
        }
        return {percent, status: String(line_read(dir, 'status') || 'unknown').toLowerCase()};
    }
    return null;
}

function names_read()
{
    try {
        return fs.readdirSync(POWER_SUPPLY).sort();
    }
    catch {
        // not a linux box, or a linux box that knows nothing about power
        return [];
    }
}

function line_read(dir, name)
{
    try {
        return fs.readFileSync(path.join(dir, name), 'utf8').trim();
    }
    catch {
        return '';
    }
}

module.exports = agent_battery;
