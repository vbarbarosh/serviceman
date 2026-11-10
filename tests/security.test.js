const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const link_read = require('../src/helpers/link_read');
const link_send_message = require('../src/helpers/link_send_message');
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
const TOKEN2 = 'fedcba9876543210fedcba9876543210';
const NOW = Date.parse('2026-10-27T18:00:00Z');
const KEYS = ['open', 'firewall', 'ssh', 'updates', 'auto', 'system', 'vulnerabilities'];

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
        vulnerabilities: ['none', 'not read', null],
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
    assert.deepStrictEqual(checks.map(v => [v.state, v.text]), [['ok', '22 · 443 · 80'], ['ok', 'on'], ['ok', 'keys only'], ['ok', 'up to date'], ['ok', 'on'], ['ok', '24.04'], ['none', 'not read']]);
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
    assert.deepStrictEqual(older.map(v => [v.state, v.text]), [['none', 'not read'], ['none', 'cannot ask'], ['none', 'not read'], ['none', 'not counted'], ['none', 'not read'], ['none', 'not read'], ['none', 'not read']]);
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

// A machine's answer is its agent's word, and an agent of another version's shape, or one gone
// hostile, may leave a part out or put something else in its place. Such a part is grey as one
// that could not be asked is, says so, and nothing is guessed from it: not keys only, not on,
// not supported. What the agent means by null (no apt, no /etc/os-release) stays its own word.
test('a part the answer lacks, or has as something else, is grey and says so, and no check is thrown', function () {
    const whole = security_checks(seen_of({}), null, NOW).map(v => [v.state, v.text]);
    for (const wrong of [undefined, 5, 'on', true, [], {}]) {
        for (const part of ['ssh', 'auto_updates', 'os']) {
            const checks = security_checks(seen_of({facts: facts({[part]: wrong})}), null, NOW);
            const found = checks[{ssh: 2, auto_updates: 4, os: 5}[part]];
            assert.deepStrictEqual([found.state, found.text, found.detail, found.tab, found.mend], ['none', 'not read', unread(part), null, null], `${part}: ${JSON.stringify(wrong)}`);
            assert.strictEqual(checks.filter((v, i) => v.state !== whole[i][0]).length, 1, 'the other checks say what they said');
        }
        // What only adds a line to a check, or a button: the check stands, the line says why not
        for (const part of ['root', 'failures', 'sign_ins', 'own_file', 'docker', 'firewall']) {
            const checks = security_checks(seen_of({can_mend: true, rows: [row(22, 'tcp', {knock: 'answered'})], facts: facts({ssh: ssh({password: true}), [part]: wrong})}), null, NOW);
            assert.deepStrictEqual(checks.map(v => v.state), ['ok', 'ok', 'bad', 'none', 'ok', 'ok', 'none'], `${part}: ${JSON.stringify(wrong)}`);
        }
    }
    const empty = security_checks(seen_of({facts: {}}), null, NOW);
    assert.deepStrictEqual(empty.map(v => [v.state, v.text]), [['ok', 'nothing'], ['ok', 'on'], ['none', 'not read'], ['none', 'not counted'], ['none', 'not read'], ['none', 'not read'], ['none', 'not read']]);
    assert.deepStrictEqual(security_checks(seen_of({facts: facts({ssh: null})}), null, NOW)[2].detail, unread('ssh'));
    const meant = security_checks(seen_of({facts: facts({auto_updates: null, os: null})}), null, NOW);
    assert.deepStrictEqual([meant[4].text, meant[5].text], ['not apt', 'not known'], 'null is the agent\'s word for a machine with none');

    // sshd read, yet no word on passwords; a release whose last day is no day
    const silent = security_checks(seen_of({facts: facts({ssh: {installed: true, read: 'files'}, os: {id: 'ubuntu', version: '24.04', name: 'Ubuntu 24.04', eol: 'soon'}})}), null, NOW);
    assert.deepStrictEqual([silent[2].state, silent[2].text, silent[5].state, silent[5].text], ['none', 'not read', 'none', 'not read']);

    // Passwords on, and counts that are no counts: the check is red all the same, each count says why not
    for (const wrong of [5, 'on', true, [], {}, {count: 3}, {users: 5}]) {
        const found = security_checks(seen_of({can_mend: true, facts: facts({ssh: ssh({password: true}), failures: wrong, sign_ins: wrong})}), null, NOW)[2];
        assert.deepStrictEqual([found.state, found.text, found.mend.confirm], ['bad', 'passwords on', null], JSON.stringify(wrong));
        assert.ok(found.detail.includes(`\nFailed sign-in tries not counted: ${unread('failures')}\nSign-ins not counted: ${unread('sign_ins')}\n`), found.detail);
    }

    function unread(part) {
        return `its agent's answer has no ${part} part this check can read`;
    }
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
    // Ubuntu's CVE list is not asked from a test: tests/vulnerabilities.test.js gives it one
    app.vulnerabilities_fetch = async function () {
        return new Response('', {status: 404});
    };
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
        fs.rmSync(path.join(app.state_dir, 'vulnerabilities'), {recursive: true, force: true});
        fs.rmSync(path.join(app.state_dir, 'vulnerabilities.json'), {force: true});
    }
});

