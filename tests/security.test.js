const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const security_checks = require('../src/main/src/helpers/security_checks');
const security_knock = require('../src/main/src/helpers/security_knock');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';
const NOW = Date.parse('2026-10-27T18:00:00Z');
const KEYS = ['open', 'firewall', 'ssh', 'updates', 'auto', 'system'];

// The worst a VPS can be: a database Docker publishes past ufw, answering the knock from
// outside; passwords over ssh, knocked on thousands of times a day; security updates waiting;
// nothing installing them; a release whose support ended
test('a machine open to harm is red where to mend it, orange where to look, and says which tab mends it', function () {
    const seen = seen_of({
        rows: [
            row(22, 'tcp', {held: 'sshd · 812', knock: 'answered'}),
            row(5432, 'tcp', {docker: {name: 'db', image: 'postgres:16'}, verdict: verdict('open', 'let in by Docker, past ufw'), knock: 'answered'}),
            row(8080, 'tcp', {verdict: verdict('closed', 'kept out by the default'), knock: 'silent'}),
            row(3000, 'tcp', {verdict: verdict('open', 'let in'), knock: 'silent'}),
            row(41641, 'udp', {held: 'tailscaled · 99'}),
        ],
        facts: facts({
            ssh: ssh({password: true}),
            failures: {hours: 24, count: 3412, addresses: 312, top: [{address: '192.0.2.4', count: 412}]},
            auto_updates: {installed: true, on: false, setting: '0'},
            os: {id: 'ubuntu', version: '20.04', name: 'Ubuntu 20.04.6 LTS', codename: 'focal', eol: '2025-05-29', eol_extended: '2030-04-02'},
        }),
    });
    const checks = security_checks(seen, {pending: 12, security: 3, reboot: false}, NOW);
    assert.deepStrictEqual(checks.map(v => v.key), KEYS);
    const by = Object.fromEntries(checks.map(v => [v.key, [v.state, v.text, v.tab]]));
    assert.deepStrictEqual(by, {
        open: ['bad', '5432 · Docker', 'docker'],
        firewall: ['ok', 'on', 'firewall'],
        ssh: ['bad', 'passwords on', 'shell'],
        updates: ['warn', '3 security', 'configure'],
        auto: ['warn', 'off', 'shell'],
        system: ['bad', '20.04 · ended', null],
    });
    const open = checks[0].detail;
    assert.match(open, /5432\/tcp \(PostgreSQL's port\) published by Docker for db \(postgres:16\): answered from outside/);
    assert.match(open, /3000\/tcp: open from inside, yet no answer from outside/, 'a firewall in front of it is said, not hidden');
    assert.doesNotMatch(open, /8080/, 'kept out inside and silent outside: nothing to say');
    assert.match(open, /41641\/udp held by tailscaled · 99: let in; not knocked/, 'listed, yet not counted: tailscale\'s port is meant to be open');
    assert.match(open, /Knocked from serviceman at 203\.0\.113\.7: 2 answered, 2 silent\./);
    assert.match(checks[2].detail, /PasswordAuthentication yes \(as sshd -T says them\)/);
    assert.match(checks[2].detail, /3,412 failed sign-in tries in the last 24 hours .* from 312 addresses; most from 192\.0\.2\.4 \(412\)/);
    assert.match(checks[5].detail, /standard support ended 2025-05-29\. Extended security support \(Ubuntu Pro\) runs to 2030-04-02/);
});

test('a machine kept well is green, and a port meant to be open is no harm', function () {
    const seen = seen_of({
        rows: [row(22, 'tcp', {knock: 'answered'}), row(443, 'tcp', {knock: 'answered'}), row(80, 'tcp', {knock: 'answered'}), row(6379, 'tcp', {address: '127.0.0.1', reach: 'local', verdict: verdict('local', 'only this machine can reach it')})],
        facts: facts({}),
    });
    const checks = security_checks(seen, {pending: 0, security: 0, reboot: false}, NOW);
    assert.deepStrictEqual(checks.map(v => [v.state, v.text]), [['ok', '22 · 443 · 80'], ['ok', 'on'], ['ok', 'keys only'], ['ok', 'up to date'], ['ok', 'on'], ['ok', '24.04']]);
    assert.match(checks[2].detail, /No failed sign-in try in the last 24 hours/);
});

// Nobody knocked (no public address known): the inside decides, and a port nothing keeps out
// now is open, a firewall that is off included
test('unknocked, a port is open when nothing inside keeps it out now', function () {
    const off = {installed: true, active: false, defaults: null, rules: []};
    const seen = seen_of({
        rows: [row(8080, 'tcp', {verdict: Object.assign(verdict('closed', 'once on: kept out by the default'), {now: false})}), row(9000, 'tcp', {address: '100.64.0.20', reach: 'network', verdict: verdict('open', 'let in')})],
        firewall: off,
        knocked: {addresses: [], nat: false, skipped: 'no public address of this machine is known: its interfaces have none, and its agent dials in from a private one'},
    });
    const checks = security_checks(seen, null, NOW);
    assert.deepStrictEqual([checks[0].state, checks[0].text], ['warn', '8080']);
    assert.match(checks[0].detail, /8080\/tcp: once on: kept out by the default; not knocked/);
    assert.match(checks[0].detail, /Not knocked from outside: no public address/);
    assert.deepStrictEqual([checks[1].state, checks[1].text], ['warn', 'off']);
    assert.deepStrictEqual([checks[3].state, checks[3].text], ['none', 'not counted']);
});

// What could not be read is grey and says why, never a guess: an agent from before the check,
// ports and firewall that did not answer, sshd's files root's alone, a release with no end said
test('what cannot be read is grey, and says why', function () {
    const older = security_checks(seen_of({facts: null, errors: {facts: 'its agent is from before the security check', ports: 'its agent is from before the port list', firewall: 'ufw needs root, and sudo on that machine asked for a password: give it a root agent'}, rows: [], firewall: null}), null, NOW);
    assert.deepStrictEqual(older.map(v => [v.state, v.text]), [['none', 'not read'], ['none', 'cannot ask'], ['none', 'not read'], ['none', 'not counted'], ['none', 'not read'], ['none', 'not read']]);
    assert.match(older[1].detail, /sudo on that machine asked for a password/);
    const unread = ssh({read: null, error: '/etc/ssh/sshd_config.d/50-cloud-init.conf: permission denied; the root half reads it', password: null, kbd_interactive: null, use_pam: null, root_login: null});
    const session = security_checks(seen_of({facts: facts({root: false, ssh: unread, failures: {error: 'needs the root half: the journal shows this user only its own lines'}, auto_updates: null, os: {id: 'debian', version: null, name: 'Debian GNU/Linux trixie/sid', codename: 'trixie', eol: null, eol_extended: null}})}), null, NOW);
    assert.deepStrictEqual([session[2].state, session[2].text], ['none', 'needs root half']);
    assert.match(session[2].detail, /50-cloud-init\.conf: permission denied/);
    assert.match(session[2].detail, /Failed sign-in tries not counted: needs the root half/);
    assert.deepStrictEqual([session[4].state, session[4].text], ['none', 'not apt']);
    assert.deepStrictEqual([session[5].state, session[5].text], ['none', 'debian']);
    const none = security_checks(seen_of({facts: facts({ssh: {installed: false, read: null, error: null, password: null, kbd_interactive: null, use_pam: null, root_login: null, ports: []}, failures: null})}), null, NOW);
    assert.deepStrictEqual([none[2].state, none[2].text], ['ok', 'no sshd']);
});

test('passwords by keyboard-interactive count as passwords; a release ending within half a year is orange', function () {
    const january = Date.parse('2027-01-04T09:00:00Z');
    const checks = security_checks(seen_of({facts: facts({ssh: ssh({password: false, kbd_interactive: true, use_pam: true, root_login: 'yes'}), os: {id: 'ubuntu', version: '22.04', name: 'Ubuntu 22.04.5 LTS', codename: 'jammy', eol: '2027-06-01', eol_extended: '2032-04-09'}})}), null, january);
    assert.deepStrictEqual([checks[2].state, checks[2].text], ['bad', 'passwords on']);
    assert.match(checks[2].detail, /KbdInteractiveAuthentication yes with UsePAM yes/);
    assert.deepStrictEqual([checks[5].state, checks[5].text], ['warn', '22.04 · ends Jun 2027']);
    const keys = security_checks(seen_of({facts: facts({ssh: ssh({root_login: 'yes'})})}), null, NOW);
    assert.match(keys[2].detail, /Root may sign in, with a key/);
});

test('a knock says answered where something listens, refused where nothing does', async function () {
    const server = net.createServer(v => v.destroy());
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const open = server.address().port;
    const closed = await port_free();
    try {
        assert.strictEqual(await security_knock('127.0.0.1', open), 'answered');
        assert.strictEqual(await security_knock('127.0.0.1', closed), 'refused');
    }
    finally {
        server.close();
    }
});

// The whole way: a machine with a root half dials in, Check again looks at it, and the page's
// status carries its six checks, Health a Security column beside the rest
test('Check again looks at every machine, and the status carries what it found', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-security-'));
    const socket = path.join(dir, 'root.sock');
    const ufw = path.join(__dirname, '..', 'modules', 'firewall', 'tests', 'fake_ufw.js');
    const root = child_process.spawn(process.execPath, [AGENT, '--role', 'root', '--root-socket', socket, '--ufw', ufw], {stdio: ['ignore', 'ignore', 'ignore'], env: Object.assign({}, process.env, {FAKE_UFW_STATE: path.join(dir, 'ufw.json')})});
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'ui1', token: TOKEN}], services: []}, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const control_port = servers.control.address().port;
    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', TOKEN, '--root-socket', socket, '--ufw', '/nowhere/ufw'], {stdio: ['ignore', 'ignore', 'ignore']});
    try {
        const remote = app.remote_by_name.ui1;
        await wait_until(() => (remote.state.phase === 'online') && (remote.state.resources !== null) && remote.state.resources.can.includes('security') && remote.state.resources.can.includes('root'), 15000);
        const asked = await control(control_port, 'POST', '/api/v1/security/check');
        assert.deepStrictEqual([asked.status, asked.body.checking], [202, ['ui1']]);
        const again = await control(control_port, 'POST', '/api/v1/security/check');
        assert.deepStrictEqual(again.body.checking, ['ui1'], 'a machine being looked at is not asked twice');
        await wait_until(() => app.security.seen.has('ui1') && (app.security.running.size === 0), 60000);

        const security = (await control(control_port, 'GET', '/api/v1/security')).body;
        const found = security.rows.find(v => v.remote === 'ui1');
        assert.strictEqual(found.error, null, JSON.stringify(found));
        assert.deepStrictEqual(found.checks.map(v => v.key), KEYS);
        const firewall = found.checks.find(v => v.key === 'firewall');
        assert.deepStrictEqual([firewall.state, firewall.text], ['warn', 'off'], 'the fake ufw starts off, read through the root half');
        assert.ok(app.security.seen.get('ui1').facts.root, 'sshd and the journal were the root half\'s to read');
        assert.ok(app.log_lines.some(v => /\[security_checked\] remote=ui1 /.test(v)), 'the look is in the log');

        const status = JSON.parse((await fetch_host({port: control_port, host: '127.0.0.1', path: '/api/v1/status'})).body);
        assert.deepStrictEqual(status.security.rows.map(v => v.remote), ['ui1']);
        const machine = status.health.areas.find(v => v.key === 'machines').rows[0];
        assert.strictEqual(machine.checks.find(v => v.key === 'security').label, 'Security');
    }
    finally {
        agent.kill('SIGKILL');
        root.kill('SIGKILL');
        for (const item of app.remotes) {
            if (item.state.socket !== null) {
                item.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== null) && (door !== undefined)) {
                door.close();
                door.closeAllConnections();
            }
        }
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// What security_of_remote answers of a machine, with the given parts in place of the defaults:
// one Ubuntu 24.04 VPS at 203.0.113.7 with ufw on, keys only and nothing knocked yet
function seen_of(parts)
{
    return Object.assign({
        at: NOW,
        facts: facts({}),
        rows: [],
        firewall: {installed: true, active: true, defaults: {incoming: 'deny', outgoing: 'allow'}, rules: [{command: 'allow 22/tcp'}, {command: 'allow 80,443/tcp'}]},
        knocked: {addresses: ['203.0.113.7'], nat: false, skipped: null},
        errors: {facts: null, ports: null, firewall: null},
    }, parts);
}

