const os = require('os');

// Every core's times added up: all of them, and the idle ones. Two of these, taken apart in
// time, say how busy the cores were between them.
function agent_cpu_times()
{
    let total = 0;
    let idle = 0;
    for (const cpu of os.cpus()) {
        const times = cpu.times;
        total += times.user + times.nice + times.sys + times.idle + times.irq;
        idle += times.idle;
    }
    return {total, idle};
}

module.exports = agent_cpu_times;
