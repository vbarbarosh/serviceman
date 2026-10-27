const agent_lines_read = require('./agent_lines_read');
const agent_shell = require('./agent_shell');
const fs = require('fs');
const path = require('path');
const sign_in_accepted = require('./sign_in_accepted');
const sign_in_failure_address = require('./sign_in_failure_address');
const sign_in_failures_from_counts = require('./sign_in_failures_from_counts');
const sshd_config_from_dump = require('./sshd_config_from_dump');
const sshd_config_from_files = require('./sshd_config_from_files');

// Neither read is let to hold the answer up longer than this
const READ_TIMEOUT_MS = 20000;
const HOURS = 24;
// How far back the sign-ins taken are counted: who would be left out if passwords went
const DAYS = 30;
// The file the Security page writes to turn passwords off (agent_security_mend)
const NO_PASSWORDS = '/etc/ssh/sshd_config.d/00-no-passwords.conf';
const SSHD = ['/usr/sbin/sshd', '/usr/bin/sshd'];
const JOURNALCTL = ['/usr/bin/journalctl', '/bin/journalctl'];

// What sshd goes by and the sign-ins it refused in the last day. As root (the root half): sshd's
// own word for what it runs with, `sshd -T`, its files where it cannot say (it will not without
// /run/sshd, which a machine whose ssh starts on its socket has only while ssh runs), and its
// whole journal. As the agent's own user: its files where they may be read, and the journal
// where it shows this user more than its own lines; what cannot be read says why, ending with
// `how.why`. Nothing is changed. A machine without sshd has nothing to say of either.
//
// Where ssh takes passwords, also who signed in over the last 30 days and how, by key or by
// password: what turning passwords off would leave out. And whether the Security page's own
// file is there, the one its Turn passwords off writes.
//
//     how   {root: true} or {root: false, why}
//     ->    {ssh, failures, sign_ins, own_file}
async function agent_security_sshd(options, how)
{
    const base = (options.security_root_dir === undefined) ? '' : options.security_root_dir;
    const sshd = found_of(base, SSHD);
    if (sshd === null) {
        return {ssh: {installed: false, read: null, error: null, password: null, kbd_interactive: null, use_pam: null, root_login: null, ports: []}, failures: null, sign_ins: null, own_file: false};
    }
    const answers = await Promise.all([ssh_read(base, sshd, how), failures_read(base, how)]);
    const ssh = answers[0];
    const takes = (ssh.password === true) || ((ssh.kbd_interactive === true) && (ssh.use_pam === true));
    return {ssh, failures: answers[1], sign_ins: takes ? await sign_ins_read(base, how) : null, own_file: fs.existsSync(path.join(base, NO_PASSWORDS))};
}

async function ssh_read(base, sshd, how)
{
    if (how.root) {
        const answer = await agent_shell([sshd, '-T'], {timeout: READ_TIMEOUT_MS});
        if (answer.ok && /^passwordauthentication /m.test(answer.stdout)) {
            return sshd_config_from_dump(answer.stdout);
        }
    }
    return sshd_config_from_files(base, how.root ? 'even as root' : how.why);
}

// sshd's lines of the last day, counted as they come: a busy machine's day of knocks is too
// many lines to hold. As the agent's user, journalctl says on stderr when it shows only this
// user's own lines, a hint -q would hide.
async function failures_read(base, how)
{
    const journalctl = found_of(base, JOURNALCTL);
    if (journalctl === null) {
        return null;
    }
    const counts = new Map();
    const argv = [journalctl, '-u', 'ssh', '-u', 'sshd', `--since=-${HOURS}h`, '-o', 'cat', '--no-pager'].concat(how.root ? ['-q'] : []);
    const answer = await agent_lines_read(argv, READ_TIMEOUT_MS, function (line) {
        const address = sign_in_failure_address(line);
        if (address !== null) {
            counts.set(address, (counts.get(address) || 0) + 1);
        }
    });
    if (answer.killed) {
        return {error: `the journal took longer than ${READ_TIMEOUT_MS/1000} s to read`};
    }
    if (answer.ok === false) {
        return {error: `journalctl: ${answer.stderr.split('\n')[0] || `it ended with ${answer.code}`}`};
    }
    if ((how.root === false) && /not seeing messages from other users|insufficient permissions|No journal files were opened/i.test(answer.stderr)) {
        return {error: `the journal shows this user only its own lines; ${how.why}`};
    }
    return sign_in_failures_from_counts(counts, HOURS);
}

// The sign-ins sshd took over the last 30 days, by user and by key or password, counted as they
// come. journalctl picks the lines itself where it can (--grep); one built without that hands
// over every line, and they are picked here. Root's to read, as the failures are.
async function sign_ins_read(base, how)
{
    const journalctl = found_of(base, JOURNALCTL);
    if (journalctl === null) {
        return null;
    }
    if (how.root === false) {
        return {error: `the journal is root's to read; ${how.why}`};
    }
    const counts = new Map();
    function take(line) {
        const found = sign_in_accepted(line);
        if (found !== null) {
            const name = `${found.user} ${found.by}`;
            counts.set(name, (counts.get(name) || 0) + 1);
        }
    }
    const argv = [journalctl, '-u', 'ssh', '-u', 'sshd', `--since=-${DAYS}d`, '-o', 'cat', '--no-pager', '-q'];
    let answer = await agent_lines_read(argv.concat(['--grep=^Accepted ']), READ_TIMEOUT_MS, take);
    if ((answer.ok === false) && /pattern matching|--grep|unrecognized option/i.test(answer.stderr)) {
        counts.clear();
        answer = await agent_lines_read(argv, READ_TIMEOUT_MS, take);
    }
    // journalctl --grep that finds nothing ends with 1, and says nothing
    if (answer.killed) {
        return {error: `the journal took longer than ${READ_TIMEOUT_MS/1000} s to read`};
    }
    if ((answer.ok === false) && (answer.stderr !== '')) {
        return {error: `journalctl: ${answer.stderr.split('\n')[0]}`};
    }
    return sign_in_accepted.users(counts, DAYS);
}

// The first of these files the machine has, under `base`; null for none
function found_of(base, files)
{
    const file = files.map(v => path.join(base, v)).find(v => fs.existsSync(v));
    return (file === undefined) ? null : file;
}

module.exports = agent_security_sshd;
