const agent_signed = require('../../helpers/agent_signed');
const fs = require('fs');

// Whether a file on disk is the host's: for bin/update, which asks the agent already here
// before it puts the new one in its place. The signature is a file beside it, the key one line.
function agent_verify_file(file, signature_file, key_line)
{
    try {
        return agent_signed(fs.readFileSync(file, 'utf8'), fs.readFileSync(signature_file, 'utf8').trim(), key_line);
    }
    catch {
        return false;
    }
}

module.exports = agent_verify_file;
