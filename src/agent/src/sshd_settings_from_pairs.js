// What sshd goes by, from its keywords (lowercase) and the value each holds, and the ports it
// listens on; OpenSSH's own defaults where nothing says: passwords and keyboard-interactive
// allowed, no PAM, root by key only, port 22. sshd -T before OpenSSH 8.7 names
// keyboard-interactive by its old name.
//
//     -> {installed, read, error, password, kbd_interactive, use_pam, root_login, ports}
function sshd_settings_from_pairs(pairs, ports, read)
{
    const kbd_interactive = pairs.has('kbdinteractiveauthentication') ? pairs.get('kbdinteractiveauthentication') : pairs.get('challengeresponseauthentication');
    return {
        installed: true,
        read,
        error: null,
        password: yes_of(pairs.get('passwordauthentication'), true),
        kbd_interactive: yes_of(kbd_interactive, true),
        use_pam: yes_of(pairs.get('usepam'), false),
        root_login: (pairs.get('permitrootlogin') || 'prohibit-password').split(/\s+/)[0].toLowerCase(),
        ports: (ports.length === 0) ? [22] : ports,
    };
}

function yes_of(value, fallback)
{
    return (value === undefined) ? fallback : (value.split(/\s+/)[0].toLowerCase() === 'yes');
}

module.exports = sshd_settings_from_pairs;
