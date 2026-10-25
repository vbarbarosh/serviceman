const agent_sign_key = require('../src/main/src/helpers/agent_sign_key');
const agent_signature = require('../src/main/src/helpers/agent_signature');
const agent_signed = require('../src/helpers/agent_signed');
const agent_verify_file = require('../src/agent/src/agent_verify_file');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// The host's key is made once and kept for it alone; a file it signed is the only one a machine
// takes, and the machine holds nothing but the public half, as one line
test('an agent file signed by the host checks out with the key a machine was given, and nothing else does', function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-sign-'));
    try {
        const app = {state_dir};
        const key = agent_sign_key(app);
        assert.strictEqual(fs.statSync(path.join(state_dir, 'agent_sign.key')).mode & 0o777, 0o600);
        assert.match(Buffer.from(key.public_line, 'base64').toString('utf8'), /^-----BEGIN PUBLIC KEY-----/);
        assert.strictEqual(key.public_line.includes('\n'), false, 'one line, for the env file');
        const text = 'modules["agent/index"] = function () {};\n';
        const signature = agent_signature(app, text);
        assert.strictEqual(agent_signed(text, signature, key.public_line), true);
        assert.strictEqual(agent_signed(`${text}// changed`, signature, key.public_line), false);
        assert.strictEqual(agent_signed(text, `${signature.slice(0, -4)}AAAA`, key.public_line), false);
        assert.strictEqual(agent_signed(text, signature, 'not a key'), false);
        assert.strictEqual(agent_signed(text, '', key.public_line), false);
        // Another host's key is another key
        const other = agent_sign_key({state_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-sign-other-'))});
        assert.strictEqual(agent_signed(text, signature, other.public_line), false);
        // Kept: a second app on the same state dir signs with the same key
        assert.strictEqual(agent_sign_key({state_dir}).public_line, key.public_line);

        // A file on disk, for bin/update: the signature beside it, the key as one line
        const file = path.join(state_dir, 'agent.js.new');
        fs.writeFileSync(file, text);
        fs.writeFileSync(`${file}.sig`, `${signature}\n`);
        assert.strictEqual(agent_verify_file(file, `${file}.sig`, key.public_line), true);
        assert.strictEqual(agent_verify_file(file, `${file}.sig`, other.public_line), false);
        assert.strictEqual(agent_verify_file(file, path.join(state_dir, 'nothing.sig'), key.public_line), false);
    }
    finally {
        fs.rmSync(state_dir, {recursive: true, force: true});
    }
});
