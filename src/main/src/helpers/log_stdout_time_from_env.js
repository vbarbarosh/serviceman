// SERVICEMAN_LOG_TIME=off leaves the time off stdout, for a runtime that stamps every line
// itself — docker, journald. The file always keeps it: nothing else there says when.
function log_stdout_time_from_env(env)
{
    return env.SERVICEMAN_LOG_TIME !== 'off';
}

module.exports = log_stdout_time_from_env;
