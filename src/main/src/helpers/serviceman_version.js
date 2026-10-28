const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

// The folder serviceman runs from: its package.json, and its checkout where it runs from one
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Asked once: neither changes while serviceman runs
let known = null;

// Which serviceman this is, for the page's header: the version in its package.json and the
// commit it was built from. The image has the commit from bin/build (SERVICEMAN_COMMIT); one
// run from a checkout asks git. A + after the commit says the checkout had changes not
// committed.
//
//     ->  {version, commit}: commit is null where nothing says it
function serviceman_version()
{
    if (known === null) {
        known = {version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, commit: commit_find()};
    }
    return known;
}

function commit_find()
{
    const given = process.env.SERVICEMAN_COMMIT;
    if ((given !== undefined) && (given !== '')) {
        return given;
    }
    try {
        const commit = git(['rev-parse', '--short=7', 'HEAD']);
        return (git(['status', '--porcelain', '--untracked-files=no']) === '') ? commit : `${commit}+`;
    }
    catch {
        return null;
    }
}

function git(args)
{
    return child_process.execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000}).trim();
}

module.exports = serviceman_version;
