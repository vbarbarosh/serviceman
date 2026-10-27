const net = require('net');

// The lines of sshd's journal that are a sign-in refused, each once: a wrong password, a user
// the machine does not have, and a client that offered what was not taken (a key, nothing)
// and left. sshd says "Disconnected from authenticating user" for the same one as the last,
// and "Connection closed by invalid user" for the same one as the second: neither is counted.
const COUNTED = [
    /^Failed password for .* from (\S+) port \d+/,
    /^Invalid user .* from (\S+)(?: port \d+)?\s*$/,
    /^Connection closed by authenticating user \S+ (\S+) port \d+/,
];

// The address a refused sign-in came from, for one line of sshd's journal as `journalctl -o
// cat` gives it: '' for one that names no address it can read, null for a line that is not a
// refused sign-in
function sign_in_failure_address(line)
{
    for (const re of COUNTED) {
        const found = re.exec(line.trim());
        if (found !== null) {
            return (net.isIP(found[1]) === 0) ? '' : found[1];
        }
    }
    return null;
}

module.exports = sign_in_failure_address;
