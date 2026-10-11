const fs = require('fs');
const path = require('path');

const FILE_MODE = 0o600;
const SCRIPT_MODE = 0o755;
const SCRIPT_NAME = 'secrets';

// `secrets <name>`, as a shell script, because that is how a program asks for one: it runs a
// command and reads what it prints. sh and awk are in every image worth running.
const SCRIPT = `#!/bin/sh
# secrets <name> — prints the secret of that name, or nothing and 1 when there is none.
# Written by serviceman. The file it reads is only readable by whoever runs this.

set -eu

file=\${SERVICEMAN_SECRETS:-/run/serviceman/secrets.tsv}

line=$(awk -F '\\t' -v want="$1" '$1 == want { print $2; found = 1; exit } END { exit !found }' "$file")
printf '%b\\n' "$line"
`;

// The secrets one service may see, on the machine that runs it: one file it can read, and one
// command that reads it. Both are written fresh every time, so a secret that changed is the
// one the next start uses, and a secret taken away is gone from the machine as well.
function secrets_files_write(dir, service, secrets)
{
    fs.mkdirSync(dir, {recursive: true});
    const script = path.join(dir, SCRIPT_NAME);
    fs.writeFileSync(script, SCRIPT, {mode: SCRIPT_MODE});
    fs.chmodSync(script, SCRIPT_MODE);
    const tsv = path.join(dir, `${service}.tsv`);
    const lines = [];
    for (const name of Object.keys(secrets)) {
        // One line each, whatever the value is: a newline in a secret is a newline in the file
        // otherwise, and the next name would be read as part of the last value
        lines.push(`${name}\t${String(secrets[name]).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}`);
    }
    fs.writeFileSync(tsv, `${lines.join('\n')}\n`, {mode: FILE_MODE});
    fs.chmodSync(tsv, FILE_MODE);
    return {tsv, script};
}

module.exports = secrets_files_write;
