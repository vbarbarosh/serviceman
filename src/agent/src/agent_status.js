const format_duration_ms = require('../../helpers/format_duration_ms');

// What the agent is doing, as a page somebody can read on the machine itself. It says the same
// things the host's page says about this machine, for the times when the host is exactly what
// cannot be reached.
function agent_status(status, at)
{
    const now = (at === undefined) ? Date.now() : at;
    const lines = [
        `serviceman-agent ${status.agent}${(status.built === null) ? '' : ` built ${status.built}`}`,
        `pid ${status.pid}, up ${format_duration_ms(now - status.started_at)}`,
        `machine ${status.machine}`,
        `host ${status.url}`,
        link_text(status, now),
        root_text(status),
        servermon_text(status),
    ];
    const keys = Object.keys(status.programs);
    lines.push((keys.length === 0) ? 'programs none' : 'programs');
    for (const key of keys) {
        const program = status.programs[key];
        lines.push(`  ${key} pid ${program.pid} ${program.cwd}`);
    }
    if (status.error !== null) {
        lines.push(`last error ${status.error}`);
    }
    lines.push(`asked ${new Date(now).toISOString()}`);
    return `${lines.join('\n')}\n`;
}

// Whether the machine has a root half, and where it answers. Asked at the same time as
// everything else here, so it is what is true now — a root agent installed a minute ago shows
// up without this one being restarted.
function root_text(status)
{
    if (status.root === true) {
        return `root answers at ${status.root_socket}`;
    }
    return `root none — nothing answers at ${status.root_socket}`;
}

function servermon_text(status)
{
    const servermon = status.servermon;
    if ((servermon === null) || (servermon === undefined) || (servermon.state === 'off')) {
        return 'servermon off — the agent keeps no log folder (SERVICEMAN_LOG_DIR)';
    }
    if (servermon.state === 'failed') {
        return `servermon not running — ${servermon.error}`;
    }
    return `servermon pid ${servermon.pid}, a line a second into ${servermon.dir}`;
}

function link_text(status, now)
{
    if (status.phase === 'online') {
        return `link online as remote ${status.remote}, for ${format_duration_ms(now - status.since)}`;
    }
    if (status.phase === 'dialling') {
        return `link dialling since ${new Date(status.since).toISOString()}`;
    }
    return `link ${status.phase}`;
}

module.exports = agent_status;
