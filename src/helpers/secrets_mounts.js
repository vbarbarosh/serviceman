const INSIDE_FILE = '/run/serviceman/secrets.tsv';
const INSIDE_COMMAND = '/usr/local/bin/secrets';

// What a container needs to answer `secrets <name>`: the file, and the command that reads it.
// Both read-only, because nothing in there has any business writing either.
function secrets_mounts(secrets)
{
    if ((secrets === null) || (secrets === undefined)) {
        return [];
    }
    return [
        '--volume', `${secrets.tsv}:${INSIDE_FILE}:ro`,
        '--volume', `${secrets.script}:${INSIDE_COMMAND}:ro`,
    ];
}

module.exports = secrets_mounts;
