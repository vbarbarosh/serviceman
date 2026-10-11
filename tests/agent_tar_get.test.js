const agent_tar_get = require('../src/agent/src/agent_tar_get');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('a file written while tar reads it still makes a download: exit 1 is a warning', async function () {
    const answer = await tar_with_exit(1, 'tar: logs/today.txt: file changed as we read it');
    assert.strictEqual(answer.error, null);
    assert.strictEqual(answer.bytes, 'the archive');
});

test('a folder tar cannot read is an error with what tar said last', async function () {
    const answer = await tar_with_exit(2, 'tar: secret: Cannot open: Permission denied');
    assert.strictEqual(answer.error, 'tar: secret: Cannot open: Permission denied');
});

// A tar of our own on PATH: it writes its bytes, says the line, and ends with the code
async function tar_with_exit(code, said)
{
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tar-'));
    fs.writeFileSync(path.join(bin, 'tar'), `#!/bin/sh\nprintf 'the archive'\necho '${said}' >&2\nexit ${code}\n`, {mode: 0o755});
    const path_before = process.env.PATH;
    process.env.PATH = `${bin}:${path_before}`;
    try {
        const stream = agent_tar_get({dir: bin, names: ['tar']});
        const chunks = [];
        stream.on('data', v => chunks.push(v));
        const error = await new Promise(function (resolve) {
            stream.on('end', () => resolve(null));
            stream.on('error', function (error) {
                resolve(error.message);
            });
        });
        return {error, bytes: Buffer.concat(chunks).toString('utf8')};
    }
    finally {
        process.env.PATH = path_before;
        fs.rmSync(bin, {recursive: true, force: true});
    }
}