function facts(parts)
{
    return Object.assign({
        root: true,
        os: {id: 'ubuntu', version: '24.04', name: 'Ubuntu 24.04.1 LTS', codename: 'noble', eol: '2029-05-31', eol_extended: '2034-04-25'},
        ssh: ssh({}),
        failures: {hours: 24, count: 0, addresses: 0, top: []},
        auto_updates: {installed: true, on: true, setting: '1'},
        docker: {ids: [], published: []},
    }, parts);
}

function ssh(parts)
{
    return Object.assign({installed: true, read: 'sshd -T', error: null, password: false, kbd_interactive: false, use_pam: true, root_login: 'prohibit-password', ports: [22]}, parts);
}

// A row of the Firewall tab, as firewall_ports makes it, on every address of a public machine
function row(port, proto, parts)
{
    const options = Object.assign({address: '0.0.0.0', reach: 'open', held: '', docker: null, verdict: verdict('open', 'let in'), knock: null}, parts);
    return {key: `${proto}|${port}`, port, proto, state: 'LISTEN', held: options.held, addresses: [options.address], docker: options.docker, reach: {exposure: options.reach, text: '', tone: ''}, verdict: options.verdict, knock: options.knock};
}

function verdict(kind, text)
{
    return {kind, text, rule: null, now: true, docker: false};
}

// A port nothing listens on: one the system handed out and took back
async function port_free()
{
    const server = net.createServer();
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const port = server.address().port;
    await new Promise(v => server.close(v));
    return port;
}

async function control(port, method, pathname)
{
    const answer = await fetch_host({port, host: '127.0.0.1', path: pathname, method});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + timeout_ms;
    for (;;) {
        if (ready()) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(25);
    }
}
