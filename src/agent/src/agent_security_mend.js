const agent_apt = require('./agent_apt');
const agent_shell = require('./agent_shell');
const apt_periodic_from_dump = require('./apt_periodic_from_dump');
const fs = require('fs');
const path = require('path');
const sshd_config_from_dump = require('./sshd_config_from_dump');

const TIMEOUT_MS = 20000;
const SSHD = ['/usr/sbin/sshd', '/usr/bin/sshd'];
const SYSTEMCTL = ['/usr/bin/systemctl', '/bin/systemctl'];
// The file a click writes, the first of sshd's drop-ins: sshd keeps the first value it reads, so
// this one holds over any later file that says yes, a cloud image's among them, and none of
// those is edited. The name the commands handed out for it by hand use too.
const NO_PASSWORDS = '/etc/ssh/sshd_config.d/00-no-passwords.conf';
const NO_PASSWORDS_TEXT = [
    '# Written by serviceman\'s Security page: ssh takes keys only.',
    '# Delete this file and reload ssh to take passwords again.',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    '',
].join('\n');
// apt's own file for what it does by itself, as dpkg-reconfigure unattended-upgrades writes it
const AUTO_UPGRADES = '/etc/apt/apt.conf.d/20auto-upgrades';
const AUTO_UPGRADES_KEYS = ['APT::Periodic::Update-Package-Lists', 'APT::Periodic::Unattended-Upgrade'];
const MENDS = ['ssh_passwords_off', 'ssh_passwords_on', 'auto_updates_on'];

// What the Security page mends with a click, as root: ssh's passwords off, or on again where
// serviceman's own file turned them off, and automatic updates on. Each is what a person would
// type, judged by the program it touches before it holds: a file sshd refuses, or that changes
// nothing, is taken out again, and ssh goes on as it was.
//
//     params  {mend: 'ssh_passwords_off' | 'ssh_passwords_on' | 'auto_updates_on'}
//     ->      {mend, ssh}: what sshd -T says now; or {mend, auto_updates}: as the security call says it
async function agent_security_mend(state, options, params)
{
    const mend = String(params.mend);
    if (MENDS.includes(mend) === false) {
        throw new Error(`the Security page mends ${MENDS.join(', ')}, not ${JSON.stringify(mend)}`);
    }
    const base = (options.security_root_dir === undefined) ? '' : options.security_root_dir;
    if (mend === 'auto_updates_on') {
        return {mend, auto_updates: await auto_updates_on(state, options, base)};
    }
    return {mend, ssh: await ssh_passwords(base, (mend === 'ssh_passwords_off'))};
}

// serviceman's file written (off) or taken away (on), sshd asked whether it will run with that,
// and ssh reloaded. What sshd refuses, and passwords still taken after the file, put it back as
// it was.
async function ssh_passwords(base, off)
{
    const sshd = found_of(base, SSHD);
    if (sshd === null) {
        throw new Error('no ssh server is installed on this machine');
    }
    const file = path.join(base, NO_PASSWORDS);
    if (off && (fs.existsSync(path.dirname(file)) === false)) {
        throw new Error(`${path.dirname(NO_PASSWORDS)} is not there: this sshd reads no file beside sshd_config, where PasswordAuthentication no is set by hand`);
    }
    if ((off === false) && (fs.existsSync(file) === false)) {
        throw new Error(`${NO_PASSWORDS} is not there: serviceman did not turn passwords off here, another file did`);
    }
    const before = off ? null : fs.readFileSync(file, 'utf8');
    function undo() {
        if (off) {
            fs.rmSync(file, {force: true});
        }
        else {
            fs.writeFileSync(file, before, {mode: 0o644});
        }
    }
    if (off) {
        fs.writeFileSync(file, NO_PASSWORDS_TEXT, {mode: 0o644});
    }
    else {
        fs.unlinkSync(file);
    }
    try {
        await sshd_test(base, sshd);
        await ssh_reload(base);
    }
    catch (error) {
        undo();
        throw new Error(`${error.message}; ${off ? 'the file is taken out again' : 'the file is put back'}, and ssh goes on as it was`);
    }
    const settings = await sshd_settings(sshd);
    if (off && ((settings.password === true) || ((settings.kbd_interactive === true) && (settings.use_pam === true)))) {
        undo();
        await ssh_reload(base).catch(() => null);
        throw new Error('sshd takes passwords even with the file: a setting it reads before its drop-ins says yes (sshd_config above its Include, or no Include at all); the file is taken out again');
    }
    return settings;
}

