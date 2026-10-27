const sshd_settings_from_pairs = require('./sshd_settings_from_pairs');

// What sshd goes by, as `sshd -T` says it: the configuration it would run with, its files and
// their Includes already read, one keyword a line in lowercase; Port once for every port.
//
//     -> {installed, read: 'sshd -T', error, password, kbd_interactive, use_pam, root_login, ports}
function sshd_config_from_dump(text)
{
    const pairs = new Map();
    const ports = [];
    for (const line of text.split('\n')) {
        const found = /^(\S+)\s+(.*)$/.exec(line.trim());
        if (found === null) {
            continue;
        }
        const key = found[1].toLowerCase();
        if (key === 'port') {
            ports.push(parseInt(found[2], 10));
        }
        else if (pairs.has(key) === false) {
            pairs.set(key, found[2].trim());
        }
    }
    return sshd_settings_from_pairs(pairs, ports.filter(Number.isInteger), 'sshd -T');
}

module.exports = sshd_config_from_dump;
