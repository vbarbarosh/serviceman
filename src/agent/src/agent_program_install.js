const agent_services_dir = require('./agent_services_dir');
const path = require('path');
const program_install_here = require('../../helpers/program_install_here');

// The host asks this before it asks for the program to run. A folder written as a relative
// path is this machine's to place, and it places it under the agent's own services folder.
function agent_program_install(options, params, say)
{
    return program_install_here(path.resolve(agent_services_dir(), params.cwd), params.install, params.update, params.mark, params.env, params.look, params.made, params.image, options.docker, params.user, say, params.secrets, params.force);
}

module.exports = agent_program_install;
