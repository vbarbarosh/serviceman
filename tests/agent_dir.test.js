const agent_dir = require('../src/agent/src/agent_dir');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Where a hand-run agent keeps what it writes down: beside its file, or, run from the
// repository, under the repository's data/, never in src/
test('an agent run from the repository keeps its state under data/agent; a bundled one beside its file', function () {
    const was = {argv1: process.argv[1], dir: process.env.SERVICEMAN_AGENT_DIR};
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-repo-'));
    try {
        delete process.env.SERVICEMAN_AGENT_DIR;
        fs.mkdirSync(path.join(repo, 'src', 'agent'), {recursive: true});
        process.argv[1] = path.join(repo, 'src', 'agent');
        assert.strictEqual(agent_dir(), path.join(repo, 'data', 'agent'));
        // Named by its file it is the repository all the same: the tests start it so
        fs.mkdirSync(path.join(repo, 'src', 'agent', 'src'));
        fs.writeFileSync(path.join(repo, 'src', 'agent', 'index.js'), '');
        fs.writeFileSync(path.join(repo, 'src', 'agent', 'src', 'agent_dir.js'), '');
        process.argv[1] = path.join(repo, 'src', 'agent', 'index.js');
        assert.strictEqual(agent_dir(), path.join(repo, 'data', 'agent'));
        fs.writeFileSync(path.join(repo, 'serviceman-agent.js'), '');
        process.argv[1] = path.join(repo, 'serviceman-agent.js');
        assert.strictEqual(agent_dir(), repo);
        // A bundle somebody named index.js has no sources beside it, and keeps to its folder
        fs.mkdirSync(path.join(repo, 'bundled'));
        fs.writeFileSync(path.join(repo, 'bundled', 'index.js'), '');
        process.argv[1] = path.join(repo, 'bundled', 'index.js');
        assert.strictEqual(agent_dir(), path.join(repo, 'bundled'));
        process.env.SERVICEMAN_AGENT_DIR = path.join(repo, 'elsewhere');
        assert.strictEqual(agent_dir(), path.join(repo, 'elsewhere'));
    }
    finally {
        process.argv[1] = was.argv1;
        if (was.dir === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = was.dir;
        }
        fs.rmSync(repo, {recursive: true, force: true});
    }
});
