const fs = require('fs');
const path = require('path');

const THERMAL = '/sys/class/thermal';
const HOTTEST_SANE_C = 150;

// How hot the machine is running, as the hottest zone the kernel names — a laptop with a fan
// against the desk says so here. A machine that measures nothing has nothing to say.
function agent_temperature()
{
    let out = null;
    for (const name of names_read()) {
        if (name.startsWith('thermal_zone') === false) {
            continue;
        }
        const dir = path.join(THERMAL, name);
        // The kernel writes thousandths of a degree
        const c = Math.round(parseInt(line_read(dir, 'temp'), 10)/1000);
        if ((Number.isFinite(c) === false) || (c <= 0) || (c > HOTTEST_SANE_C)) {
            continue;
        }
        if ((out === null) || (c > out.c)) {
            out = {c, of: line_read(dir, 'type') || name};
        }
    }
    return out;
}

function names_read()
{
    try {
        return fs.readdirSync(THERMAL).sort();
    }
    catch {
        // not a linux box, or one that measures nothing
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

module.exports = agent_temperature;
