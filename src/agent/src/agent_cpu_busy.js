const agent_cpu_times = require('./agent_cpu_times');
const timers = require('timers/promises');

// A first reading has nothing before it to compare with: it is taken over this much time
const FIRST_WINDOW_MS = 250;

const last = {sample: null};

// How busy the cores were, 0 to 1, since the last time it was asked — the share of their time
// not spent idle, which is what top and htop call cpu use. The load average is not that: it
// counts what waits on disk and network too, and runs past 1 per core on a machine at half use.
async function agent_cpu_busy()
{
    if (last.sample === null) {
        last.sample = agent_cpu_times();
        await timers.setTimeout(FIRST_WINDOW_MS);
    }
    const before = last.sample;
    const now = agent_cpu_times();
    last.sample = now;
    const total = now.total - before.total;
    if (total <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, 1 - (now.idle - before.idle)/total));
}

module.exports = agent_cpu_busy;
