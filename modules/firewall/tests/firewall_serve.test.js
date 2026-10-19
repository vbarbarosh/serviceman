const assert = require('assert');
const child_process = require('child_process');
const firewall_serve = require('../server/firewall_serve');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');

// The fake by default; UFW=ufw runs the same tests against a real one, as root, on a machine
// whose firewall may be reset (a container with NET_ADMIN)
const UFW = process.env.UFW || path.join(__dirname, 'fake_ufw.js');

test('rules are added from the form, listed as ufw keeps them, and refused when wrong', async function (t) {
    const running = await serve(t);
    const empty = await call(running, 'GET', '/firewall');
    assert.deepStrictEqual(Object.assign({}, empty.body, {logging: null}), {installed: true, active: false, defaults: null, logging: null, rules: [], ssh_open: false});

    const ssh = await call(running, 'POST', '/firewall/rules', {action: 'allow', port: '22', proto: 'tcp'});
    assert.strictEqual(ssh.status, 200);
    assert.deepStrictEqual(ssh.body.rules.map(v => v.command), ['allow 22/tcp']);
    assert.strictEqual(ssh.body.ssh_open, true);

    await call(running, 'POST', '/firewall/rules', {action: 'allow', port: '5432', proto: 'tcp', from: '10.0.0.0/8', comment: 'db from the lan'});
    const ranged = await call(running, 'POST', '/firewall/rules', {action: 'deny', direction: 'in', port: '8000:8100', proto: 'udp'});
    assert.deepStrictEqual(ranged.body.rules.map(v => v.command), [
        'allow 22/tcp',
        'allow from 10.0.0.0/8 to any port 5432 proto tcp comment \'db from the lan\'',
        'deny 8000:8100/udp',
    ]);
    const db = ranged.body.rules[1];
    assert.deepStrictEqual([db.action, db.direction, db.port, db.proto, db.from, db.to, db.comment], ['allow', 'in', '5432', 'tcp', '10.0.0.0/8', 'any', 'db from the lan']);
    assert.deepStrictEqual([ranged.body.rules[2].port, ranged.body.rules[2].proto, ranged.body.rules[2].from], ['8000:8100', 'udp', 'any']);

    // Wrong input is said before ufw is asked; a rule it has already is said by ufw
    const refused = [
        [{action: 'open', port: '22'}, /an action is one of/],
        [{action: 'allow', port: '99999'}, /a port is a number from 1 to 65535/],
        [{action: 'allow', port: '80;reboot'}, /a port is a number/],
        [{action: 'allow', port: '80,443'}, /needs tcp or udp/],
        [{action: 'allow', port: '80', from: 'the office'}, /from is an address or a network/],
        [{action: 'allow', port: '80', comment: 'it\'s mine'}, /no '/],
    ];
    for (const [form, said] of refused) {
        const answer = await call(running, 'POST', '/firewall/rules', form);
        assert.strictEqual(answer.status, 400, JSON.stringify(form));
        assert.match(answer.body.error, said);
    }
    const again = await call(running, 'POST', '/firewall/rules', {action: 'allow', port: '22', proto: 'tcp'});
    assert.deepStrictEqual([again.status, again.body.error], [409, 'ufw has this rule already']);
    assert.strictEqual((await call(running, 'POST', '/firewall/rules', {command: '--force reset'})).status, 400, 'only a rule comes back through the list');
});

test('a rule is deleted by what it is, comes back with its undo, and one that changed is not touched', async function (t) {
    const running = await serve(t);
    await call(running, 'POST', '/firewall/rules', {action: 'limit', port: '22', proto: 'tcp'});
    await call(running, 'POST', '/firewall/rules', {action: 'allow', port: '5432', proto: 'tcp', from: '10.0.0.0/8', comment: 'db from the lan'});

    await call(running, 'POST', '/firewall/rules', {action: 'deny', port: '25', proto: 'tcp'});

    // From the middle: it comes back to the middle, for the first rule that matches wins
    const command = 'allow from 10.0.0.0/8 to any port 5432 proto tcp comment \'db from the lan\'';
    const gone = await call(running, 'POST', '/firewall/rules/delete', {command});
    assert.strictEqual(gone.status, 200);
    assert.deepStrictEqual(gone.body.rules.map(v => v.command), ['limit 22/tcp', 'deny 25/tcp']);
    assert.deepStrictEqual(gone.body.undo, {command, at: 2});
    const back = await call(running, 'POST', '/firewall/rules', gone.body.undo);
    assert.deepStrictEqual(back.body.rules.map(v => v.command), ['limit 22/tcp', command, 'deny 25/tcp']);

    // The last one: ufw adds nothing when asked to insert past the end, so it is added last
    const last = await call(running, 'POST', '/firewall/rules/delete', {command: 'deny 25/tcp'});
    assert.deepStrictEqual(last.body.undo, {command: 'deny 25/tcp', at: 3});
    const again = await call(running, 'POST', '/firewall/rules', last.body.undo);
    assert.deepStrictEqual(again.body.rules.map(v => v.command), ['limit 22/tcp', command, 'deny 25/tcp']);

    const missing = await call(running, 'POST', '/firewall/rules/delete', {command: 'allow 9/tcp'});
    assert.deepStrictEqual([missing.status, /the list has changed/.test(missing.body.error)], [409, true]);
});

test('the firewall is turned on and off, and says its defaults while it is on', async function (t) {
    const running = await serve(t);
    await call(running, 'POST', '/firewall/rules', {action: 'allow', port: '22', proto: 'tcp'});
    const on = await call(running, 'POST', '/firewall/enable');
    assert.strictEqual(on.status, 200);
    assert.deepStrictEqual([on.body.active, on.body.defaults.incoming, on.body.defaults.outgoing], [true, 'deny', 'allow']);
    assert.deepStrictEqual(on.body.rules.map(v => v.command), ['allow 22/tcp'], 'the list is the same on as off');
    const off = await call(running, 'POST', '/firewall/disable');
    assert.deepStrictEqual([off.body.active, off.body.defaults], [false, null]);
});

test('every shape of rule ufw lists is read into its parts', async function (t) {
    const added = [
        'Added user rules (see \'ufw status\' for running firewall):',
        'ufw allow 22/tcp',
        'ufw allow 53',
        'ufw deny out 25/tcp comment \'no mail out\'',
        'ufw allow in on eth0 to any port 80',
        'ufw allow OpenSSH',
        'ufw limit from 192.168.1.0/24 to any port 2222 proto tcp',
        'ufw allow from 2001:db8::/32 to any port 443 proto tcp comment \'v6, with a comma\'',
    ].join('\n');
    const running = await serve(t, v => ({ok: true, code: 0, stdout: (v[0] === 'show') ? added : 'Status: inactive\n', stderr: ''}));
    const rules = (await call(running, 'GET', '/firewall')).body.rules;
    const parts = rules.map(v => [v.action, v.direction, v.port, v.proto, v.app, v.from, v.on, v.comment]);
    assert.deepStrictEqual(parts, [
        ['allow', 'in', '22', 'tcp', null, 'any', null, null],
        ['allow', 'in', '53', null, null, 'any', null, null],
        ['deny', 'out', '25', 'tcp', null, 'any', null, 'no mail out'],
        ['allow', 'in', '80', null, null, 'any', 'eth0', null],
        ['allow', 'in', null, null, 'OpenSSH', 'any', null, null],
        ['limit', 'in', '2222', 'tcp', null, '192.168.1.0/24', null, null],
        ['allow', 'in', '443', 'tcp', null, '2001:db8::/32', null, 'v6, with a comma'],
    ]);
    assert.strictEqual((await call(running, 'GET', '/firewall')).body.ssh_open, true, 'OpenSSH lets ssh in');
});

test('the ports come from the host, as it reads them; a host that has none says so', async function (t) {
    const items = [{proto: 'tcp', address: '0.0.0.0', port: 22, state: 'LISTEN', users: [{name: 'sshd', pid: 1}]}];
    // ufw itself is not asked here
    function idle() {
        return {ok: true, code: 0, stdout: '', stderr: ''};
    }
    const running = await serve(t, idle, async () => ({items, commands: ['ss -tulpn']}));
    assert.deepStrictEqual((await call(running, 'GET', '/firewall/ports')).body, {items, commands: ['ss -tulpn']});
    const failing = await serve(t, idle, async function () {
        throw new Error('ui1 is not connected');
    });
    assert.deepStrictEqual(await call(failing, 'GET', '/firewall/ports'), {status: 502, body: {error: 'ui1 is not connected'}});
    const none = await serve(t, idle);
    assert.strictEqual((await call(none, 'GET', '/firewall/ports')).status, 501);
});

test('a machine without ufw, and one where sudo wants a password, say so', async function (t) {
    const missing = await serve(t, () => ({ok: false, code: -1, stdout: '', stderr: 'sudo: ufw: command not found'}));
    assert.deepStrictEqual((await call(missing, 'GET', '/firewall')).body.installed, false);
    const locked = await serve(t, () => ({ok: false, code: 1, stdout: '', stderr: 'sudo: a password is required'}));
    const answer = await call(locked, 'GET', '/firewall');
    assert.deepStrictEqual([answer.status, /give it a root agent/.test(answer.body.error)], [502, true]);
});

// The module under /firewall, over this machine's ufw: the fake with a state of its own, or the real
// one reset to nothing
async function serve(t, run, ports)
{
    const state = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ufw-')), 'state.json');
    if ((process.env.UFW !== undefined) && (run === undefined)) {
        child_process.execFileSync(UFW, ['--force', 'reset'], {stdio: 'ignore'});
    }
    const ufw = run || function (argv) {
        return new Promise(function (resolve) {
            child_process.execFile(UFW, argv, {env: Object.assign({}, process.env, {FAKE_UFW_STATE: state, LC_ALL: 'C'})}, function (error, stdout, stderr) {
                resolve({ok: (error === null), code: (error === null) ? 0 : error.code, stdout, stderr});
            });
        });
    };
    const server = http.createServer(function (req, res) {
        const pathname = new URL(req.url, 'http://test.invalid').pathname;
        firewall_serve(req, res, {run: ufw, ports, tail: pathname.slice('/firewall'.length)});
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => new Promise(v => server.close(v)));
    return {port: server.address().port};
}

function call(running, method, path, body)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({host: '127.0.0.1', port: running.port, method, path}, function (res) {
            const chunks = [];
            res.on('data', v => chunks.push(v));
            res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
        });
        req.on('error', reject);
        req.end((body === undefined) ? undefined : JSON.stringify(body));
    });
}
