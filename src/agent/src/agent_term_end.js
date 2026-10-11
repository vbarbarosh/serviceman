const agent_term_read = require('./agent_term_read');
const term_name_valid = require('../../helpers/term_name_valid');

// Ends the terminal `name`: its holder hangs the shell up, as closing a terminal window does,
// and goes with it. A name that is not running is already ended.
async function agent_term_end(params)
{
    if (term_name_valid(params.name) === false) {
        throw new Error(`not a terminal name: ${JSON.stringify(params.name)}`);
    }
    const found = agent_term_read(params.name);
    if (found !== null) {
        process.kill(found.pid, 'SIGTERM');
    }
    return {ended: (found !== null)};
}

module.exports = agent_term_end;