// A machine whose agent answers the security check with something else than its facts: an
// agent of another version's shape, or one gone hostile. serviceman kept that answer and made
// the page's checks of it with every status asked, so one such machine cost every machine its
// status, and went on costing it after the machine had left, until serviceman was restarted.
test('a machine that answers the security check with something else is not read, and the status goes on for every machine', async function (t) {
    const running = await serviceman_start(t);
    const not_facts = 'its agent answered the security check with something that is not its facts';
    const no_part = 'its agent\'s answer has no ssh part this check can read';
    const said = {methods: ['security'], value: {}};
    const socket = await agent_fake(running.control_port, said);
    t.after(() => socket.destroy());
    const remote = running.app.remote_by_name.vps1;
    await wait_until(() => remote.state.phase === 'online', 5000);
    const shapes = [{value: {}, why: no_part}, {value: null, why: not_facts}, {value: 'on', why: not_facts}, {value: 5, why: not_facts}, {value: [], why: not_facts}, {value: undefined, why: not_facts}, {value: {ssh: 5}, why: no_part}, {value: {ssh: null, firewall: 'on'}, why: no_part}];
    for (const shape of shapes) {
        const checks = await checks_looked(shape.value);
        assert.deepStrictEqual(checks.filter(v => ['ssh', 'auto', 'system'].includes(v.key)).map(v => [v.state, v.text]), [['none', 'not read'], ['none', 'not read'], ['none', 'not read']], JSON.stringify(shape.value));
        assert.strictEqual(checks.find(v => v.key === 'ssh').detail, shape.why, JSON.stringify(shape.value));
    }
    // Its port list answered so too: no list of ports is ports not read, never no port open
    said.methods.push('port_list');
    for (const value of [{}, null, 'on', undefined]) {
        const open = (await checks_looked(value)).find(v => v.key === 'open');
        assert.deepStrictEqual([open.state, open.text, open.detail], ['none', 'not read', 'Its ports could not be read: its agent answered the port list with something that is not its ports'], JSON.stringify(value));
    }
    // The machine leaves: its last look stays, and so does everybody's status
    socket.destroy();
    await wait_until(() => remote.state.phase === 'offline', 5000);
    const after = await answer_read(running, '/api/v1/status');
    assert.deepStrictEqual(after.security.rows.map(v => [v.remote, v.phase, v.checks.length]), [['vps1', 'offline', 7], ['vps2', 'offline', 0]]);
    assert.deepStrictEqual(running.app.log_lines.filter(v => /\[(serviceman_error|security_view_error|security_check_error)\]/.test(v)), []);

    // vps1 looked at again while its agent answers with this, as the status then shows it
    async function checks_looked(value) {
        const before = running.app.security.seen.get('vps1');
        said.value = value;
        await control(running.control_port, 'POST', '/api/v1/security/check');
        await wait_until(() => (running.app.security.seen.get('vps1') !== before) && (running.app.security.running.size === 0), 5000);
        const rows = (await answer_read(running, '/api/v1/status')).security.rows;
        assert.deepStrictEqual(rows.map(v => [v.remote, v.error, v.checks.length]), [['vps1', null, 7], ['vps2', null, 0]], JSON.stringify(value));
        return rows[0].checks;
    }
});

