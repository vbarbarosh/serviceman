const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

// Every version CHANGELOG.md says, in its order: {version, lines}, a line being one "- " entry
function changelog_read()
{
    const out = [];
    for (const line of fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n')) {
        const head = /^## (\d+\.\d+\.\d+)( — \d{4}-\d{2}-\d{2})?$/.exec(line);
        if (head !== null) {
            out.push({version: head[1], lines: 0});
        }
        else if (line.startsWith('- ') && (out.length > 0)) {
            out[out.length - 1].lines++;
        }
    }
    return out;
}

// "1.0.10" after "1.0.9": the parts as numbers
function version_parts(version)
{
    return version.split('.').map(Number);
}

// A change raises the patch version and says itself in CHANGELOG.md: the newest version there is
// the one package.json and package-lock.json give, each version is said once, above the older
// ones, and has a line of what changed
test('the version in package.json is the newest in CHANGELOG.md, and every version there says what changed', function () {
    const versions = changelog_read();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    assert.ok(versions.length > 0, 'CHANGELOG.md says no version');
    assert.strictEqual(versions[0].version, version, `package.json is at ${version}, CHANGELOG.md's newest is ${versions[0].version}: the change raises the patch version (npm version patch --no-git-tag-version) and says itself under it`);
    assert.deepStrictEqual([lock.version, lock.packages[''].version], [version, version], 'package-lock.json gives another version: npm version changes both');
    for (let i = 1; i < versions.length; i++) {
        const newer = version_parts(versions[i - 1].version);
        const older = version_parts(versions[i].version);
        const at = newer.findIndex((v, j) => (v !== older[j]));
        assert.ok((at !== -1) && (newer[at] > older[at]), `${versions[i - 1].version} is above ${versions[i].version}, which is not older`);
    }
    for (const item of versions) {
        assert.ok(item.lines > 0, `${item.version} says nothing of what changed`);
    }
});
