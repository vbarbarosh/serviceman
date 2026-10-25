const agent_file_part_finish = require('../src/agent/src/agent_file_part_finish');
const agent_file_part_put = require('../src/agent/src/agent_file_part_put');
const agent_file_put = require('../src/agent/src/agent_file_put');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// A file the host copies here goes to a part file this agent makes; a link somebody planted
// under that name would carry the bytes to wherever it points, so such a name is refused and
// the file it points at stays as it was
test('an upload writes through no link planted at its part name: whole, and in parts', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-put-'));
    try {
        const victim = path.join(dir, 'victim.txt');
        fs.writeFileSync(victim, 'untouched\n');

        // Whole: the part a cut-off copy left is cleared, a link in its place is not written through
        fs.symlinkSync(victim, path.join(dir, '.notes.txt.part'));
        const whole = await written(agent_file_put({dir, name: 'notes.txt', root: dir}), 'the bytes\n');
        assert.strictEqual(whole.error, null);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'the bytes\n');
        assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'untouched\n');
        assert.strictEqual(fs.existsSync(path.join(dir, '.notes.txt.part')), false);

        // In parts: the parts gather in a file of the agent's own, and a link there is refused
        fs.symlinkSync(victim, path.join(dir, '.big.bin.abcdefgh.part'));
        assert.throws(() => agent_file_part_put({dir, name: 'big.bin', id: 'abcdefgh', offset: 0, root: dir}), /ELOOP|symbolic link/);
        assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'untouched\n');
        fs.unlinkSync(path.join(dir, '.big.bin.abcdefgh.part'));
        const first = await written(agent_file_part_put({dir, name: 'big.bin', id: 'abcdefgh', offset: 0, root: dir}), 'one');
        assert.strictEqual(first.error, null);
        assert.deepStrictEqual(JSON.parse(first.said), {received: 3});
        const second = await written(agent_file_part_put({dir, name: 'big.bin', id: 'abcdefgh', offset: 3, root: dir}), 'two');
        assert.deepStrictEqual(JSON.parse(second.said), {received: 6});
        // The last step too: a link put at the part name after the parts are in is not what is renamed
        fs.unlinkSync(path.join(dir, '.big.bin.abcdefgh.part'));
        fs.symlinkSync(victim, path.join(dir, '.big.bin.abcdefgh.part'));
        await assert.rejects(agent_file_part_finish({dir, name: 'big.bin', id: 'abcdefgh', size: 10, root: dir}), /not the file that was written/);
        assert.strictEqual(fs.existsSync(path.join(dir, 'big.bin')), false);
        assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'untouched\n');
    }
    finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// The far end of a tunnelled stream written to and ended: what it said back, or its error
function written(stream, text)
{
    return new Promise(function (resolve) {
        let said = '';
        stream.on('data', v => said += v.toString('utf8'));
        stream.on('error', e => resolve({error: e.message, said}));
        stream.on('end', () => resolve({error: null, said}));
        stream.write(Buffer.from(text), function () {
            stream.end();
        });
    });
}
