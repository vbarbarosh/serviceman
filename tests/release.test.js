const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

// A stand-in for one of the project's checks: it writes its name into a file outside the
// repository, and fails when it is the one asked to
const CHECK = `const fs = require('fs');
fs.appendFileSync(process.env.RELEASE_TEST_RAN, process.argv[2] + '\\n');
process.exit((process.env.RELEASE_TEST_FAIL === process.argv[2]) ? 1 : 0);
`;

// git and npm as the release finds them, without this machine's own git settings, and without
// the mark that tells a `node --test` it is the child of another
const ENV = Object.assign(Object.fromEntries(Object.entries(process.env).filter(v => v[0] !== 'NODE_TEST_CONTEXT')), {
    GIT_AUTHOR_NAME: 'Scratch',
    GIT_AUTHOR_EMAIL: 'user@example.com',
    GIT_COMMITTER_NAME: 'Scratch',
    GIT_COMMITTER_EMAIL: 'user@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
});

// bin/release, run for real in a scratch repository with an origin of its own: git and npm are
// the real ones, the linter and the three suites are stand-ins

test('a bad argument says the usage on stderr and exits 1', function (t) {
    const scratch = scratch_make(t);
    for (const args of [[], ['banana']]) {
        const ran = release(scratch, args, {});
        assert.deepStrictEqual([ran.status, ran.stderr.includes('usage: release major|minor|patch'), ran.stdout.includes('usage')], [1, true, false], ran.stderr);
    }
    assert.deepStrictEqual(checks_ran(scratch), []);
});

test('changes that are not committed stop a release before any check, said on stderr', function (t) {
    const scratch = scratch_make(t);
    fs.writeFileSync(path.join(scratch.work, 'notes.txt'), 'half done\n');
    const ran = release(scratch, ['patch'], {});
    assert.deepStrictEqual([ran.status, ran.stderr.includes('error: there are changes'), ran.stdout.includes('there are changes')], [1, true, false], ran.stderr);
    assert.deepStrictEqual(checks_ran(scratch), []);
    assert.deepStrictEqual(refs_of(scratch.origin), ['refs/heads/main']);
});

test('a release runs the linter and the three suites, and one that fails leaves nothing written', function (t) {
    for (const failing of ['lint', 'suite', 'modules', 'logline']) {
        const scratch = scratch_make(t);
        const ran = release(scratch, ['patch'], {RELEASE_TEST_FAIL: failing});
        assert.strictEqual(ran.status, 1, `${failing}: ${ran.stderr}`);
        assert.strictEqual(checks_ran(scratch).pop(), failing);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(scratch.work, 'package.json'), 'utf8')).version, '0.0.1');
        assert.strictEqual(git(scratch.work, ['status', '-s']), '');
        assert.strictEqual(git(scratch.work, ['tag']), 'kept-here');
        assert.deepStrictEqual(refs_of(scratch.origin), ['refs/heads/main']);
    }
});

test('a release pushes the branch it is made on and its own tag, and nothing else this machine holds', function (t) {
    const scratch = scratch_make(t);
    const ran = release(scratch, ['patch'], {});
    assert.strictEqual(ran.status, 0, ran.stderr);
    assert.deepStrictEqual(checks_ran(scratch), ['lint', 'suite', 'modules', 'logline']);
    // The branch `wip` and the tag `kept-here` are this machine's own, and stay on it
    assert.deepStrictEqual(refs_of(scratch.origin), ['refs/heads/main', 'refs/tags/v0.0.2']);
    assert.strictEqual(git(scratch.origin, ['log', '-1', '--format=%s', 'main']), 'release: v0.0.2');
    assert.strictEqual(git(scratch.origin, ['rev-parse', 'main']), git(scratch.origin, ['rev-parse', 'v0.0.2']));
    assert.match(fs.readFileSync(path.join(scratch.work, 'CHANGELOG.md'), 'utf8'), /^# Changelog\n\n## 0\.0\.2 — \d{4}-\d{2}-\d{2}\n\n- Released\.\n\n## 0\.0\.1 /);
    assert.strictEqual(git(scratch.work, ['status', '-s']), '');
});

// A repository with the real bin/release in it, the stand-ins it runs, and what a machine holds
// beside a release: a branch of work in progress and a tag of its own. Its origin has `main`.
function scratch_make(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-release-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const origin = path.join(dir, 'origin.git');
    const work = path.join(dir, 'work');
    const files = {
        'package.json': `${JSON.stringify({name: 'scratch', version: '0.0.1', private: true, scripts: {lint: 'node check.js lint'}}, null, 4)}\n`,
        'CHANGELOG.md': '# Changelog\n\n## 0.0.1 — 2026-01-01\n\n- The first.\n',
        'check.js': CHECK,
        'bin/release': fs.readFileSync(path.join(ROOT, 'bin', 'release'), 'utf8'),
        'bin/test': '#!/bin/bash\nexec node check.js suite\n',
        'modules/one/tests/one.test.js': 'process.argv[2] = \'modules\';\nrequire(\'../../../check\');\n',
        'logline/lines/bin/test': '#!/bin/bash\nexec node ../../check.js logline\n',
    };
    for (const name of Object.keys(files)) {
        fs.mkdirSync(path.dirname(path.join(work, name)), {recursive: true});
        fs.writeFileSync(path.join(work, name), files[name], {mode: 0o755});
    }
    git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
    git(work, ['init', '-q', '-b', 'main']);
    git(work, ['add', '.']);
    git(work, ['commit', '-q', '-m', 'scratch: the first']);
    git(work, ['remote', 'add', 'origin', origin]);
    git(work, ['push', '-q', '-u', 'origin', 'main']);
    git(work, ['checkout', '-q', '-b', 'wip']);
    git(work, ['commit', '-q', '--allow-empty', '-m', 'scratch: half done']);
    git(work, ['checkout', '-q', 'main']);
    git(work, ['tag', 'kept-here']);
    return {dir, origin, work};
}

function release(scratch, args, env)
{
    const ran = child_process.spawnSync(path.join(scratch.work, 'bin', 'release'), args, {
        cwd: scratch.dir,
        env: Object.assign({}, ENV, {RELEASE_TEST_RAN: path.join(scratch.dir, 'ran.txt')}, env),
        encoding: 'utf8',
    });
    return {status: ran.status, stdout: ran.stdout, stderr: ran.stderr};
}

// The checks a release ran, in the order it ran them
function checks_ran(scratch)
{
    const file = path.join(scratch.dir, 'ran.txt');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(v => v !== '') : [];
}

function refs_of(repository)
{
    return git(repository, ['for-each-ref', '--format=%(refname)']).split('\n').filter(v => v !== '');
}

function git(cwd, args)
{
    return child_process.execFileSync('git', args, {cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
