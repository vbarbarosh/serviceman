const agent_package_versions = require('../src/agent/src/agent_package_versions');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const package_versions_from_status = require('../src/agent/src/package_versions_from_status');
const path = require('path');
const problems_check = require('../src/main/src/helpers/problems_check');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';

// dpkg's status file, the stanzas that matter: installed, held, a second architecture, kept for
// its config files only, caught half way
const STATUS = [
    'Package: bash\nStatus: install ok installed\nPriority: required\nArchitecture: amd64\nVersion: 5.2.21-2ubuntu4\nDescription: GNU Bourne Again SHell',
    'Package: php8.3-cli\nStatus: hold ok installed\nArchitecture: amd64\nVersion: 8.3.6-0ubuntu0.24.04.12',
    'Package: libc6\nStatus: install ok installed\nArchitecture: amd64\nVersion: 2.39-0ubuntu8.6',
    'Package: libc6\nStatus: install ok installed\nArchitecture: i386\nVersion: 2.39-0ubuntu8.5',
    'Package: old-tool\nStatus: deinstall ok config-files\nArchitecture: amd64\nVersion: 1.0-1',
    'Package: half-done\nStatus: install reinstreq half-installed\nArchitecture: amd64\nVersion: 2.0-1',
].join('\n\n');

test('the agent says what is installed from dpkg\'s own file, and the kernel running', function () {
    assert.deepStrictEqual(package_versions_from_status(STATUS), {'bash': '5.2.21-2ubuntu4', 'php8.3-cli': '8.3.6-0ubuntu0.24.04.12', 'libc6': '2.39-0ubuntu8.6'});
    assert.deepStrictEqual(package_versions_from_status(''), {});

    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-packages-'));
    try {
        fs.mkdirSync(path.join(base, 'etc'));
        fs.writeFileSync(path.join(base, 'etc', 'os-release'), 'PRETTY_NAME="Ubuntu 24.04.5 LTS"\nID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n');
        const bare = agent_package_versions({security_root_dir: base, kernel_release: '6.8.0-147-generic'});
        assert.deepStrictEqual(bare, {os: {id: 'ubuntu', version: '24.04', name: 'Ubuntu 24.04.5 LTS', codename: 'noble'}, kernel: '6.8.0-147-generic', packages: null}, 'no dpkg: no packages, said as none');
        fs.mkdirSync(path.join(base, 'var', 'lib', 'dpkg'), {recursive: true});
        fs.writeFileSync(path.join(base, 'var', 'lib', 'dpkg', 'status'), STATUS);
        const read = agent_package_versions({security_root_dir: base});
        assert.deepStrictEqual([read.kernel, Object.keys(read.packages).length], [os.release(), 3]);
    }
    finally {
        fs.rmSync(base, {recursive: true, force: true});
    }
});

