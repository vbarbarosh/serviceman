const path = require('path');

// SERVICEMAN_STATE_DIR holds what serviceman writes down about itself — the programs it
// started, and nothing a person edits. The default is data/ next to the config; a serviceman
// in a container keeps it on a volume of its own instead, away from the repo it reads.
function state_dir_from_env(env, base_dir)
{
    return path.resolve(base_dir, env.SERVICEMAN_STATE_DIR || 'data');
}

module.exports = state_dir_from_env;
