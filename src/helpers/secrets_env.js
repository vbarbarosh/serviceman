const path = require('path');

// How a program finds `secrets` when it runs on the machine itself: the command is first on its
// PATH, and the file it reads is named. In a container both are mounted where the command
// already looks, so nothing has to be said.
function secrets_env(secrets)
{
    if ((secrets === null) || (secrets === undefined)) {
        return {};
    }
    return {
        PATH: `${path.dirname(secrets.script)}:${(process.env.PATH === undefined) ? '/usr/local/bin:/usr/bin:/bin' : process.env.PATH}`,
        SERVICEMAN_SECRETS: secrets.tsv,
    };
}

module.exports = secrets_env;
