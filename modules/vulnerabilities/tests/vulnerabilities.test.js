const assert = require('assert');
const debian_version_compare = require('../server/debian_version_compare');
const fs = require('fs');
const http = require('http');
const os = require('os');
const oval_critical_reader = require('../server/oval_critical_reader');
const oval_fixture = require('./oval_fixture');
const path = require('path');
const test = require('node:test');
const vulnerabilities_feed = require('../server/vulnerabilities_feed');
const vulnerabilities_items = require('../server/vulnerabilities_items');
const vulnerabilities_match = require('../server/vulnerabilities_match');
const vulnerabilities_serve = require('../server/vulnerabilities_serve');

// The fixture read as the module reads Ubuntu's file: a line at a time
function cves_of(text)
{
    const reader = oval_critical_reader();
    for (const line of text.split('\n')) {
        reader.line(line);
    }
    return reader.end();
}

// A machine on 24.04 as its agent says it: the kernel running, and the packages installed
const PACKAGES = {'php8.3-cli': '8.3.6-0ubuntu0.24.04.12', 'libfoo1': '1.0-1', 'gstreamer1.0-plugins-bad': '1.24.2-1ubuntu4', 'openssl': '3.0.13-0ubuntu3', 'bash': '5.2.21-2ubuntu4'};

test('versions compare as dpkg compares them: the epoch, then letters and digits in turn, a tilde first', function () {
    const cases = [
        ['1.0~rc1', '1.0', -1], ['1:2.0', '3.0', 1], ['6.8.0-147', '6.8.0-149', -1], ['1.2.10', '1.2.9', 1],
        ['8.3.6-0ubuntu0.24.04.12', '8.3.6-0ubuntu0.24.04.13', -1], ['1.24.2-1ubuntu4', '1.24.2-1ubuntu4+esm1', -1],
        ['1.0a', '1.0', 1], ['1.0-1', '1.0', 1], ['1~~', '1~~a', -1], ['2.47-1ubuntu0.24.04.1', '2.47-1ubuntu0.24.04.1', 0],
    ];
    for (const [a, b, want] of cases) {
        assert.strictEqual(debian_version_compare(a, b), want, `${a} against ${b}`);
        assert.strictEqual(debian_version_compare(b, a), (want === 0) ? 0 : -want, `${b} against ${a}`);
    }
});

test('only the critical CVEs are kept, each with the tree of what it asks of the machine', function () {
    const found = cves_of(oval_fixture());
    assert.strictEqual(found.generated, '2026-11-06T11:09:56');
    assert.deepStrictEqual(found.cves.map(v => v.id), ['CVE-2026-0002', 'CVE-2026-0001', 'CVE-2026-0003', 'CVE-2026-0004', 'CVE-2026-0005'], 'newest first; the high one and the one of an unknown test are left out');
    const php = found.cves.find(v => v.id === 'CVE-2026-0001');
    assert.deepStrictEqual([php.score, php.published, php.url], [9.2, '2026-10-21', 'https://ubuntu.com/security/CVE-2026-0001']);
    assert.strictEqual(php.description, 'PHP frees request memory early & reads it after.', 'Canonical\'s doubled escapes read');
    assert.deepStrictEqual(php.when, {all: [true, {any: [{packages: ['php8.3', 'php8.3-cli', 'php8.3-common'], below: '8.3.6-0ubuntu0.24.04.13', source: 'php8.3'}]}]});
    assert.deepStrictEqual(found.cves.find(v => v.id === 'CVE-2026-0002').when.all[1].any[0], {packages: ['libfoo1', 'foo-tools'], below: null, source: 'foo'});
    assert.deepStrictEqual(found.cves.find(v => v.id === 'CVE-2026-0004').when.all[1].any[0], {all: [{kernel_running: '6\\.8\\.0\\-\\d+(\\-generic|\\-generic\\-64k)', flavour: 'linux'}, {kernel_below: '0:6.8.0-149', flavour: 'linux'}]});
    assert.strictEqual(found.cves.find(v => v.id === 'CVE-2026-0005').score, null, 'a CVE with no score says none');
});

