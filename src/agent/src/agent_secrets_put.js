const agent_dir = require('./agent_dir');
const path = require('path');
const secrets_files_write = require('../../helpers/secrets_files_write');

// The host hands down the secrets one service may see. They land in the agent's own folder,
// readable by nobody else, and go away with the folder when the agent does.
function agent_secrets_put(params)
{
    return secrets_files_write(path.join(agent_dir(), 'secrets'), params.service, params.secrets || {});
}

module.exports = agent_secrets_put;
