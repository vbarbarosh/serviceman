const agent_security = require('../src/agent/src/agent_security');
const agent_security_sshd = require('../src/agent/src/agent_security_sshd');
const apt_periodic_from_dump = require('../src/agent/src/apt_periodic_from_dump');
const assert = require('assert');
const distro_eol_from_csv = require('../src/agent/src/distro_eol_from_csv');
const docker_published_from_list = require('../src/agent/src/docker_published_from_list');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const os_from_release = require('../src/agent/src/os_from_release');
const path = require('path');
const sign_in_failure_address = require('../src/agent/src/sign_in_failure_address');
const sign_in_failures_from_counts = require('../src/agent/src/sign_in_failures_from_counts');
const sshd_config_from_dump = require('../src/agent/src/sshd_config_from_dump');
const sshd_config_from_files = require('../src/agent/src/sshd_config_from_files');
const test = require('node:test');

// sshd_config as Ubuntu 24.04 ships it, the parts that matter: its Include first, and a
// PasswordAuthentication no below it that comes too late to hold
const SSHD_CONFIG = [
    'Include /etc/ssh/sshd_config.d/*.conf',
    '',
    '#PermitRootLogin prohibit-password',
    'KbdInteractiveAuthentication no',
    'UsePAM yes',
    'PasswordAuthentication no',
    'Subsystem\tsftp\t/usr/lib/openssh/sftp-server',
    'Match User deploy',
    '\tPermitRootLogin yes',
    '\tPasswordAuthentication no',
].join('\n');
// A cloud image's drop-in, 0600 on the machine
const CLOUD_INIT = 'PasswordAuthentication yes\n';
// A Match in a file of its own ends with that file
const MATCHED = 'Match Address 10.0.0.0/8\n    PermitRootLogin yes\n';

// What `sshd -T` prints, the lines that matter among its hundred
const SSHD_DUMP = [
    'port 22',
    'port 2222',
    'addressfamily any',
    'listenaddress [::]:22',
    'listenaddress 0.0.0.0:22',
    'usepam yes',
    'permitrootlogin without-password',
    'passwordauthentication no',
    'kbdinteractiveauthentication no',
    'pubkeyauthentication yes',
].join('\n');

const UBUNTU_CSV = [
    'version,codename,series,created,release,eol,eol-server,eol-esm',
    '18.04 LTS,Bionic Beaver,bionic,2017-10-19,2018-04-26,2023-05-31,2023-05-31,2028-04-26',
    '20.04 LTS,Focal Fossa,focal,2019-10-17,2020-04-23,2025-05-29,2025-05-29,2030-04-23',
    '24.04 LTS,Noble Numbat,noble,2023-10-26,2024-04-25,2029-05-31,2029-05-31,2034-04-25',
    '25.10,Questing Quokka,questing,2025-04-17,2025-10-09,2026-07-09',
    '26.04 LTS,Resolute Raccoon,resolute,2025-10-09,2026-04-23',
].join('\n');
const DEBIAN_CSV = [
    'version,codename,series,created,release,eol,eol-lts,eol-elts',
    '11,Bullseye,bullseye,2019-07-06,2021-08-14,2024-08-14,2026-08-31,2031-06-30',
    '12,Bookworm,bookworm,2021-08-14,2023-06-10,2026-06-10,2028-06-30,2033-06-30',
    '13,Trixie,trixie,2023-06-10,2025-08-09',
    ',Sid,sid,1993-08-16',
].join('\n');

const OS_UBUNTU = [
    'PRETTY_NAME="Ubuntu 24.04.1 LTS"',
    'NAME="Ubuntu"',
    'VERSION_ID="24.04"',
    'VERSION="24.04.1 LTS (Noble Numbat)"',
    'VERSION_CODENAME=noble',
    'ID=ubuntu',
    'ID_LIKE=debian',
    'UBUNTU_CODENAME=noble',
].join('\n');
const OS_DEBIAN = [
    'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"',
    'NAME="Debian GNU/Linux"',
    'VERSION_ID="12"',
    'VERSION_CODENAME=bookworm',
    'ID=debian',
].join('\n');

