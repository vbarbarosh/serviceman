const agent_metrics_dir = require('./agent_metrics_dir');
const agent_servermon_dir = require('./agent_servermon_dir');
const agent_uptime_count = require('./agent_uptime_count');
const agent_uptime_state = require('./agent_uptime_state');
const fs = require('fs');
const path = require('path');

// How often the lines servermon wrote since are counted. The env name is for a test that
// cannot wait a minute.
const COUNT_EVERY_MS = parseInt(process.env.SERVICEMAN_UPTIME_MS || '60000', 10);

// The machine's uptime, counted from servermon's day files: a second with a line is a second the
// machine was up. Counted when the agent starts and every minute (agent_uptime_count), kept in
// uptime.json beside the charts, longer than servermon keeps its days; agent_uptime_of says it
// by day. A machine whose agent keeps no log folder has no servermon, and no uptime.
function agent_uptime(group)
{
    if (agent_servermon_dir() === null) {
        return;
    }
    state_load();
    agent_uptime_count(group);
    // The clock never keeps the agent up by itself: --once ends with its link
    const clock = setInterval(function () {
        agent_uptime_count(group);
    }, COUNT_EVERY_MS);
    clock.unref();
}

// The count an agent before this one left; a missing or broken file starts it again
function state_load()
{
    let kept;
    try {
        kept = JSON.parse(fs.readFileSync(path.join(agent_metrics_dir(), 'uptime.json'), 'utf8'));
    }
    catch {
        return;
    }
    if ((kept === null) || (typeof kept !== 'object') || (Array.isArray(kept.down) === false)) {
        return;
    }
    for (const key of Object.keys(agent_uptime_state)) {
        if (kept[key] !== undefined) {
            agent_uptime_state[key] = kept[key];
        }
    }
}

module.exports = agent_uptime;