test('a machine is hit where a package is under the fix or has none, and the kernel running is', function () {
    const cves = cves_of(oval_fixture()).cves;
    const hit = vulnerabilities_match(cves, {kernel: '6.8.0-147-generic', packages: PACKAGES});
    const by = Object.fromEntries(hit.map(v => [v.id, v.state]));
    assert.deepStrictEqual(by, {'CVE-2026-0002': 'no_fix', 'CVE-2026-0001': 'fix_out', 'CVE-2026-0003': 'no_fix', 'CVE-2026-0004': 'fix_out', 'CVE-2026-0005': 'pro'});
    assert.deepStrictEqual(hit.find(v => v.id === 'CVE-2026-0001').hits, [{kind: 'package', name: 'php8.3-cli', source: 'php8.3', installed: '8.3.6-0ubuntu0.24.04.12', fixed: '8.3.6-0ubuntu0.24.04.13'}]);
    assert.deepStrictEqual(hit.find(v => v.id === 'CVE-2026-0003').hits, [{kind: 'kernel', flavour: 'linux', running: '6.8.0-147-generic', fixed: null, installed: null}], 'one kernel hit, linux before linux-riscv');
    assert.deepStrictEqual(hit.find(v => v.id === 'CVE-2026-0004').hits, [{kind: 'kernel', flavour: 'linux', running: '6.8.0-147-generic', fixed: '6.8.0-149', installed: false}]);

    // The fixed php in, the fixed kernel installed and not running yet
    const later = vulnerabilities_match(cves, {kernel: '6.8.0-147-generic', packages: Object.assign({}, PACKAGES, {'php8.3-cli': '8.3.6-0ubuntu0.24.04.13', 'linux-image-6.8.0-149-generic': '6.8.0-149.149'})});
    assert.deepStrictEqual(later.map(v => [v.id, v.state]), [['CVE-2026-0002', 'no_fix'], ['CVE-2026-0003', 'no_fix'], ['CVE-2026-0004', 'restart'], ['CVE-2026-0005', 'pro']]);

    // Restarted into it: the fixed kernel no longer counts; another release's kernel matches none
    const restarted = vulnerabilities_match(cves, {kernel: '6.8.0-149-generic', packages: {}});
    assert.deepStrictEqual(restarted.map(v => v.id), ['CVE-2026-0003']);
    assert.deepStrictEqual(vulnerabilities_match(cves, {kernel: '6.17.0-5-generic', packages: {}}), []);
    assert.deepStrictEqual(vulnerabilities_match(cves, {kernel: '', packages: {}}), [], 'a kernel not said hits nothing');
});

test('each CVE says what it hits and what mends it, what can be mended first, the new marked', function () {
    const cves = cves_of(oval_fixture()).cves;
    const matched = vulnerabilities_match(cves, {kernel: '6.8.0-147-generic', packages: PACKAGES});
    const notes = {'CVE-2026-0003': {mitigation: 'Drop IPv4 packets with IP options.', pending: {noble: {linux: '6.8.0-149.149'}}}};
    const found = {'CVE-2026-0001': {at: 1000, fix_at: 1000}, 'CVE-2026-0002': {at: 3000, fix_at: null}, 'CVE-2026-0003': {at: 1000, fix_at: null}};
    const items = vulnerabilities_items(matched, {codename: 'noble', found, seen_at: 2000, notes: v => notes[v] || null});
    assert.deepStrictEqual(items.map(v => [v.id, v.state, v.what, v.new]), [
        ['CVE-2026-0001', 'fix_out', 'php8.3', false],
        ['CVE-2026-0004', 'fix_out', 'kernel', false],
        ['CVE-2026-0005', 'pro', 'gst-plugins-bad1.0', false],
        ['CVE-2026-0002', 'no_fix', 'foo', true],
        ['CVE-2026-0003', 'no_fix', 'kernel', false],
    ]);
    const by = Object.fromEntries(items.map(v => [v.id, v]));
    assert.strictEqual(by['CVE-2026-0001'].fix, 'fixed in 8.3.6-0ubuntu0.24.04.13: install the updates (php8.3-cli has 8.3.6-0ubuntu0.24.04.12)');
    assert.strictEqual(by['CVE-2026-0004'].fix, 'fixed in kernel 6.8.0-149: install the updates, then restart (6.8.0-147-generic runs)');
    assert.strictEqual(by['CVE-2026-0005'].fix, 'fixed only in Ubuntu Pro: 1.24.2-1ubuntu4+esm1');
    assert.deepStrictEqual([by['CVE-2026-0003'].fix, by['CVE-2026-0003'].stopgap, by['CVE-2026-0003'].pending], ['no fix yet: 6.8.0-149.149 is on its way', 'Drop IPv4 packets with IP options.', '6.8.0-149.149']);
    assert.strictEqual(by['CVE-2026-0002'].fix, 'no fix yet');
    assert.strictEqual(by['CVE-2026-0004'].found_at, null, 'a CVE the host keeps nothing of was found when, it does not say');
    const never = vulnerabilities_items(matched, {codename: 'noble', found, seen_at: null, notes: () => null});
    assert.ok(never.every(v => v.new === false), 'a host with no bar to close calls nothing new');
});

