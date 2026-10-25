const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = 'agent_sign.key';
const FILE_MODE = 0o600;

// The key the host signs the agent file with: made once, kept in the state dir for the host
// alone, and its public half given to every machine at install (SERVICEMAN_HOST_KEY), so an
// update over the link is taken only from this host. Read once and kept on the app.
//
//     {private_key, public_line}
//     private_key  a KeyObject, to sign with
//     public_line  the public key as one line, the PEM in base64, as the env file holds it
function agent_sign_key(app)
{
    if (app.agent_sign_key !== undefined) {
        return app.agent_sign_key;
    }
    const file = path.join(app.state_dir, FILE);
    let pem;
    try {
        pem = fs.readFileSync(file, 'utf8');
    }
    catch {
        pem = crypto.generateKeyPairSync('ed25519').privateKey.export({type: 'pkcs8', format: 'pem'});
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, pem, {mode: FILE_MODE});
        fs.chmodSync(file, FILE_MODE);
    }
    const private_key = crypto.createPrivateKey(pem);
    const public_pem = crypto.createPublicKey(private_key).export({type: 'spki', format: 'pem'});
    app.agent_sign_key = {private_key, public_line: Buffer.from(public_pem, 'utf8').toString('base64')};
    return app.agent_sign_key;
}

module.exports = agent_sign_key;
