// How sshd let someone in: a key, or a password (keyboard-interactive is a password PAM asks
// for); anything else (gssapi, hostbased) is neither
const BY = {publickey: 'key', password: 'password', 'keyboard-interactive': 'password', 'keyboard-interactive/pam': 'password'};
const ACCEPTED = /^Accepted (\S+) for (\S+) from \S+ port \d+/;

// A sign-in sshd took, for one line of its journal as `journalctl -o cat` gives it: who, and
// how; null for a line that is not one
//
//     -> {user, by: 'key' | 'password' | 'other'} or null
function sign_in_accepted(line)
{
    const found = ACCEPTED.exec(line.trim());
    if (found === null) {
        return null;
    }
    return {user: found[2], by: BY[found[1]] || 'other'};
}

// Who signed in over the days read, and how many times by each way, most first: what turning
// passwords off would leave out is a user who came in by password and never by key
//
//     counts   Map of `${user} ${by}` to how many
//     ->       {days, users: [{user, key, password, other}], more}: the first ten, and how many more
sign_in_accepted.users = function (counts, days) {
    const users = new Map();
    for (const [name, count] of counts) {
        const at = name.lastIndexOf(' ');
        const user = name.slice(0, at);
        const by = name.slice(at + 1);
        if (users.has(user) === false) {
            users.set(user, {user, key: 0, password: 0, other: 0});
        }
        users.get(user)[by] += count;
    }
    const all = Array.from(users.values());
    all.sort((a, b) => ((b.key + b.password + b.other) - (a.key + a.password + a.other)) || a.user.localeCompare(b.user));
    return {days, users: all.slice(0, 10), more: Math.max(0, all.length - 10)};
};

module.exports = sign_in_accepted;