// sshd's lines of a day, as `journalctl -o cat` gives them: what is a sign-in refused and what
// is not
const JOURNAL = [
    'Server listening on 0.0.0.0 port 22.',
    'Accepted publickey for user from 192.0.2.10 port 50000 ssh2: ED25519 SHA256:abc',
    'Failed password for root from 203.0.113.5 port 52814 ssh2',
    'Failed password for invalid user admin from 203.0.113.5 port 40000 ssh2',
    'Invalid user admin from 203.0.113.5 port 40000',
    'Invalid user test from 2001:db8::1 port 2222',
    'Invalid user  from 198.51.100.7 port 51234',
    'Connection closed by authenticating user root 198.51.100.7 port 33012 [preauth]',
    'Disconnected from authenticating user root 198.51.100.7 port 33012 [preauth]',
    'Connection closed by invalid user admin 203.0.113.5 port 40000 [preauth]',
    'Received disconnect from 203.0.113.5 port 40000:11: Bye Bye [preauth]',
    'pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=203.0.113.5  user=root',
].join('\n');

const APT_DUMP = [
    'APT "";',
    'APT::Architecture "amd64";',
    'APT::Periodic "";',
    'APT::Periodic::Update-Package-Lists "1";',
    'APT::Periodic::Unattended-Upgrade "1";',
    'Dir "/";',
].join('\n');

