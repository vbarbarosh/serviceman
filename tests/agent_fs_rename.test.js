const agent_fs_rename = require('../src/agent/src/agent_fs_rename');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Rename and Move of the File Manager sent {from: …/draft.txt, to: …/report.txt}, the answer
// was {}, and report.txt then held the draft: a file lost with no question and no undo. The
// page may have read the folder a while ago, and is not the only one to ask, so the machine
// refuses where the rename is made.
test('a name carried onto one that is taken is refused in a copy\'s words, whatever is there, and both stay as they were', async function (t) {
    const dir = dir_make(t);
    fs.writeFileSync(path.join(dir, 'draft.txt'), 'the draft');
    fs.writeFileSync(path.join(dir, 'report.txt'), 'a week of work');
    fs.mkdirSync(path.join(dir, 'empty'));
    fs.mkdirSync(path.join(dir, 'full'));
    fs.writeFileSync(path.join(dir, 'full', 'kept.txt'), 'kept');
    fs.mkdirSync(path.join(dir, 'folder'));
    fs.writeFileSync(path.join(dir, 'folder', 'in.txt'), 'in');
    fs.symlinkSync('report.txt', path.join(dir, 'live'));
    fs.symlinkSync('nowhere', path.join(dir, 'dangling'));
    const before = tree(dir);

    // A file onto a file, onto a folder (never moved into it), onto a link that leads
    // somewhere or nowhere; a folder onto a file, onto a folder, empty or full, onto a link; a
    // link onto a file
    for (const [from, to] of [['draft.txt', 'report.txt'], ['draft.txt', 'empty'], ['draft.txt', 'full'], ['draft.txt', 'live'], ['draft.txt', 'dangling'], ['folder', 'report.txt'], ['folder', 'empty'], ['folder', 'full'], ['folder', 'dangling'], ['live', 'draft.txt']]) {
        await assert.rejects(agent_fs_rename({from: path.join(dir, from), to: path.join(dir, to)}), new RegExp(`^Error: ${to.replace('.', '\\.')} is there already$`), `${from} onto ${to}`);
        assert.deepStrictEqual(tree(dir), before, `${from} onto ${to}`);
    }
    assert.strictEqual(fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'), 'a week of work');
});

test('a name carried to a free one goes as before: a file as the file it was, a folder, a link as itself, into another folder, onto itself', async function (t) {
    const dir = dir_make(t);
    fs.writeFileSync(path.join(dir, 'run.sh'), 'echo hi', {mode: 0o750});
    fs.mkdirSync(path.join(dir, 'folder', 'deep'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'folder', 'deep', 'in.txt'), 'in');
    fs.symlinkSync('nowhere', path.join(dir, 'link'));
    const file = fs.statSync(path.join(dir, 'run.sh'));

    // The same file under its new name, not a copy of it: its inode, its mode, its time
    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'run.sh'), to: path.join(dir, 'folder', 'start.sh')}), {});
    const moved = fs.statSync(path.join(dir, 'folder', 'start.sh'));
    assert.deepStrictEqual([moved.ino, moved.mode, moved.mtimeMs, moved.nlink], [file.ino, file.mode, file.mtimeMs, 1]);
    assert.strictEqual(fs.existsSync(path.join(dir, 'run.sh')), false);

    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'folder'), to: path.join(dir, 'renamed')}), {});
    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'link'), to: path.join(dir, 'renamed', 'link')}), {});
    assert.deepStrictEqual(tree(dir), ['renamed/', 'renamed/deep/', 'renamed/deep/in.txt=in', 'renamed/link->nowhere', 'renamed/start.sh=echo hi']);

    // Onto itself, however it is written, there is nothing to do, and nothing is refused
    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'renamed', 'start.sh'), to: `${dir}/renamed/deep/../start.sh`}), {});
    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'renamed'), to: `${path.join(dir, 'renamed')}/`}), {});
    assert.strictEqual(fs.readFileSync(path.join(dir, 'renamed', 'start.sh'), 'utf8'), 'echo hi');

    // A name that is not there, and a folder that is not there to move into, are the disk's refusal
    await assert.rejects(agent_fs_rename({from: path.join(dir, 'none.txt'), to: path.join(dir, 'other.txt')}), /ENOENT/);
    await assert.rejects(agent_fs_rename({from: path.join(dir, 'none.txt'), to: path.join(dir, 'none.txt')}), /ENOENT/);
    await assert.rejects(agent_fs_rename({from: path.join(dir, 'renamed', 'start.sh'), to: path.join(dir, 'no-folder', 'start.sh')}), /ENOENT/);
    assert.strictEqual(fs.existsSync(path.join(dir, 'renamed', 'start.sh')), true);
});