// sshd's own check of its files. It wants its privilege separation folder, which a machine whose
// ssh starts on its socket (Ubuntu 24.04) has only while ssh runs; systemd makes the same one.
async function sshd_test(base, sshd)
{
    fs.mkdirSync(path.join(base, '/run/sshd'), {recursive: true, mode: 0o755});
    const answer = await agent_shell([sshd, '-t'], {timeout: TIMEOUT_MS});
    if (answer.ok === false) {
        throw new Error(`sshd -t refused it: ${first_line(answer)}`);
    }
}

async function sshd_settings(sshd)
{
    const answer = await agent_shell([sshd, '-T'], {timeout: TIMEOUT_MS});
    if ((answer.ok === false) || (/^passwordauthentication /m.test(answer.stdout) === false)) {
        throw new Error(`sshd -T: ${first_line(answer)}`);
    }
    return sshd_config_from_dump(answer.stdout);
}

// ssh reloaded as systemd does it: a running sshd reads its files again, keeping every session
// open, and one not running reads them when it starts. Debian and Ubuntu call the unit ssh, the
// others sshd.
async function ssh_reload(base)
{
    const systemctl = found_of(base, SYSTEMCTL);
    if (systemctl === null) {
        throw new Error('no systemctl here to reload ssh with');
    }
    for (const unit of ['ssh.service', 'sshd.service']) {
        const answer = await agent_shell([systemctl, 'try-reload-or-restart', unit], {timeout: TIMEOUT_MS});
        if (answer.ok) {
            return unit;
        }
        if (/not found|not loaded/i.test(answer.stderr) === false) {
            throw new Error(`systemctl try-reload-or-restart ${unit}: ${first_line(answer)}`);
        }
    }
    throw new Error('systemd knows neither ssh.service nor sshd.service');
}

// unattended-upgrades installed where it is not, and apt told to run it every day: its two
// settings in apt's own file, the rest of that file kept as it is. apt-config says whether it
// holds, since a file read after this one may say otherwise.
async function auto_updates_on(state, options, base)
{
    const apt_config = path.join(base, '/usr/bin/apt-config');
    if (fs.existsSync(apt_config) === false) {
        throw new Error('this is not a machine apt updates');
    }
    if (fs.existsSync(path.join(base, '/usr/bin/unattended-upgrade')) === false) {
        const ran = await agent_apt.install(state, options, ['unattended-upgrades']);
        if (ran.ok === false) {
            throw new Error(`apt-get install unattended-upgrades: ${ran.error}`);
        }
    }
    const file = path.join(base, AUTO_UPGRADES);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, auto_upgrades_text(text), {mode: 0o644});
    const answer = await agent_shell([apt_config, 'dump'], {timeout: TIMEOUT_MS});
    const setting = answer.ok ? apt_periodic_from_dump(answer.stdout) : null;
    if ((setting === null) || (setting === '0')) {
        throw new Error(`apt still says APT::Periodic::Unattended-Upgrade is ${(setting === null) ? 'not set' : `"${setting}"`}: a file of /etc/apt/apt.conf.d read after 20auto-upgrades says so`);
    }
    return {installed: true, on: true, setting};
}

// apt's file with both settings at "1": a line that sets one is changed in its place, a setting
// missing is added at the end, and every other line stays
function auto_upgrades_text(text)
{
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    for (const key of AUTO_UPGRADES_KEYS) {
        const re = new RegExp(`^(\\s*${key})\\s+"[^"]*"\\s*;`);
        const at = lines.findIndex(v => re.test(v));
        if (at === -1) {
            lines.push(`${key} "1";`);
        }
        else {
            lines[at] = lines[at].replace(re, '$1 "1";');
        }
    }
    return `${lines.join('\n')}\n`;
}

function first_line(answer)
{
    return (answer.stderr || answer.stdout).split('\n').map(v => v.trim()).find(v => v !== '') || `it ended with ${answer.code}`;
}

// The first of these files the machine has, under `base`; null for none
function found_of(base, files)
{
    const file = files.map(v => path.join(base, v)).find(v => fs.existsSync(v));
    return (file === undefined) ? null : file;
}

agent_security_mend.auto_upgrades_text = auto_upgrades_text;
agent_security_mend.NO_PASSWORDS = NO_PASSWORDS;

module.exports = agent_security_mend;