// What docker lists: a database on every address, v4 and v6; a web server on the loopback,
// with a port its image names and nobody published
const DOCKER_LIST = [
    {Id: 'a'.repeat(64), Names: ['/postgres'], Image: 'postgres:16', Ports: [
        {IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp'},
        {IP: '::', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp'},
    ]},
    {Id: 'b'.repeat(64), Names: ['/web'], Image: 'nginx:1.27', Ports: [
        {IP: '127.0.0.1', PrivatePort: 80, PublicPort: 32768, Type: 'tcp'},
        {PrivatePort: 443, Type: 'tcp'},
    ]},
];

// sshd's files under a folder of their own, as / is laid out
function tree_make(t, files)
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-security-'));
    t.after(() => fs.rmSync(base, {recursive: true, force: true}));
    for (const name of Object.keys(files)) {
        const file = path.join(base, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, files[name].text, {mode: files[name].mode || 0o644});
    }
    return base;
}

function script(text)
{
    return {text: `#!/bin/sh\n${text}\n`, mode: 0o755};
}

// The first value of a keyword holds, so the cloud image's yes wins over the no below the
// Include; a Match block, in the main file or ending with a drop-in, holds for some only and is
// left out; a hidden file the Include's * does not take is not read
test('sshd\'s files are read as sshd reads them: an Include in its place, the first value, no Match', function (t) {
    const base = tree_make(t, {
        '/etc/ssh/sshd_config': {text: SSHD_CONFIG},
        '/etc/ssh/sshd_config.d/40-match.conf': {text: MATCHED},
        '/etc/ssh/sshd_config.d/50-cloud-init.conf': {text: CLOUD_INIT},
        '/etc/ssh/sshd_config.d/60-port.conf': {text: 'Port 22\nPort=2222\n'},
        '/etc/ssh/sshd_config.d/.70-hidden.conf': {text: 'PermitRootLogin yes\n'},
        '/etc/ssh/sshd_config.d/notes.txt': {text: 'UsePAM no\n'},
    });
    assert.deepStrictEqual(sshd_config_from_files(base, 'the root half reads it'), {
        installed: true,
        read: 'files',
        error: null,
        password: true,
        kbd_interactive: false,
        use_pam: true,
        root_login: 'prohibit-password',
        ports: [22, 2222],
    });
});

// Nothing set anywhere is OpenSSH's own defaults: passwords allowed, and no PAM
test('what no file of sshd sets is OpenSSH\'s default', function (t) {
    const base = tree_make(t, {'/etc/ssh/sshd_config': {text: 'Subsystem sftp internal-sftp\nChallengeResponseAuthentication no\nKbdInteractiveAuthentication yes\n'}});
    const said = sshd_config_from_files(base, 'the root half reads it');
    assert.deepStrictEqual([said.password, said.kbd_interactive, said.use_pam, said.root_login, said.ports], [true, false, false, 'prohibit-password', [22]], 'the old name of keyboard-interactive is the same keyword, the first value of it holds');
});

// A cloud image makes its drop-in 0600: the agent's user cannot read it, and what it would say
// is not guessed
test('a file of sshd that cannot be read leaves every value unknown and names the file', {skip: (process.getuid() === 0) ? 'root reads every file' : false}, function (t) {
    const base = tree_make(t, {
        '/etc/ssh/sshd_config': {text: SSHD_CONFIG},
        '/etc/ssh/sshd_config.d/50-cloud-init.conf': {text: CLOUD_INIT, mode: 0o600},
    });
    fs.chmodSync(path.join(base, '/etc/ssh/sshd_config.d/50-cloud-init.conf'), 0o000);
    assert.deepStrictEqual(sshd_config_from_files(base, 'the root half reads it'), {
        installed: true,
        read: null,
        error: '/etc/ssh/sshd_config.d/50-cloud-init.conf: permission denied; the root half reads it',
        password: null,
        kbd_interactive: null,
        use_pam: null,
        root_login: null,
        ports: [],
    });
});

test('sshd -T is what sshd runs with, every port of it, the old name of keyboard-interactive too', function () {
    assert.deepStrictEqual(sshd_config_from_dump(SSHD_DUMP), {
        installed: true,
        read: 'sshd -T',
        error: null,
        password: false,
        kbd_interactive: false,
        use_pam: true,
        root_login: 'without-password',
        ports: [22, 2222],
    });
    const old = sshd_config_from_dump('port 22\nusepam no\npermitrootlogin yes\npasswordauthentication yes\nchallengeresponseauthentication yes\n');
    assert.deepStrictEqual([old.password, old.kbd_interactive, old.root_login], [true, true, 'yes']);
});

test('the system is named by os-release, and its end by distro-info\'s list', function () {
    assert.deepStrictEqual(os_from_release(OS_UBUNTU), {id: 'ubuntu', version: '24.04', name: 'Ubuntu 24.04.1 LTS', codename: 'noble'});
    assert.deepStrictEqual(os_from_release(OS_DEBIAN), {id: 'debian', version: '12', name: 'Debian GNU/Linux 12 (bookworm)', codename: 'bookworm'});
    assert.deepStrictEqual(os_from_release('NAME=Alpine\n'), {id: null, version: null, name: null, codename: null});

    assert.deepStrictEqual(distro_eol_from_csv('ubuntu', 'focal', UBUNTU_CSV), {eol: '2025-05-29', eol_extended: '2030-04-23'}, 'a release past its end');
    assert.deepStrictEqual(distro_eol_from_csv('ubuntu', 'noble', UBUNTU_CSV), {eol: '2029-05-31', eol_extended: '2034-04-25'});
    assert.deepStrictEqual(distro_eol_from_csv('ubuntu', 'questing', UBUNTU_CSV), {eol: '2026-07-09', eol_extended: null}, 'no server column: its standard end');
    assert.deepStrictEqual(distro_eol_from_csv('ubuntu', 'resolute', UBUNTU_CSV), {eol: null, eol_extended: null}, 'no end said yet');
    assert.deepStrictEqual(distro_eol_from_csv('ubuntu', 'plucky', UBUNTU_CSV), {eol: null, eol_extended: null}, 'newer than the list');
    assert.deepStrictEqual(distro_eol_from_csv('debian', 'bookworm', DEBIAN_CSV), {eol: '2026-06-10', eol_extended: '2028-06-30'});
    assert.deepStrictEqual(distro_eol_from_csv('debian', 'trixie', DEBIAN_CSV), {eol: null, eol_extended: null});
    assert.deepStrictEqual(distro_eol_from_csv('debian', 'sid', DEBIAN_CSV), {eol: null, eol_extended: null});
    assert.deepStrictEqual(distro_eol_from_csv('fedora', '41', 'version,codename,series\n'), {eol: null, eol_extended: null}, 'a system whose columns are not known');
});

// A wrong password, a user the machine has not, a client that offered what was not taken: each
// once. The close that follows a refusal, and pam's line for it, are not counted again.
test('sshd\'s refused sign-ins are counted by the address they came from', function () {
    const counts = new Map();
    const counted = [];
    for (const line of JOURNAL.split('\n')) {
        const address = sign_in_failure_address(line);
        if (address !== null) {
            counted.push(line.split(' ').slice(0, 3).join(' '));
            counts.set(address, (counts.get(address) || 0) + 1);
        }
    }
    assert.deepStrictEqual(counted, ['Failed password for', 'Failed password for', 'Invalid user admin', 'Invalid user test', 'Invalid user ', 'Connection closed by']);
    assert.deepStrictEqual(sign_in_failures_from_counts(counts, 24), {
        hours: 24,
        count: 6,
        addresses: 3,
        top: [{address: '203.0.113.5', count: 3}, {address: '198.51.100.7', count: 2}, {address: '2001:db8::1', count: 1}],
    });
    assert.strictEqual(sign_in_failure_address('Invalid user x from somewhere.example.com port 22'), '', 'counted, from no address it can read');
    assert.deepStrictEqual(sign_in_failures_from_counts(new Map([['', 2]]), 24), {hours: 24, count: 2, addresses: 0, top: []});
});

test('whether apt installs updates by itself is the setting apt-config says, or none', function () {
    assert.strictEqual(apt_periodic_from_dump(APT_DUMP), '1');
    assert.strictEqual(apt_periodic_from_dump(APT_DUMP.replace('Unattended-Upgrade "1"', 'Unattended-Upgrade "0"')), '0');
    assert.strictEqual(apt_periodic_from_dump(APT_DUMP.split('\n').filter(v => v.includes('Unattended') === false).join('\n')), null);
});

test('docker\'s published ports are each binding with a port of the machine, at the address docker took', function () {
    assert.deepStrictEqual(docker_published_from_list(DOCKER_LIST), {
        ids: ['a'.repeat(64), 'b'.repeat(64)],
        published: [
            {id: 'a'.repeat(64), name: 'postgres', image: 'postgres:16', address: '0.0.0.0', port: 5432, proto: 'tcp', private: 5432},
            {id: 'a'.repeat(64), name: 'postgres', image: 'postgres:16', address: '::', port: 5432, proto: 'tcp', private: 5432},
            {id: 'b'.repeat(64), name: 'web', image: 'nginx:1.27', address: '127.0.0.1', port: 32768, proto: 'tcp', private: 80},
        ],
    });
    assert.deepStrictEqual(docker_published_from_list([]), {ids: [], published: []});
});

// A machine laid out under a folder: the system and distro-info's list, sshd and its files, a
// journalctl that says the hint a user who sees only its own lines gets (without -q), apt-config
// and unattended-upgrades; docker on a socket of its own
function machine_make(t)
{
    return tree_make(t, {
        '/etc/os-release': {text: OS_UBUNTU},
        '/usr/share/distro-info/ubuntu.csv': {text: UBUNTU_CSV},
        '/etc/ssh/sshd_config': {text: SSHD_CONFIG},
        '/etc/ssh/sshd_config.d/50-cloud-init.conf': {text: CLOUD_INIT},
        '/usr/sbin/sshd': script(`[ "$1" = "-T" ] && cat <<'END'\n${SSHD_DUMP}\nEND`),
        '/usr/bin/journalctl': script(`case " $* " in *" -q "*) ;; *) echo 'Hint: You are currently not seeing messages from other users and the system.' >&2 ;; esac\ncat <<'END'\n${JOURNAL}\nEND`),
        '/usr/bin/apt-config': script(`cat <<'END'\n${APT_DUMP}\nEND`),
        '/usr/bin/unattended-upgrade': script('exit 0'),
    });
}

async function docker_make(t, base)
{
    const socket = path.join(base, 'docker.sock');
    const server = http.createServer(function (req, res) {
        res.writeHead((req.url === '/containers/json') ? 200 : 404, {'content-type': 'application/json'});
        res.end(JSON.stringify((req.url === '/containers/json') ? DOCKER_LIST : {message: 'no such page'}));
    });
    await new Promise(v => server.listen(socket, v));
    const before = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = `unix://${socket}`;
    t.after(function () {
        server.close();
        if (before === undefined) {
            delete process.env.DOCKER_HOST;
        }
        else {
            process.env.DOCKER_HOST = before;
        }
    });
}

// A root half on a socket, answering one job as `answer` says: with the work, or as one too
// old to know it
async function root_make(t, base, answer)
{
    const socket = path.join(base, 'root.sock');
    const asked = [];
    const server = net.createServer(function (conn) {
        let rest = '';
        conn.on('data', async function (chunk) {
            rest += chunk.toString('utf8');
            if (rest.includes('\n') === false) {
                return;
            }
            const job = JSON.parse(rest.slice(0, rest.indexOf('\n')));
            asked.push(job.method);
            conn.end(`${JSON.stringify(await answer(job))}\n`);
        });
    });
    await new Promise(v => server.listen(socket, v));
    t.after(() => server.close());
    return {socket, asked};
}

// With a root half: sshd's own word and the whole journal; the rest read as the agent's user
test('the security call reads sshd and its journal through the root half, the rest itself', async function (t) {
    const base = machine_make(t);
    await docker_make(t, base);
    const root = await root_make(t, base, async function (job) {
        return {type: 'reply', ok: true, value: await agent_security_sshd({security_root_dir: base}, {root: true})};
    });
    const answer = await agent_security({security_root_dir: base, root_socket: root.socket, docker: 'docker'});
    assert.deepStrictEqual(root.asked, ['security_root']);
    assert.strictEqual(answer.root, true);
    assert.deepStrictEqual(answer.os, {id: 'ubuntu', version: '24.04', name: 'Ubuntu 24.04.1 LTS', codename: 'noble', eol: '2029-05-31', eol_extended: '2034-04-25'});
    assert.strictEqual(answer.ssh.read, 'sshd -T');
    assert.deepStrictEqual([answer.ssh.password, answer.ssh.ports], [false, [22, 2222]]);
    assert.deepStrictEqual([answer.failures.count, answer.failures.addresses], [6, 3]);
    assert.deepStrictEqual(answer.auto_updates, {installed: true, on: true, setting: '1'});
    assert.deepStrictEqual(answer.docker, docker_published_from_list(DOCKER_LIST));
});

// A root half from before this check: the agent's user reads what it may, says why the journal
// is not counted, and no part fails the rest
test('a root half too old for the security call leaves the agent\'s user to read what it may', async function (t) {
    const base = machine_make(t);
    await docker_make(t, base);
    const root = await root_make(t, base, async function (job) {
        return {type: 'reply', ok: false, error: `the root agent knows nothing called ${JSON.stringify(job.method)}`};
    });
    const answer = await agent_security({security_root_dir: base, root_socket: root.socket, docker: 'docker'});
    assert.deepStrictEqual(root.asked, ['security_root']);
    assert.strictEqual(answer.root, false);
    assert.strictEqual(answer.ssh.read, 'files');
    assert.deepStrictEqual([answer.ssh.password, answer.ssh.kbd_interactive], [true, false], 'the cloud image\'s drop-in holds');
    assert.deepStrictEqual(answer.failures, {error: 'the journal shows this user only its own lines; the root half here is older than this check and updates itself within half a minute'});
    assert.strictEqual(answer.os.codename, 'noble');
    assert.strictEqual(answer.docker.published.length, 3);
});

// No root half at all, no sshd, no apt, no docker: each part says it has nothing, none fails
test('a machine without sshd, apt or docker says so part by part', async function (t) {
    const base = tree_make(t, {'/etc/os-release': {text: OS_DEBIAN}});
    const before = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = `unix://${path.join(base, 'no-docker.sock')}`;
    t.after(function () {
        if (before === undefined) {
            delete process.env.DOCKER_HOST;
        }
        else {
            process.env.DOCKER_HOST = before;
        }
    });
    const answer = await agent_security({security_root_dir: base, root_socket: path.join(base, 'no-root.sock'), docker: 'docker'});
    assert.deepStrictEqual(answer, {
        root: false,
        os: {id: 'debian', version: '12', name: 'Debian GNU/Linux 12 (bookworm)', codename: 'bookworm', eol: null, eol_extended: null},
        ssh: {installed: false, read: null, error: null, password: null, kbd_interactive: null, use_pam: null, root_login: null, ports: []},
        failures: null,
        sign_ins: null,
        own_file: false,
        auto_updates: null,
        docker: null,
    });
});
