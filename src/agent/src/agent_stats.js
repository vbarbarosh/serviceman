const agent_battery = require('./agent_battery');
const agent_can = require('./agent_can');
const agent_cpu_busy = require('./agent_cpu_busy');
const agent_disk = require('./agent_disk');
const agent_disks = require('./agent_disks');
const agent_doors_state = require('./agent_doors_state');
const agent_http_serve = require('./agent_http_serve');
const agent_logline_status = require('./agent_logline_status');
const agent_mem_free = require('./agent_mem_free');
const agent_temperature = require('./agent_temperature');
const agent_updates = require('./agent_updates');
const os = require('os');

// The numbers that move: what the machine carries right now — and what it can be asked for,
// which moves too: a machine gains a root half without its agent restarting
async function agent_stats(options)
{
    const disk = await agent_disk(options.dir);
    return {
        at: Date.now(),
        can: await agent_can(options),
        uptime_ms: Math.round(os.uptime()*1000),
        load: os.loadavg()[0],
        // How busy its cores were since the last beat, 0 to 1
        cpu_busy: await agent_cpu_busy(),
        mem_free: agent_mem_free(),
        disk_free: disk.free,
        // All of its disks together, for a line that says how full the machine is
        disks: await agent_disks(options.dir),
        battery: agent_battery(),
        // The way in, as its file says it stands right now
        door: agent_http_serve.door(),
        temperature: agent_temperature(),
        updates: await agent_updates(options),
        // How its lines to Logline are going
        logline: agent_logline_status(),
        // How long ago each service of this machine last had a request through a door, in this
        // machine's own time: serviceman counts it as the service being in use
        doors_seen: doors_seen_ago(),
    };
}

function doors_seen_ago()
{
    const out = {};
    const now = Date.now();
    for (const name of Object.keys(agent_doors_state.seen)) {
        out[name] = now - agent_doors_state.seen[name];
    }
    return out;
}

module.exports = agent_stats;
