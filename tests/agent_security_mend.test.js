const agent_security_mend = require('../src/agent/src/agent_security_mend');
const agent_security_sshd = require('../src/agent/src/agent_security_sshd');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sign_in_accepted = require('../src/agent/src/sign_in_accepted');
const test = require('node:test');

const NO_PASSWORDS = '/etc/ssh/sshd_config.d/00-no-passwords.conf';

// A machine under a folder: an sshd whose -T says passwords are off once the Security page's
// file is there (unless `deaf`: an sshd_config that sets yes above its Include), whose -t fails
// where `refuse` says; a systemctl that writes down what it was asked, and knows no ssh.service
// where `rhel`; a journal of sign-ins; apt-config reading apt's file, and an apt-get whose install
// puts unattended-upgrade in place
function machine_make(t, parts)
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-security-mend-'));
    t.after(() => fs.rmSync(base, {recursive: true, force: true}));
    const o = Object.assign({deaf: false, refuse: false, rhel: false, upgrade: true}, parts);
    const files = {
        '/etc/ssh/sshd_config': 'Include /etc/ssh/sshd_config.d/*.conf\n',
        '/etc/ssh/sshd_config.d/50-cloud-init.conf': 'PasswordAuthentication yes\n',
        '/usr/sbin/sshd': script([
            `if [ "$1" = "-t" ]; then ${o.refuse ? 'echo "/etc/ssh/sshd_config.d/00-no-passwords.conf line 3: Bad configuration option: KbdInteractiveAuthentication" >&2; exit 255' : 'exit 0'}; fi`,
            `if [ -f ${base}${NO_PASSWORDS} ] && [ "${o.deaf}" = false ]; then echo "passwordauthentication no"; echo "kbdinteractiveauthentication no"; else echo "passwordauthentication yes"; echo "kbdinteractiveauthentication no"; fi`,
            'echo "usepam yes"; echo "port 22"',
        ].join('\n')),
        '/usr/bin/systemctl': script(`echo "$*" >> ${base}/systemctl.asked\n${o.rhel ? 'case "$*" in *ssh.service*) echo "Failed to try-reload-or-restart ssh.service: Unit ssh.service not found." >&2; exit 5 ;; esac\n' : ''}exit 0`),
        '/usr/bin/journalctl': script(`cat <<'END'\n${JOURNAL}\nEND`),
        '/usr/bin/apt-config': script(`cat ${base}/etc/apt/apt.conf.d/* 2>/dev/null; exit 0`),
        '/apt-get': script(`echo "$*" >> ${base}/apt.asked\ncase "$*" in *install*) printf '#!/bin/sh\\n' > ${base}/usr/bin/unattended-upgrade ;; esac\nexit 0`),
    };
    if (o.upgrade === false) {
        delete files['/apt-get'];
    }
    for (const name of Object.keys(files)) {
        const file = path.join(base, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, (typeof files[name] === 'string') ? files[name] : files[name].text, {mode: (typeof files[name] === 'string') ? 0o644 : 0o755});
    }
    function asked(name) {
        const file = path.join(base, name);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
    }
    return {base, options: {security_root_dir: base, apt: path.join(base, 'apt-get')}, asked};
}

function script(text)
{
    return {text: `#!/bin/sh\n${text}\n`};
}

// Two who came in by key, one only by password, one both ways; the rest is not a sign-in taken
const JOURNAL = [
    'Accepted publickey for admin from 192.0.2.10 port 50000 ssh2: ED25519 SHA256:abc',
    'Accepted publickey for admin from 192.0.2.10 port 50001 ssh2: ED25519 SHA256:abc',
    'Accepted password for deploy from 198.51.100.7 port 40000 ssh2',
    'Accepted keyboard-interactive/pam for deploy from 198.51.100.7 port 40001 ssh2',
    'Accepted publickey for root from 192.0.2.11 port 50002 ssh2: RSA SHA256:def',
    'Accepted password for root from 192.0.2.11 port 50003 ssh2',
    'Failed password for root from 203.0.113.5 port 52814 ssh2',
    'Accepted publickey for user from 2001:db8::1 port 2222 ssh2: ED25519 SHA256:ghi',
].join('\n');

// A sign-in taken is who and how; a password asked by PAM is a password; the rest is no sign-in
test('a sign-in sshd took is who came in, by key or by password', function () {
    assert.deepStrictEqual(sign_in_accepted('Accepted publickey for admin from 192.0.2.10 port 50000 ssh2: ED25519 SHA256:abc'), {user: 'admin', by: 'key'});
    assert.deepStrictEqual(sign_in_accepted('Accepted keyboard-interactive/pam for deploy from 198.51.100.7 port 40001 ssh2'), {user: 'deploy', by: 'password'});
    assert.deepStrictEqual(sign_in_accepted('Accepted gssapi-with-mic for ann from 192.0.2.1 port 1 ssh2'), {user: 'ann', by: 'other'});
    assert.strictEqual(sign_in_accepted('Failed password for root from 203.0.113.5 port 52814 ssh2'), null);
    assert.strictEqual(sign_in_accepted('Accepted publickey for'), null);
    const many = new Map(Array.from({length: 12}, (v, i) => [`u${String(i).padStart(2, '0')} key`, i + 1]));
    const users = sign_in_accepted.users(many, 30);
    assert.deepStrictEqual([users.users.length, users.users[0], users.more], [10, {user: 'u11', key: 12, password: 0, other: 0}, 2]);
});

