const agent_fs_watch = require('../src/agent/src/agent_fs_watch');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

test('a folder says what was created, changed and removed in it, each once it is quiet', async function (t) {
    const dir = dir_make(t);
    fs.mkdirSync(path.join(dir, 'inner'));
    const watch = await watch_open(t, {path: dir});
    assert.deepStrictEqual(watch.lines[0], {type: 'ready', path: dir, tree: false, skip: []});

    fs.writeFileSync(path.join(dir, 'a.txt'), 'one');
    await watch.until(v => (v.type === 'created') && (v.path === 'a.txt'));
    fs.appendFileSync(path.join(dir, 'a.txt'), 'two');
    await watch.until(v => (v.type === 'changed') && (v.path === 'a.txt') && (v.size === 6));
    fs.rmSync(path.join(dir, 'a.txt'));
    await watch.until(v => (v.type === 'removed') && (v.path === 'a.txt'));

    // A file written in ten pieces is told about once, whole
    const fd = fs.openSync(path.join(dir, 'slow.bin'), 'w');
    for (let i = 0; i < 10; i++) {
        fs.writeSync(fd, Buffer.alloc(1000));
        await timers.setTimeout(50);
    }
    fs.closeSync(fd);
    await watch.until(v => v.path === 'slow.bin');
    await timers.setTimeout(500);
    assert.deepStrictEqual(watch.lines.filter(v => v.path === 'slow.bin').map(v => [v.type, v.size]), [['created', 10000]]);

    // Without tree, what happens inside a folder under it is not said
    fs.writeFileSync(path.join(dir, 'inner', 'deep.txt'), 'deep');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    await watch.until(v => v.path === 'b.txt');
    assert.strictEqual(watch.lines.some(v => (v.path !== undefined) && v.path.startsWith('inner')), false);
    assert.deepStrictEqual(watch.lines.slice(1).map(v => `${v.type} ${v.path} ${v.kind}`), [
        'created a.txt file',
        'changed a.txt file',
        'removed a.txt file',
        'created slow.bin file',
        'created b.txt file',
    ]);
});

test('a tree says what happens in every folder under it, but the names it skips', async function (t) {
    const dir = dir_make(t);
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.mkdirSync(path.join(dir, 'src'));
    const watch = await watch_open(t, {path: dir, tree: true, skip: ['node_modules', '.git']});

    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a');
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
    await watch.until(v => v.path === path.join('src', 'a.js'));

    // A folder made after the start says what it already held as created, then what comes
    fs.mkdirSync(path.join(dir, 'new', 'deeper'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'new', 'deeper', 'b.txt'), 'b');
    await watch.until(v => v.path === path.join('new', 'deeper', 'b.txt'));
    fs.writeFileSync(path.join(dir, 'new', 'deeper', 'c.txt'), 'c');
    await watch.until(v => v.path === path.join('new', 'deeper', 'c.txt'));
    fs.mkdirSync(path.join(dir, 'new', '.git'));
    fs.writeFileSync(path.join(dir, 'new', '.git', 'HEAD'), 'ref');

    fs.rmSync(path.join(dir, 'new'), {recursive: true});
    await watch.until(v => (v.type === 'removed') && (v.path === 'new'));
    await timers.setTimeout(500);

    const said = watch.lines.slice(1).map(v => `${v.type} ${v.path} ${v.kind}`);
    assert.strictEqual(said.some(v => v.includes('node_modules') || v.includes('.git')), false, 'skipped names say nothing');
    assert.strictEqual(said.some(v => v.startsWith('changed') && v.endsWith('dir')), false, 'a folder never says changed');
    for (const line of ['created src/a.js file', 'created new dir', 'created new/deeper dir', 'created new/deeper/b.txt file', 'created new/deeper/c.txt file', 'removed new dir']) {
        assert.ok(said.includes(line), `${line} in ${JSON.stringify(said)}`);
    }
});

test('a folder is watched once however many listen, and the last to leave ends the watch', async function (t) {
    const dir = dir_make(t);
    const count0 = agent_fs_watch.count();
    const one = await watch_open(t, {path: dir});
    const two = await watch_open(t, {path: dir});
    const tree = await watch_open(t, {path: dir, tree: true});
    assert.strictEqual(agent_fs_watch.count(), count0 + 2, 'the same folder asked the same way is one watch');

    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    await one.until(v => v.path === 'a.txt');
    await two.until(v => v.path === 'a.txt');

    one.stream.destroy();
    assert.strictEqual(agent_fs_watch.count(), count0 + 2);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    await two.until(v => v.path === 'b.txt');
    assert.strictEqual(one.lines.some(v => v.path === 'b.txt'), false, 'a listener that left hears nothing more');

    two.stream.destroy();
    tree.stream.destroy();
    assert.strictEqual(agent_fs_watch.count(), count0);
});

test('a folder that is not there is an error, and one that goes ends the watch with one', async function (t) {
    const dir = dir_make(t);
    const missing = agent_fs_watch({path: path.join(dir, 'nothing')});
    const failure = await new Promise(v => missing.on('error', v));
    assert.match(failure.message, /ENOENT/);

    const inner = path.join(dir, 'inner');
    fs.mkdirSync(inner);
    const watch = await watch_open(t, {path: inner});
    const ended = new Promise(v => watch.stream.on('error', v));
    fs.rmSync(inner, {recursive: true});
    assert.match((await ended).message, /is gone|ENOENT/);
    assert.strictEqual(watch.stream.destroyed, true);
});

function dir_make(t)
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fs-watch-'));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}

// A watch opened and read the way the tunnel reads it: its lines, once it says ready
async function watch_open(t, target)
{
    const stream = agent_fs_watch(target);
    t.after(() => stream.destroy());
    const lines = [];
    let rest = '';
    stream.on('data', function (chunk) {
        const parts = (rest + chunk.toString('utf8')).split('\n');
        rest = parts.pop();
        lines.push(...parts.map(v => JSON.parse(v)));
    });
    stream.on('error', function () {});
    const out = {stream, lines, until};
    await until(v => v.type === 'ready');
    return out;
    async function until(ok) {
        const deadline = Date.now() + 5000;
        while (lines.some(ok) === false) {
            if (Date.now() > deadline) {
                throw new Error(`never said: ${JSON.stringify(lines)}`);
            }
            await timers.setTimeout(20);
        }
    }
}
