const agent_file_part_finish = require('../src/agent/src/agent_file_part_finish');
const agent_fs_list = require('../src/agent/src/agent_fs_list');
const agent_fs_path = require('../src/agent/src/agent_fs_path');
const agent_tar_get = require('../src/agent/src/agent_tar_get');
const agent_tar_put = require('../src/agent/src/agent_tar_put');
const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('a path within a token\'s folders is as asked; ../, a path outside, and a link that leads out are refused', async function (t) {
    const home = place(t);
    const notes = path.join(home, 'notes');
    fs.mkdirSync(path.join(notes, 'inner'), {recursive: true});
    fs.writeFileSync(path.join(home, 'secret.txt'), 'no');
    fs.symlinkSync(home, path.join(notes, 'out'));
    fs.symlinkSync('inner', path.join(notes, 'in'));
    fs.symlinkSync(path.join(home, 'gone'), path.join(notes, 'broken-out'));
    const root = path.join(home, 'notes');

    // Inside: as asked, a link within included; none, or ~, is the folder itself
    assert.strictEqual(agent_fs_path('', root), notes);
    assert.strictEqual(agent_fs_path('~', root), notes);
    assert.strictEqual(agent_fs_path('inner', root), path.join(notes, 'inner'));
    assert.strictEqual(agent_fs_path(path.join(notes, 'inner', 'new', 'deeper.txt'), root), path.join(notes, 'inner', 'new', 'deeper.txt'));
    assert.strictEqual(agent_fs_path('in/file.txt', root), path.join(notes, 'in', 'file.txt'), 'a link inside, as itself');

    // Outside, however it is written
    for (const asked of ['..', '../secret.txt', 'inner/../../secret.txt', home, '/', '/etc/passwd', 'out', 'out/secret.txt', 'out/new/file.txt', 'broken-out', 'broken-out/new.txt']) {
        assert.throws(() => agent_fs_path(asked, root), /^Error: EACCES: .* is outside the folders this token may use$/, asked);
    }
    // Several folders, any of them; one not there yet is no reason to refuse, and lists empty
    const two = [root, path.join(home, 'not-yet')];
    assert.strictEqual(agent_fs_path(path.join(home, 'not-yet', 'a', 'b.txt'), two), path.join(home, 'not-yet', 'a', 'b.txt'));
    assert.strictEqual(agent_fs_path('inner', two), path.join(notes, 'inner'), 'the first folder is where a path without a root is');
    assert.throws(() => agent_fs_path(path.join(home, 'not-yet-either', 'x'), two), /EACCES/);
    assert.deepStrictEqual(await agent_fs_list(path.join(home, 'not-yet'), two), {path: path.join(home, 'not-yet'), items: []});
    assert.strictEqual(fs.existsSync(path.join(home, 'not-yet')), false, 'listed, not made');
    await assert.rejects(agent_fs_list(path.join(home, 'not-yet', 'deeper'), two), /ENOENT/);
    // Without folders, paths are as before
    assert.strictEqual(agent_fs_path(path.join(home, 'secret.txt')), path.join(home, 'secret.txt'));
    assert.strictEqual(agent_fs_path(''), os.homedir());
});

test('a file finished over a link that leads out, a tar entry through one, and a tar of a name through one are refused', async function (t) {
    const home = place(t);
    const notes = path.join(home, 'notes');
    const away = path.join(home, 'away');
    fs.mkdirSync(notes);
    fs.mkdirSync(away);
    fs.writeFileSync(path.join(away, 'target.txt'), 'kept');
    fs.symlinkSync(path.join(away, 'target.txt'), path.join(notes, 'link.txt'));
    fs.symlinkSync(away, path.join(notes, 'door'));

    // An upload finished under the link's name would write through it
    fs.writeFileSync(path.join(notes, '.link.txt.abcdef123.part'), 'over');
    await assert.rejects(agent_file_part_finish({dir: notes, name: 'link.txt', id: 'abcdef123', size: 4, root: notes}), /EACCES/);
    assert.strictEqual(fs.readFileSync(path.join(away, 'target.txt'), 'utf8'), 'kept');

    // A tar whose entry goes through the link into the folder outside
    const from = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-root-tar-'));
    t.after(() => fs.rmSync(from, {recursive: true, force: true}));
    fs.mkdirSync(path.join(from, 'door'));
    fs.writeFileSync(path.join(from, 'door', 'planted.txt'), 'planted');
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', 'door/planted.txt']);
    const error = await new Promise(function (resolve) {
        const put = agent_tar_put({dir: notes, root: notes});
        put.on('error', e => resolve(e.message));
        put.on('end', () => resolve(null));
        put.write(tarred, function () {
            put.end();
        });
    });
    assert.match(String(error), /EACCES/);
    assert.strictEqual(fs.existsSync(path.join(away, 'planted.txt')), false);

    // tar reads a name through the link, so such a name is refused before tar runs
    assert.throws(() => agent_tar_get({dir: notes, names: ['door/target.txt'], paths: true, root: notes}), /EACCES/);
    assert.throws(() => agent_tar_get({dir: notes, names: ['door'], root: notes}), /EACCES/);
});

// A home of the test's own, gone after it
function place(t)
{
    const out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-root-')));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}