// Where ssh takes passwords, the root half counts the last 30 days' sign-ins by user and way;
// where it does not, nobody is asked; the page's own file is said either way
test('where ssh takes passwords, who signed in over 30 days is counted, by key and by password', async function (t) {
    const machine = machine_make(t, {});
    const open = await agent_security_sshd(machine.options, {root: true});
    assert.deepStrictEqual([open.ssh.password, open.own_file], [true, false]);
    assert.deepStrictEqual(open.sign_ins, {days: 30, users: [
        {user: 'admin', key: 2, password: 0, other: 0},
        {user: 'deploy', key: 0, password: 2, other: 0},
        {user: 'root', key: 1, password: 1, other: 0},
        {user: 'user', key: 1, password: 0, other: 0},
    ], more: 0});
    const as_user = await agent_security_sshd(machine.options, {root: false, why: 'the root half reads it'});
    assert.deepStrictEqual(as_user.sign_ins, {error: 'the journal is root\'s to read; the root half reads it'});
    fs.writeFileSync(path.join(machine.base, NO_PASSWORDS), 'PasswordAuthentication no\n');
    const shut = await agent_security_sshd(machine.options, {root: true});
    assert.deepStrictEqual([shut.ssh.password, shut.sign_ins, shut.own_file], [false, null, true]);
});

// Off: the file first among the drop-ins, checked by sshd -t, ssh reloaded, and sshd -T says no;
// on again: the file taken away, reloaded, and passwords back
test('passwords go off by a file of their own, and come back when it goes', async function (t) {
    const machine = machine_make(t, {});
    const off = await agent_security_mend({}, machine.options, {mend: 'ssh_passwords_off'});
    assert.deepStrictEqual([off.mend, off.ssh.password, off.ssh.read], ['ssh_passwords_off', false, 'sshd -T']);
    assert.match(fs.readFileSync(path.join(machine.base, NO_PASSWORDS), 'utf8'), /^# Written by serviceman's Security page[^]*\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n$/);
    assert.ok(fs.existsSync(path.join(machine.base, '/run/sshd')), 'sshd -t has its folder');
    const on = await agent_security_mend({}, machine.options, {mend: 'ssh_passwords_on'});
    assert.strictEqual(on.ssh.password, true);
    assert.strictEqual(fs.existsSync(path.join(machine.base, NO_PASSWORDS)), false);
    assert.deepStrictEqual(machine.asked('systemctl.asked'), ['try-reload-or-restart ssh.service', 'try-reload-or-restart ssh.service']);
    await assert.rejects(agent_security_mend({}, machine.options, {mend: 'ssh_passwords_on'}), /00-no-passwords.conf is not there: serviceman did not turn passwords off here/);
});

// A unit called sshd, as on Red Hat's: reloaded by that name
test('ssh is reloaded by the name the machine gives it', async function (t) {
    const machine = machine_make(t, {rhel: true});
    await agent_security_mend({}, machine.options, {mend: 'ssh_passwords_off'});
    assert.deepStrictEqual(machine.asked('systemctl.asked'), ['try-reload-or-restart ssh.service', 'try-reload-or-restart sshd.service']);
});

// What sshd refuses, and a file that changes nothing, are taken out again: ssh goes on as it was
test('a file sshd refuses, or that changes nothing, is taken out again', async function (t) {
    const refusing = machine_make(t, {refuse: true});
    await assert.rejects(agent_security_mend({}, refusing.options, {mend: 'ssh_passwords_off'}), /^Error: sshd -t refused it: .*Bad configuration option: KbdInteractiveAuthentication; the file is taken out again, and ssh goes on as it was$/);
    assert.strictEqual(fs.existsSync(path.join(refusing.base, NO_PASSWORDS)), false);
    assert.deepStrictEqual(refusing.asked('systemctl.asked'), [], 'nothing reloaded');

    const deaf = machine_make(t, {deaf: true});
    await assert.rejects(agent_security_mend({}, deaf.options, {mend: 'ssh_passwords_off'}), /sshd takes passwords even with the file/);
    assert.strictEqual(fs.existsSync(path.join(deaf.base, NO_PASSWORDS)), false);
    assert.deepStrictEqual(deaf.asked('systemctl.asked').length, 2, 'reloaded with the file, and again without it');

    await assert.rejects(agent_security_mend({}, deaf.options, {mend: 'rm -rf /'}), /the Security page mends ssh_passwords_off, ssh_passwords_on, auto_updates_on, not "rm -rf \/"/);
});

// Automatic updates: unattended-upgrades installed where it is missing, apt's two settings at
// "1" with the rest of its file kept, and apt-config asked whether it holds
test('automatic updates go on: installed where missing, apt told to run it, the rest of its file kept', async function (t) {
    const machine = machine_make(t, {});
    const file = path.join(machine.base, '/etc/apt/apt.conf.d/20auto-upgrades');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, 'APT::Periodic::Update-Package-Lists "0";\nAPT::Periodic::AutocleanInterval "7";\nAPT::Periodic::Unattended-Upgrade "0";\n');
    const answer = await agent_security_mend({}, machine.options, {mend: 'auto_updates_on'});
    assert.deepStrictEqual(answer, {mend: 'auto_updates_on', auto_updates: {installed: true, on: true, setting: '1'}});
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::AutocleanInterval "7";\nAPT::Periodic::Unattended-Upgrade "1";\n');
    const apt = machine.asked('apt.asked');
    assert.deepStrictEqual([apt.length, apt[0]], [2, '-q update'], 'the lists fetched first');
    assert.match(apt[1], /^-y .*--force-confold.* install unattended-upgrades$/);
    assert.strictEqual(agent_security_mend.auto_upgrades_text(''), 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n');

    // Installed already: nothing installed, the file made
    const again = await agent_security_mend({}, machine.options, {mend: 'auto_updates_on'});
    assert.strictEqual(again.auto_updates.on, true);
    assert.strictEqual(machine.asked('apt.asked').length, 2, 'apt is not asked again');
});
