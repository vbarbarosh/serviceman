const agent_dir = require('./agent_dir');
const agent_services_dir = require('./agent_services_dir');
const fs = require('fs');
const path = require('path');
const program_docker_argv = require('../../helpers/program_docker_argv');
const shell_stream = require('../../helpers/shell_stream');

// Starts the container a shell service runs in. The host knows the service; this end knows
// where its folder is, and a bind mount is a path on the machine that runs docker.
function agent_program_docker_start(options, params, say)
{
    const dir = path.resolve(agent_services_dir(), params.cwd);
    // What it keeps has to be there before the container is, or docker makes it as root
    for (const volume of ((params.volumes === undefined) ? [] : params.volumes)) {
        if (volume.kind === 'kept') {
            fs.mkdirSync(path.join(agent_dir(), 'data', volume.keep), {recursive: true});
        }
    }
    return shell_stream([options.docker].concat(program_docker_argv(Object.assign({}, params, {dir, keep_root: agent_dir()}))), {}, say);
}

module.exports = agent_program_docker_start;
