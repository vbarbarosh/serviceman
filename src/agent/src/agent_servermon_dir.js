const path = require('path');

// Where servermon writes its day files: servermon/ in the agent's log folder. null where the
// agent keeps no log folder (SERVICEMAN_LOG_DIR unset or none): no servermon runs there.
function agent_servermon_dir()
{
    const log_dir = process.env.SERVICEMAN_LOG_DIR || '';
    if ((log_dir === '') || (log_dir === 'none')) {
        return null;
    }
    return path.join(path.resolve(log_dir), 'servermon');
}

module.exports = agent_servermon_dir;