// A look the checks still cannot be made of, for a reason nobody foresaw, costs that machine its
// row and nobody else anything. It is said once in the log, however often the status is asked,
// and kept as a look that broke: the next look takes its place, not a restart.
test('a look no checks can be made of costs that machine its row, and is said once in the log', async function (t) {
    const running = await serviceman_start(t);
    const app = running.app;
    app.security.seen.set('vps1', seen_of({rows: null}));
    app.security.seen.set('vps2', seen_of({}));
    const why = 'what it answered could not be read: Cannot read properties of null (reading \'filter\')';
    for (const pathname of ['/api/v1/status', '/api/v1/status', '/api/v1/security', '/api/v1/status']) {
        const answer = await answer_read(running, pathname);
        const rows = (pathname === '/api/v1/status') ? answer.security.rows : answer.rows;
        assert.deepStrictEqual(rows.map(v => [v.remote, v.at, v.state, v.error, v.checks.length]), [['vps2', NOW, 'ok', null, 7], ['vps1', NOW, 'none', why, 0]]);
    }
    assert.deepStrictEqual(app.log_lines.filter(v => v.includes('[security_view_error]')).map(v => v.replace(/^.*\[security_view_error\] /, '')), ['remote=vps1 reason="Cannot read properties of null (reading \'filter\')"']);
    assert.deepStrictEqual(app.security.seen.get('vps1'), {at: NOW, error: why}, 'kept as a look that broke');

    // Parts whose insides are something else, down to what no check names: never the status
    const inside = [null, 5, 'on', [null], {users: [null], top: [null], count: 1, addresses: 1}, {users: [5], top: [5], count: 1, addresses: 1, days: {}, hours: []}];
    for (const wrong of inside) {
        for (const part of ['root', 'os', 'ssh', 'failures', 'sign_ins', 'own_file', 'auto_updates', 'docker']) {
            app.security.seen.set('vps1', seen_of({can_mend: true, facts: facts({ssh: ssh({password: true}), [part]: wrong})}));
            const answer = await answer_read(running, '/api/v1/security');
            assert.strictEqual(answer.rows.find(v => v.remote === 'vps2').checks.length, 7, `${part}: ${JSON.stringify(wrong)}`);
        }
    }
});

// A click mends what the machine's root half can: ssh's passwords off, asking first where
// someone came in only by password; passwords on again where the page's own file turned them
// off; automatic updates on. An agent from before, or no root half, opens the tab instead.
test('a check its root half can mend has a button, one it cannot opens the tab that mends it', function () {
    const sign_ins = {days: 30, users: [{user: 'admin', key: 47, password: 0, other: 0}, {user: 'deploy', key: 0, password: 3, other: 0}], more: 0};
    const open = security_checks(seen_of({can_mend: true, facts: facts({ssh: ssh({password: true}), sign_ins, auto_updates: {installed: false, on: false, setting: null}})}), null, NOW);
    const ssh_open = open.find(v => v.key === 'ssh');
    assert.deepStrictEqual([ssh_open.state, ssh_open.tab, ssh_open.mend.key, ssh_open.mend.label], ['bad', null, 'ssh_passwords_off', 'Turn passwords off']);
    assert.match(ssh_open.detail, /\nSigned in over the last 30 days: admin: 47 by key; deploy: 3 by password\.\nTurn passwords off: PasswordAuthentication no and KbdInteractiveAuthentication no in \/etc\/ssh\/sshd_config\.d\/00-no-passwords\.conf/);
    assert.strictEqual(ssh_open.mend.confirm, 'deploy signed in with a password in the last 30 days and never with a key: ssh will shut them out. serviceman\'s Shell stays open. Turn passwords off?');
    const auto = open.find(v => v.key === 'auto');
    assert.deepStrictEqual([auto.state, auto.tab, auto.mend.key, auto.mend.label], ['warn', null, 'auto_updates_on', 'Turn on']);

    const keys = security_checks(seen_of({can_mend: true, facts: facts({ssh: ssh({password: true}), sign_ins: {days: 30, users: [{user: 'admin', key: 47, password: 0, other: 0}], more: 0}})}), null, NOW);
    assert.strictEqual(keys.find(v => v.key === 'ssh').mend.confirm, null, 'nobody is shut out: no question');

    const shut = security_checks(seen_of({can_mend: true, facts: facts({own_file: true})}), null, NOW).find(v => v.key === 'ssh');
    assert.deepStrictEqual([shut.state, shut.text, shut.mend.key, shut.mend.label], ['ok', 'keys only', 'ssh_passwords_on', 'Allow passwords again']);
    assert.match(shut.detail, /Passwords are off by \/etc\/ssh\/sshd_config\.d\/00-no-passwords\.conf, the file Turn passwords off writes\.$/);
    assert.strictEqual(security_checks(seen_of({can_mend: true}), null, NOW).find(v => v.key === 'ssh').mend, null, 'keys only by another file: nothing to undo');

    const older = security_checks(seen_of({can_mend: false, facts: facts({ssh: ssh({password: true})})}), null, NOW).find(v => v.key === 'ssh');
    assert.deepStrictEqual([older.tab, older.mend], ['shell', null]);
    assert.match(older.detail, /By hand, in its Shell \(its agent is from before a click mends it\): PasswordAuthentication no/);
    const rootless = security_checks(seen_of({can_mend: true, facts: facts({root: false, ssh: ssh({password: true}), auto_updates: {installed: true, on: false, setting: '0'}})}), null, NOW);
    assert.deepStrictEqual(rootless.filter(v => v.mend !== null), [], 'no root half: nothing to click');
    assert.match(rootless.find(v => v.key === 'ssh').detail, /\(a click needs the root agent, and it has none\)/);
});

