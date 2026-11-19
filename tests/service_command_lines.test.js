const assert = require('assert');
const path = require('path');
const test = require('node:test');

async function public_default(name)
{
    return (await import(path.join(__dirname, '..', 'src', 'main', 'public', `${name}.js`))).default;
}

const DRAWN = 'sg render -c \'./vk/llama-b12535/llama-server -m bolt.gguf --ctx-size 65536 --jinja --temp -1 --host 127.0.0.1\'';

// A program's What runs edits its command an option a line, and Save joins them back into one
test('a command run as a group is its group and an option a line, and joins back as it was', async function () {
    const service_command_lines = await public_default('service_command_lines');
    const service_command_join = await public_default('service_command_join');
    const read = service_command_lines(DRAWN);
    assert.deepStrictEqual(read, {group: 'render', lines: ['./vk/llama-b12535/llama-server', '  -m bolt.gguf', '  --ctx-size 65536', '  --jinja', '  --temp -1', '  --host 127.0.0.1'], script: false});
    assert.strictEqual(service_command_join(read.group, read.lines, read.script), DRAWN);
});

test('typed lines are joined with single spaces; a trailing backslash and empty lines go', async function () {
    const service_command_join = await public_default('service_command_join');
    assert.strictEqual(service_command_join('', ['node server.js \\', '', '   --port 8080  ', ''], false), 'node server.js --port 8080');
    assert.strictEqual(service_command_join('render', ['', ''], false), '');
});

test('a quote inside a group\'s command is kept, and reads back the same', async function () {
    const service_command_lines = await public_default('service_command_lines');
    const service_command_join = await public_default('service_command_join');
    const command = service_command_join('video', ['ffmpeg', '  -i in.mp4', '  -vf "drawtext=text=\'hi there\'"'], false);
    assert.strictEqual(command, 'sg video -c \'ffmpeg -i in.mp4 -vf "drawtext=text=\'\\\'\'hi there\'\\\'\'"\'');
    assert.deepStrictEqual(service_command_lines(command), {group: 'video', lines: ['ffmpeg', '  -i in.mp4', '  -vf "drawtext=text=\'hi there\'"'], script: false});
});

test('a command written over several lines is a script: its lines stay lines', async function () {
    const service_command_lines = await public_default('service_command_lines');
    const service_command_join = await public_default('service_command_join');
    const read = service_command_lines('set -e\n  npm install\nnode server.js\n');
    assert.deepStrictEqual(read, {group: '', lines: ['set -e', '  npm install', 'node server.js'], script: true});
    assert.strictEqual(service_command_join('', read.lines, true), 'set -e\n  npm install\nnode server.js');
});

test('a plain line and what joins two commands each start a line', async function () {
    const service_command_lines = await public_default('service_command_lines');
    assert.deepStrictEqual(service_command_lines('cd app && node server.js --port=8080 | tee log').lines, ['cd app', '  && node server.js', '  --port=8080', '  | tee log']);
    assert.deepStrictEqual(service_command_lines(''), {group: '', lines: [], script: false});
});

// The open card marks a changed line with what it was, and its foot says the change alone
test('a changed option is said as its old value and its new one; new and gone lines are said', async function () {
    const service_command_diff = await public_default('service_command_diff');
    const before = ['./llama-server', '  --ctx-size 65536', '  --jinja', '  --host 127.0.0.1'];
    const after = ['./llama-server', '  --ctx-size 262144', '', '  --host 127.0.0.1', '  --temp 1.0'];
    const diff = service_command_diff(before, after);
    assert.deepStrictEqual(diff.marks, [{kind: 'same', was: ''}, {kind: 'changed', was: '65536'}, {kind: '', was: ''}, {kind: 'same', was: ''}, {kind: 'new', was: ''}]);
    assert.deepStrictEqual(diff.changes, [{kind: 'changed', text: '--ctx-size 65536 → 262144'}, {kind: 'new', text: '+ --temp 1.0'}, {kind: 'gone', text: '− --jinja'}]);
});

test('the program changed is said whole; nothing changed says nothing', async function () {
    const service_command_diff = await public_default('service_command_diff');
    const diff = service_command_diff(['./llama-b1', '  --jinja'], ['./llama-b2', '  --jinja']);
    assert.deepStrictEqual(diff.marks, [{kind: 'changed', was: './llama-b1'}, {kind: 'same', was: ''}]);
    assert.deepStrictEqual(diff.changes, [{kind: 'changed', text: './llama-b1 → ./llama-b2'}]);
    assert.deepStrictEqual(service_command_diff(['node a.js'], ['  node a.js  ']).changes, []);
});
