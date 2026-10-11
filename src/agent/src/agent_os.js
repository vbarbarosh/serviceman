const fs = require('fs');

const OS_RELEASE = '/etc/os-release';

// The name a person calls this system — "Ubuntu 24.04.2 LTS" — as os-release says it
function agent_os()
{
    try {
        const found = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(fs.readFileSync(OS_RELEASE, 'utf8'));
        if ((found !== null) && (found[1] !== '')) {
            return found[1];
        }
    }
    catch {
        // not a linux box
    }
    return null;
}

module.exports = agent_os;
