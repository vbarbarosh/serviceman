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
        fs.writeFileSync(path.join(repo, 'serviceman-agent.js'), '');
        process.argv[1] = path.join(repo, 'serviceman-agent.js');
        assert.strictEqual(agent_dir(), repo);
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
