const agent_services_dir = require('./agent_services_dir');
const path = require('path');
const program_line_argv = require('../../helpers/program_line_argv');
const secrets_env = require('../../helpers/secrets_env');
const shell_stream = require('../../helpers/shell_stream');

// One line of a program's life, run here. A folder written as a relative path is this
// machine's to place, and it places it under the agent's own services folder.
function agent_program_step(options, params, say)
{
    const cwd = path.resolve(agent_services_dir(), ((params.cwd === null) || (params.cwd === undefined)) ? '.' : params.cwd);
    return shell_stream(program_line_argv(params.line, cwd, params.image, params.env, options.docker, params.user, params.secrets), {
        cwd,
        env: Object.assign({}, process.env, secrets_env(params.secrets), params.env || {}),
    }, say);
}

module.exports = agent_program_step;