// The mend is refused for a mend it does not know and a machine it does not have; a machine
// with no root half says so, the refusal is logged, and the machine is not left marked as mended
test('a mend is refused for what it does not know, and a machine with no root half says why', async function () {
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'ui1', token: TOKEN}], services: []}, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const control_port = servers.control.address().port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-security-'));
    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', TOKEN, '--root-socket', path.join(dir, 'no-root.sock'), '--ufw', '/nowhere/ufw'], {stdio: ['ignore', 'ignore', 'ignore']});
    try {
        const remote = app.remote_by_name.ui1;
        await wait_until(() => (remote.state.phase === 'online') && (remote.state.resources !== null) && remote.state.resources.can.includes('security_mend'), 15000);
        const unknown = await control(control_port, 'POST', '/api/v1/security/mend', {remote: 'ui1', mend: 'rm -rf /'});
        assert.deepStrictEqual([unknown.status, unknown.body.error], [400, 'mend is one of ssh_passwords_off, ssh_passwords_on, auto_updates_on']);
        const nobody = await control(control_port, 'POST', '/api/v1/security/mend', {remote: 'ghost', mend: 'ssh_passwords_off'});
        assert.deepStrictEqual([nobody.status, nobody.body.error], [404, 'no remote named "ghost"']);
        const rootless = await control(control_port, 'POST', '/api/v1/security/mend', {remote: 'ui1', mend: 'ssh_passwords_off'});
        assert.deepStrictEqual([rootless.status, rootless.body.error], [502, 'remote ui1: a click mends this only through the root agent, and this machine has none; its page says how to install it, or its Shell does it by hand']);
        assert.strictEqual(app.security.mending.size, 0);
        assert.ok(app.log_lines.some(v => /\[security_mend_error\] remote=ui1 mend=ssh_passwords_off reason=/.test(v)), 'the refusal is in the log');
    }
    finally {
        agent.kill('SIGKILL');
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

// A serviceman of two machines, vps1 and vps2, neither dialled in yet; closed with the test
async function serviceman_start(t)
{
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}], services: []}, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    t.after(function () {
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
    });
    return {app, control_port: servers.control.address().port};
}

// What a GET of the control page's answers with. Where serviceman broke on it, the test fails
// on what serviceman's log says of it.
async function answer_read(running, pathname)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: pathname});
    const broke = running.app.log_lines.filter(v => v.includes('[serviceman_error]')).map(v => v.replace(/^.*\[serviceman_error\] /, ''));
    assert.strictEqual(answer.status, 200, `GET ${pathname}: ${broke[broke.length - 1]}`);
    return JSON.parse(answer.body);
}

// vps1's agent played by hand: it dials in, says hello as an agent that can be asked `security`
// and `port_list` and nothing else, and answers those of them `said.methods` names with what
// `said.value` holds by then, whatever it is (undefined is an answer with no value at all), and
// anything else with a refusal. Answers its end of the link.
function agent_fake(port, said)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({host: '127.0.0.1', port, path: '/api/v1/remote', headers: {connection: 'Upgrade', upgrade: 'serviceman', authorization: `Bearer ${TOKEN}`}});
        request.on('upgrade', function (answer, socket) {
            link_read(socket, function (kind, body) {
                const message = (kind === 'm') ? JSON.parse(body.toString('utf8')) : {};
                if (message.type === 'call') {
                    link_send_message(socket, said.methods.includes(message.method) ? {type: 'reply', id: message.id, ok: true, value: said.value} : {type: 'reply', id: message.id, ok: false, error: `no ${message.method} here`});
                }
            });
            socket.on('error', function () {});
            link_send_message(socket, {
                type: 'hello',
                agent: '1.33.1',
                resources: {hostname: 'vps1', platform: 'linux', arch: 'x64', node: process.version, docker: null, can: ['security', 'port_list'], addresses: [], cpu: {count: 1, model: 'cpu'}, mem: {total: 1024*1024*1024}, disk: {path: '/', total: 1024*1024*1024, free: 1024*1024}},
                stats: {mem_free: 1024*1024, disk_free: 1024*1024, uptime_ms: 1000, load: 0},
            });
            resolve(socket);
        });
        request.on('error', reject);
        request.end();
    });
}

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

async function control(port, method, pathname, body)
{
    const answer = await fetch_host({port, host: '127.0.0.1', path: pathname, method, body: (body === undefined) ? undefined : JSON.stringify(body), headers: (body === undefined) ? {} : {'content-type': 'application/json'}});
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
