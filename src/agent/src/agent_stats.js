const agent_can = require('./agent_can');
const agent_doors_state = require('./agent_doors_state');
const agent_http_serve = require('./agent_http_serve');
const agent_logline_status = require('./agent_logline_status');
const agent_servermon_dir = require('./agent_servermon_dir');
const agent_servermon_lines = require('./agent_servermon_lines');
const agent_updates = require('./agent_updates');
const agent_uptime_of = require('./agent_uptime_of');
const agent_uptime_state = require('./agent_uptime_state');
const os = require('os');
const path = require('path');

// servermon writes a line a second: a last line older than this is a servermon that stopped
const SILENT_MS = 5000;

// The numbers that move: what the machine carries right now — and what it can be asked for,
// which moves too: a machine gains a root half without its agent restarting
async function agent_stats(options)
{
    const lines = agent_servermon_lines();
    const last = (lines.length === 0) ? null : lines[lines.length - 1];
    // The machine's numbers are servermon's last line, read here and never measured here: null
    // while servermon is off or silent, and `servermon` says which
    const now = ((last !== null) && ((Date.now() - last.at) <= SILENT_MS)) ? last : null;
    return {
        at: Date.now(),
        can: await agent_can(options),
        uptime_ms: Math.round(os.uptime()*1000),
        servermon: servermon_said(last, now),
        // The last 30 days as of the last count, for a column of the machines' table: how long
        // was known and how long of it the machine was down. null before servermon's first line.
        uptime_30d: uptime_30d_of(),
        load: (now === null) ? null : now.load,
        // How busy its cores were over servermon's last second, 0 to 1
        cpu_busy: ((now === null) || (now.cpu === null)) ? null : now.cpu/100,
        mem_free: (now === null) ? null : now.mem_total - now.mem_used,
        disk_free: (now === null) ? null : disk_free_of(now.mounts, options.dir),
        // All of its disks together, for a line that says how full the machine is
        disks: (now === null) ? null : disks_of(now.mounts),
        battery: ((now === null) || (now.battery === undefined)) ? null : now.battery,
        // The way in, as its file says it stands right now
        door: agent_http_serve.door(),
        temperature: ((now === null) || (now.temperature === undefined)) ? null : now.temperature,
        updates: await agent_updates(options),
        // How its lines to Logline are going
        logline: agent_logline_status(),
        // How long ago each service of this machine last had a request through a door, in this
        // machine's own time: serviceman counts it as the service being in use
        doors_seen: doors_seen_ago(),
    };
}

function uptime_30d_of()
{
    if (agent_uptime_state.last_at === null) {
        return null;
    }
    const days = agent_uptime_of(30, agent_uptime_state.last_at).days;
    return {known_ms: days.reduce((sum, v) => sum + v.known_ms, 0), down_ms: days.reduce((sum, v) => sum + v.down_ms, 0)};
}

// running, off (the agent keeps no log folder) or silent, with the time of its last line
function servermon_said(last, now)
{
    if (agent_servermon_dir() === null) {
        return {state: 'off', last_at: null};
    }
    if (now === null) {
        return {state: 'silent', last_at: (last === null) ? null : last.time};
    }
    return {state: 'running', last_at: now.time};
}

// Free room on the disk the folder is on: the longest of servermon's mount paths it is under
function disk_free_of(mounts, dir)
{
    const target = path.resolve(dir);
    let found = null;
    for (const mount of mounts) {
        const under = (mount.path === '/') || (target === mount.path) || target.startsWith(`${mount.path}/`);
        if (under && ((found === null) || (mount.path.length > found.path.length))) {
            found = mount;
        }
    }
    return (found === null) ? null : found.size - found.used;
}

function disks_of(mounts)
{
    let total = 0;
    let used = 0;
    for (const mount of mounts) {
        total += mount.size;
        used += mount.used;
    }
    return {count: mounts.length, total, used};
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