// Between the look and the rename another program may make the name. The look is stood in
// for here by one that still sees nothing there, which is what the gap is.
test('a file made under the name since the look is not written over: the disk itself refuses the second name', async function (t) {
    const dir = dir_make(t);
    fs.writeFileSync(path.join(dir, 'draft.txt'), 'the draft');
    fs.writeFileSync(path.join(dir, 'report.txt'), 'made since the look');
    const lstat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', (asked, options) => (asked === path.join(dir, 'report.txt')) ? undefined : lstat(asked, options));
    await assert.rejects(agent_fs_rename({from: path.join(dir, 'draft.txt'), to: path.join(dir, 'report.txt')}), /^Error: report\.txt is there already$/);
    t.mock.restoreAll();
    assert.deepStrictEqual(tree(dir), ['draft.txt=the draft', 'report.txt=made since the look']);

    // A disk that gives a file no second name (FAT) renames after the look, and a name the
    // look sees is refused there as anywhere
    t.mock.method(fs.promises, 'link', () => Promise.reject(Object.assign(new Error('EPERM: operation not permitted, link'), {code: 'EPERM'})));
    await assert.rejects(agent_fs_rename({from: path.join(dir, 'draft.txt'), to: path.join(dir, 'report.txt')}), /^Error: report\.txt is there already$/);
    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'draft.txt'), to: path.join(dir, 'final.txt')}), {});
    t.mock.restoreAll();
    assert.deepStrictEqual(tree(dir), ['final.txt=the draft', 'report.txt=made since the look']);

    // An old name that cannot be taken away leaves no second name behind
    t.mock.method(fs.promises, 'unlink', v => (v === path.join(dir, 'final.txt')) ? Promise.reject(Object.assign(new Error('EACCES: permission denied, unlink'), {code: 'EACCES'})) : fs.promises.rm(v));
    await assert.rejects(agent_fs_rename({from: path.join(dir, 'final.txt'), to: path.join(dir, 'moved.txt')}), /EACCES/);
    t.mock.restoreAll();
    assert.deepStrictEqual(tree(dir), ['final.txt=the draft', 'report.txt=made since the look']);
});

// On a disk that folds letters Report.TXT finds report.txt: the name is taken by the very
// file renamed, and the rename is the way its letters are changed. No disk of the test box
// folds, so the fold is stood in for at the look: Report.TXT answers as report.txt does.
test('a name that differs only in how the disk folds its letters is the file itself, and is renamed; another name of the same file is not', async function (t) {
    const dir = dir_make(t);
    fs.writeFileSync(path.join(dir, 'report.txt'), 'a week of work');
    fs.mkdirSync(path.join(dir, 'photos'));
    const lstat = fs.lstatSync;
    const folded = {[path.join(dir, 'Report.TXT')]: path.join(dir, 'report.txt'), [path.join(dir, 'Photos')]: path.join(dir, 'photos')};
    t.mock.method(fs, 'lstatSync', (asked, options) => lstat((folded[asked] === undefined) ? asked : folded[asked], options));
    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'report.txt'), to: path.join(dir, 'Report.TXT')}), {});
    assert.deepStrictEqual(await agent_fs_rename({from: path.join(dir, 'photos'), to: path.join(dir, 'Photos')}), {});
    t.mock.restoreAll();
    assert.deepStrictEqual(tree(dir), ['Photos/', 'Report.TXT=a week of work']);

    // A second name of the same file is a name that is taken: before, the answer was {} and
    // nothing was done
    fs.linkSync(path.join(dir, 'Report.TXT'), path.join(dir, 'same.txt'));
    await assert.rejects(agent_fs_rename({from: path.join(dir, 'Report.TXT'), to: path.join(dir, 'same.txt')}), /^Error: same\.txt is there already$/);
    assert.deepStrictEqual(tree(dir), ['Photos/', 'Report.TXT=a week of work', 'same.txt=a week of work']);
});

test('within a token\'s folders a taken name is refused the same and a free one goes; out of them is EACCES as before', async function (t) {
    const home = dir_make(t);
    const notes = path.join(home, 'notes');
    fs.mkdirSync(notes);
    fs.writeFileSync(path.join(notes, 'a.txt'), 'a');
    fs.writeFileSync(path.join(notes, 'b.txt'), 'b');
    fs.writeFileSync(path.join(home, 'secret.txt'), 'not yours');
    await assert.rejects(agent_fs_rename({from: 'a.txt', to: 'b.txt', root: [notes]}), /^Error: b\.txt is there already$/);
    await assert.rejects(agent_fs_rename({from: 'a.txt', to: path.join(home, 'secret.txt'), root: [notes]}), /EACCES: .* is outside the folders this token may use/);
    await assert.rejects(agent_fs_rename({from: path.join(home, 'secret.txt'), to: 'mine.txt', root: [notes]}), /EACCES: .* is outside the folders this token may use/);
    assert.deepStrictEqual(await agent_fs_rename({from: 'a.txt', to: 'c.txt', root: [notes]}), {});
    assert.deepStrictEqual(tree(home), ['notes/', 'notes/b.txt=b', 'notes/c.txt=a', 'secret.txt=not yours']);
});

function dir_make(t)
{
    const out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rename-')));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}

// Every name under a folder, with what a file holds and where a link leads
function tree(dir, under)
{
    const out = [];
    const prefix = (under === undefined) ? '' : under;
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) {
            out.push(`${prefix}${name}->${fs.readlinkSync(full)}`);
        }
        else if (stat.isDirectory()) {
            out.push(`${prefix}${name}/`, ...tree(full, `${prefix}${name}/`));
        }
        else {
            out.push(`${prefix}${name}=${fs.readFileSync(full, 'utf8')}`);
        }
    }
    return out;
}
