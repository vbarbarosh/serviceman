const path = require('path');

// SERVICEMAN_LOG_DIR picks the folder of the daily log files; "none" writes no files;
// the default is data/logs next to the config
function file_log_from_env(env, base_dir)
{
    const text = env.SERVICEMAN_LOG_DIR || 'data/logs';
    if (text === 'none') {
        return null;
    }
    return {dir: path.resolve(base_dir, text), day: null, stream: null, dead: false};
}

module.exports = file_log_from_env;