// The whole way, on this computer's own agent: its look holds what it runs against a list of
// Ubuntu's, the Security page's column and the machine's tab say what was found, Health has a
// problem for the new ones and one for the fix that is out, and closing the bar on them makes
// them seen for every page
test('a machine\'s CVEs are found by its look, shown in its column and tab, and are problems until seen or mended', async function (t) {
    const here = agent_package_versions({});
    if ((here.os === null) || (here.os.id !== 'ubuntu') || (here.packages === null) || (here.packages.bash === undefined)) {
        t.skip('this computer is no Ubuntu with bash: the agent here has nothing to hold against a list');
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-vulnerabilities-'));
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'vu1', token: TOKEN}], services: []}, __dirname);
    const app = app_from_config(config);
    app.state_dir = dir;
    // Ubuntu is not asked from a test: its list is the one written here, its pages do not answer
    const asked = [];
    app.vulnerabilities_fetch = async function (url) {
        asked.push(url);
        return new Response('', {status: 503});
    };
    const kernel = here.kernel.replace(/[.\-+]/g, v => `\\${v}`);
    fs.mkdirSync(path.join(dir, 'vulnerabilities'));
    fs.writeFileSync(path.join(dir, 'vulnerabilities', `${here.os.codename}.json`), JSON.stringify({
        codename: here.os.codename, url: 'https://security-metadata.canonical.com/oval/x', checked_at: Date.now(), modified: null, generated: '2026-11-06T11:09:56', error: null,
        cves: [
            {id: 'CVE-2026-0001', score: 9.8, published: '2026-11-01', description: 'bash runs what it should not.', url: 'https://ubuntu.com/security/CVE-2026-0001', when: {any: [{packages: ['bash'], below: `${here.packages.bash}.1`, source: 'bash'}]}},
            {id: 'CVE-2026-0002', score: 9.1, published: '2026-10-15', description: 'The kernel frees too early.', url: 'https://ubuntu.com/security/CVE-2026-0002', when: {any: [{kernel_running: kernel, flavour: 'linux'}]}},
            {id: 'CVE-2026-0003', score: 9.0, published: '2026-10-01', description: 'Not installed here.', url: 'https://ubuntu.com/security/CVE-2026-0003', when: {any: [{packages: ['no-such-package-here'], below: null, source: 'none'}]}},
        ],
    }));
    const servers = await server_start(app);
    const control_port = servers.control.address().port;
    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', TOKEN, '--ufw', '/nowhere/ufw'], {stdio: ['ignore', 'ignore', 'ignore'], env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(dir, 'agent')})});
    try {
        const remote = app.remote_by_name.vu1;
        await wait_until(() => (remote.state.phase === 'online') && (remote.state.resources !== null) && remote.state.resources.can.includes('package_versions'), 15000);
        await control(control_port, 'POST', '/api/v1/security/check');
        await wait_until(() => app.security.seen.has('vu1') && (app.security.running.size === 0), 60000);

        const look = app.security.seen.get('vu1').vulnerabilities;
        assert.deepStrictEqual([look.reason, look.codename, look.kernel], [null, here.os.codename, here.kernel]);
        assert.deepStrictEqual(look.items.map(v => [v.id, v.state]), [['CVE-2026-0001', 'fix_out'], ['CVE-2026-0002', 'no_fix']]);

        // The Security page's column: red, a fix out for bash, both new
        const row = (await control(control_port, 'GET', '/api/v1/security')).body.rows.find(v => v.remote === 'vu1');
        const column = row.checks.find(v => v.key === 'vulnerabilities');
        assert.deepStrictEqual([column.state, column.text, column.tab], ['bad', 'fix out · bash · 2 new', 'vulnerabilities']);
        assert.match(column.detail, /^CVE-2026-0001 · 9\.8 · bash · fixed in .*: install the updates .* · new$/m);
        assert.match(column.detail, /Held against Ubuntu's list of critical CVEs for \w+, written 2026-11-06 11:09 UTC, running kernel /);

        // The machine's tab, through the module's API
        const tab = await control(control_port, 'GET', '/api/v1/remotes/vu1/vulnerabilities');
        assert.strictEqual(tab.status, 200);
        assert.deepStrictEqual(tab.body.items.map(v => [v.id, v.what, v.new]), [['CVE-2026-0001', 'bash', true], ['CVE-2026-0002', 'kernel', true]]);
        assert.strictEqual(tab.body.items[1].fix, 'no fix yet');
        assert.strictEqual((await control(control_port, 'GET', '/api/v1/remotes/vu1/vulnerabilities/other')).status, 404);
        await wait_until(() => asked.includes('https://ubuntu.com/security/cves/CVE-2026-0002.json'), 5000);
        assert.ok(asked.every(v => v.startsWith('https://ubuntu.com/security/cves/')), 'the list was not asked for: it was fresh');
        assert.ok(asked.includes('https://ubuntu.com/security/cves/CVE-2026-0001.json') === false, 'Ubuntu\'s page is asked only of a CVE with no fix');

        // Health: a problem for the new ones and one for the fix out, shown once seen twice
        await problems_check(app);
        for (const item of app.problems.values()) {
            item.first_seen -= 60000;
        }
        await problems_check(app);
        const shown = Array.from(app.problems.values()).filter(v => v.shown && (v.kind === 'vulnerability'));
        assert.deepStrictEqual(shown.map(v => [v.key, v.subject, v.cause]).sort(), [
            ['vulnerability_fix:vu1', 'A fix is out for CVE-2026-0001 in bash on vu1', `fixed in ${here.packages.bash}.1: install the updates (bash has ${here.packages.bash})`],
            ['vulnerability_new:vu1', 'New critical vulnerability on vu1: CVE-2026-0002 in kernel', 'CVE-2026-0002 (kernel, 9.1): Ubuntu has no fix out for it yet.'],
        ], 'a new one with a fix out is said once, as the fix');
        assert.ok(app.log_lines.some(v => /\[problem_begin\] remote=vu1 subject="New critical vulnerability on vu1: CVE-2026-0002 in kernel"/.test(v)), 'a new one is in the log');

        // The bar closed on them: seen for every page; the fix out stays a problem
        const seen = await control(control_port, 'POST', '/api/v1/vulnerabilities/seen', {remotes: ['vu1', 'nobody']});
        assert.deepStrictEqual([seen.status, seen.body.seen], [200, ['vu1']]);
        assert.strictEqual((await control(control_port, 'POST', '/api/v1/vulnerabilities/seen', {remotes: 'vu1'})).status, 400);
        await problems_check(app);
        assert.deepStrictEqual(Array.from(app.problems.keys()).filter(v => v.startsWith('vulnerability_')), ['vulnerability_fix:vu1']);
        const after = (await control(control_port, 'GET', '/api/v1/security')).body.rows.find(v => v.remote === 'vu1').checks.find(v => v.key === 'vulnerabilities');
        assert.strictEqual(after.text, 'fix out · bash', 'nothing new any more');
        const kept = JSON.parse(fs.readFileSync(path.join(dir, 'vulnerabilities.json'), 'utf8'));
        assert.deepStrictEqual(Object.keys(kept.found.vu1).sort(), ['CVE-2026-0001', 'CVE-2026-0002']);
        assert.ok(kept.found.vu1['CVE-2026-0001'].fix_at !== null, 'since when its fix is out is kept');
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
        await timers.setTimeout(100);
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// A machine that is not Ubuntu, or whose agent is from before, is said so in grey
test('a machine that cannot be judged is grey in the column, and says why', function () {
    const security_checks = require('../src/main/src/helpers/security_checks');
    function cves(reason) {
        return {at: 1, reason, codename: null, kernel: null, list: null, counts: {fix_out: 0, restart: 0, pro: 0, no_fix: 0, new: 0}, items: null};
    }
    function check_of(view) {
        return security_checks({rows: [], errors: {facts: 'x', ports: 'x', firewall: 'x'}, facts: null, firewall: null, knocked: {addresses: [], nat: false, skipped: 'x'}}, null, 0, view).find(v => v.key === 'vulnerabilities');
    }
    const debian = check_of(cves('only Ubuntu is checked, as Ubuntu\'s own list says it; this is Debian GNU/Linux 12 (bookworm)'));
    assert.deepStrictEqual([debian.state, debian.text], ['none', 'Ubuntu only']);
    const old = check_of(cves('its agent is from before this check; it updates itself, and is checked again within the hour'));
    assert.deepStrictEqual([old.state, old.text], ['none', 'not read']);
    assert.match(old.detail, /its agent is from before this check/);
    const clean = check_of({at: 1, reason: null, codename: 'noble', kernel: '6.8.0-149-generic', list: {generated: '2026-11-06T11:09:56', error: null}, counts: {fix_out: 0, restart: 0, pro: 0, no_fix: 0, new: 0}, items: []});
    assert.deepStrictEqual([clean.state, clean.text, clean.tab], ['ok', 'none', null]);
});

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
        await timers.setTimeout(50);
    }
}
