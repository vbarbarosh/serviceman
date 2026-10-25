const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const remote_claimed_mark = require('../src/main/src/helpers/remote_claimed_mark');
const remotes_claimed_read = require('../src/main/src/helpers/remotes_claimed_read');
const test = require('node:test');

// A machine that dialled with its own token is written down for good: the next serviceman on
// this state dir refuses the join token for it as this one does
test('a machine marked as claimed stays so across restarts, and is marked once', function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-claimed-'));
    try {
        const app = {state_dir};
        assert.deepStrictEqual(Array.from(remotes_claimed_read(app)), []);
        assert.strictEqual(remote_claimed_mark(app, 'auto-box'), true);
        assert.strictEqual(remote_claimed_mark(app, 'auto-box'), false, 'once');
        assert.strictEqual(remote_claimed_mark(app, 'auto-pi'), true);
        assert.deepStrictEqual(Array.from(remotes_claimed_read(app)), ['auto-box', 'auto-pi']);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(state_dir, 'remotes_claimed.json'), 'utf8')), ['auto-box', 'auto-pi']);
        assert.deepStrictEqual(Array.from(remotes_claimed_read({state_dir})), ['auto-box', 'auto-pi'], 'the next serviceman reads it');
        // A file that is not a list is no marks at all
        fs.writeFileSync(path.join(state_dir, 'remotes_claimed.json'), '{"x": 1}');
        assert.deepStrictEqual(Array.from(remotes_claimed_read({state_dir})), []);
    }
    finally {
        fs.rmSync(state_dir, {recursive: true, force: true});
    }
});
