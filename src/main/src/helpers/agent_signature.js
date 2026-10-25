const agent_sign_key = require('./agent_sign_key');
const crypto = require('crypto');

// The signature of an agent file, as base64: what a machine checks before it runs the file
function agent_signature(app, text)
{
    return crypto.sign(null, Buffer.from(text, 'utf8'), agent_sign_key(app).private_key).toString('base64');
}

module.exports = agent_signature;
