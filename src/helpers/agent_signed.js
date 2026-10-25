const crypto = require('crypto');

// Whether an agent file is the host's own: its signature, made with the host's key when it was
// served, checked against the public key this machine was given when the agent was installed.
// The key travels as one line, the PEM in base64, since an env file holds lines.
function agent_signed(text, signature, key_line)
{
    try {
        const key = crypto.createPublicKey(Buffer.from(String(key_line), 'base64').toString('utf8'));
        return crypto.verify(null, Buffer.from(String(text), 'utf8'), key, Buffer.from(String(signature), 'base64'));
    }
    catch {
        return false;
    }
}

module.exports = agent_signed;
