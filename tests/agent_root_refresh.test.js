const agent_root_refresh = require('../src/agent/src/agent_root_refresh');
const agent_sign_key = require('../src/main/src/helpers/agent_sign_key');
const agent_signature = require('../src/main/src/helpers/agent_signature');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// The root half runs a root-owned copy; it takes the session's file as its new copy only when
// the host signed it, checked with the key pinned beside the copy
test('the root half takes the session\'s agent file as its copy when the host signed it, and otherwise not', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-copy-'));
    const argv1 = process.argv[1];
    try {
        const app = {state_dir: path.join(dir, 'state')};
        const key = agent_sign_key(app);
        const own = path.join(dir, 'root', 'agent.js');
        const source = path.join(dir, 'session', 'agent.js');
        fs.mkdirSync(path.dirname(own), {recursive: true});
        fs.mkdirSync(path.dirname(source), {recursive: true});
        fs.writeFileSync(own, 'the old copy\n');
        fs.writeFileSync(source, 'modules["agent/index"] = 1; // the new one\n');
        process.argv[1] = own;

        // No source named: one file for both halves, nothing to take
        assert.deepStrictEqual(agent_root_refresh({root_source: ''}), {refreshed: false, reason: 'one file for both halves'});
        // No signature beside the source: not taken
        assert.match(agent_root_refresh({root_source: source}).reason, /agent\.js\.sig/);
        fs.writeFileSync(`${source}.sig`, `${agent_signature(app, fs.readFileSync(source, 'utf8'))}\n`);
        // No key pinned: not taken, and the reason says what pins it
        assert.match(agent_root_refresh({root_source: source}).reason, /install-root pins it/);
        fs.writeFileSync(path.join(path.dirname(own), 'host.pub'), `${key.public_line}\n`);
        // Signed by the host this machine knows: taken, with the run bits
        assert.deepStrictEqual(agent_root_refresh({root_source: source}), {refreshed: true});
        assert.strictEqual(fs.readFileSync(own, 'utf8'), 'modules["agent/index"] = 1; // the new one\n');
        assert.strictEqual(fs.statSync(own).mode & 0o777, 0o755);
        // Changed under its signature, or signed by another host: not taken
        fs.writeFileSync(source, 'modules["agent/index"] = 2; // not the host\'s\n');
        assert.match(agent_root_refresh({root_source: source}).reason, /not signed by the host/);
        const other = agent_sign_key({state_dir: path.join(dir, 'other')});
        fs.writeFileSync(path.join(path.dirname(own), 'host.pub'), `${other.public_line}\n`);
        fs.writeFileSync(`${source}.sig`, `${agent_signature(app, fs.readFileSync(source, 'utf8'))}\n`);
        assert.match(agent_root_refresh({root_source: source}).reason, /not signed by the host/);
        assert.strictEqual(fs.readFileSync(own, 'utf8'), 'modules["agent/index"] = 1; // the new one\n', 'the copy stands');
    }
    finally {
        process.argv[1] = argv1;
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
