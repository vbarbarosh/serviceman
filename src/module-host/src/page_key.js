const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The key this computer's page is opened with. module-host runs a shell, the files and docker
// as the user who started it, and 127.0.0.1 is every user's of this computer: the key is what
// tells that user's browser from another's. It is kept in the agent's folder, readable by that
// user alone, so the address module-host printed opens it again after a restart.
let kept = null;

function page_key()
{
    if (kept === null) {
        const file = path.join(process.env.SERVICEMAN_AGENT_DIR, 'page.key');
        if (fs.existsSync(file) === false) {
            fs.writeFileSync(file, `${crypto.randomBytes(24).toString('hex')}\n`, {mode: 0o600, flag: 'wx'});
        }
        kept = fs.readFileSync(file, 'utf8').trim();
    }
    return kept;
}

module.exports = page_key;
