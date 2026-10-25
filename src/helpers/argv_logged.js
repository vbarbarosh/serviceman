// A command line as the log may hold it: a value handed over as an environment variable,
// `--env NAME=value`, `--env=NAME=value` or `-e NAME=value`, is a secret as often as not, and
// the log keeps the name and drops the value
const ENV_FLAGS = ['--env', '-e'];

function argv_logged(argv)
{
    const out = [];
    let masking = false;
    for (const word of argv) {
        if (masking) {
            out.push(pair_masked(word));
            masking = false;
            continue;
        }
        if (ENV_FLAGS.includes(word)) {
            out.push(word);
            masking = true;
            continue;
        }
        if (word.startsWith('--env=')) {
            out.push(`--env=${pair_masked(word.slice('--env='.length))}`);
            continue;
        }
        out.push(word);
    }
    return out;
}

// NAME=value as NAME=***; a bare NAME, which takes the value from the environment, stays
function pair_masked(pair)
{
    const at = pair.indexOf('=');
    return (at === -1) ? pair : `${pair.slice(0, at)}=***`;
}

module.exports = argv_logged;