test('Ubuntu\'s file is read once an hour if it changed, kept as it was when a read fails', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vulnerabilities-feed-'));
    const asked = [];
    let answer = {status: 200, body: oval_fixture(), modified: 'Fri, 06 Nov 2026 11:13:23 GMT'};
    async function fetch(url, init) {
        asked.push([url, init.headers['if-modified-since'] || null]);
        return new Response(answer.body, {status: answer.status, headers: (answer.modified === null) ? {} : {'last-modified': answer.modified}});
    }
    // The file comes as it is: a test unpacks nothing
    function unpack(file) {
        return fs.createReadStream(file);
    }
    try {
        const first = await vulnerabilities_feed({dir, codename: 'noble', now: 1000, fetch, unpack});
        assert.deepStrictEqual([first.error, first.modified, first.generated, first.cves.length], [null, 'Fri, 06 Nov 2026 11:13:23 GMT', '2026-11-06T11:09:56', 5]);
        assert.deepStrictEqual(asked, [['https://security-metadata.canonical.com/oval/com.ubuntu.noble.cve.oval.xml.bz2', null]]);
        assert.deepStrictEqual(fs.readdirSync(dir), ['noble.json'], 'kept in its folder, nothing else left there');

        const soon = await vulnerabilities_feed({dir, codename: 'noble', now: 1000 + 30*60*1000, fetch, unpack});
        assert.deepStrictEqual([soon.cves.length, asked.length], [5, 1], 'within the hour it is not asked');

        answer = {status: 304, body: null, modified: null};
        const unchanged = await vulnerabilities_feed({dir, codename: 'noble', now: 1000 + 61*60*1000, fetch, unpack});
        assert.deepStrictEqual([unchanged.error, unchanged.cves.length, asked[1][1]], [null, 5, 'Fri, 06 Nov 2026 11:13:23 GMT'], 'asked whether it changed since');

        answer = {status: 503, body: 'busy', modified: null};
        const failed = await vulnerabilities_feed({dir, codename: 'noble', now: 1000 + 122*60*1000, fetch, unpack});
        assert.match(failed.error, /answered 503/);
        assert.strictEqual(failed.cves.length, 5, 'what was read before stays');
        const retried = await vulnerabilities_feed({dir, codename: 'noble', now: 1000 + 133*60*1000, fetch, unpack});
        assert.strictEqual(asked.length, 4, 'a failed read is tried again ten minutes on, not an hour');
        assert.match(retried.error, /answered 503/);

        answer = {status: 200, body: 'not an oval file\n', modified: null};
        const wrong = await vulnerabilities_feed({dir, codename: 'noble', now: 1000 + 200*60*1000, fetch, unpack});
        assert.match(wrong.error, /not an OVAL file/);
        assert.strictEqual(wrong.cves.length, 5);

        answer = {status: 404, body: '', modified: null};
        const missing = await vulnerabilities_feed({dir, codename: 'focal', now: 1000, fetch, unpack});
        assert.deepStrictEqual([missing.error, missing.cves], ['Ubuntu publishes no CVE file for focal', null]);
        await assert.rejects(vulnerabilities_feed({dir, codename: '../etc', fetch, unpack}), /no such Ubuntu release/);
    }
    finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test('bunzip2 that is not here is said, not thrown past', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vulnerabilities-unpack-'));
    const was = process.env.PATH;
    process.env.PATH = dir;
    try {
        const answer = await vulnerabilities_feed({dir, codename: 'noble', now: 1000, fetch: async function () {
            return new Response('BZh9', {status: 200});
        }});
        assert.match(answer.error, /nothing here unpacks bzip2: bunzip2, bzip2 or busybox/);
    }
    finally {
        process.env.PATH = was;
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test('the API answers the host\'s read at its base, and nothing else', async function () {
    async function read() {
        return {at: 1, reason: null, items: [{id: 'CVE-2026-0001'}], commands: []};
    }
    async function refused() {
        throw Object.assign(new Error('away'), {status: 409});
    }
    const server = http.createServer(function (req, res) {
        vulnerabilities_serve(req, res, {
            read: (req.url === '/v/bad') ? refused : read,
            tail: req.url.slice('/v'.length).split('?')[0].replace(/^\/bad$/, ''),
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const base = `http://127.0.0.1:${server.address().port}/v`;
    try {
        const answer = await fetch(base);
        assert.deepStrictEqual([answer.status, (await answer.json()).items], [200, [{id: 'CVE-2026-0001'}]]);
        assert.strictEqual((await fetch(`${base}/other`)).status, 404);
        assert.strictEqual((await fetch(base, {method: 'POST'})).status, 404);
        const refused = await fetch(`${base}/bad`);
        assert.deepStrictEqual([refused.status, (await refused.json()).error], [409, 'away']);
    }
    finally {
        server.close();
    }
});
