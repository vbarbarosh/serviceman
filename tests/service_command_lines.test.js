const assert = require('assert');
const child_process = require('child_process');
const path = require('path');
const test = require('node:test');

async function public_default(name)
{
    return (await import(path.join(__dirname, '..', 'src', 'main', 'public', `${name}.js`))).default;
}

const DRAWN = 'sg render -c \'./vk/llama-b12535/llama-server -m bolt.gguf --ctx-size 65536 --jinja --temp -1 --host 127.0.0.1\'';

// A program's What runs edits its command as it is written: one on a line is shown an option a
// line, each carried on to the next by a backslash, and Save keeps lines as they are
test('a command on one line is an option a line, each carried on by a backslash, sg around them as written', async function () {
    const service_command_lines = await public_default('service_command_lines');
    const service_command_join = await public_default('service_command_join');
    const read = service_command_lines(DRAWN);
    assert.deepStrictEqual(read, {lines: ['sg render -c \'./vk/llama-b12535/llama-server \\', '  -m bolt.gguf \\', '  --ctx-size 65536 \\', '  --jinja \\', '  --temp -1 \\', '  --host 127.0.0.1\'']});
    assert.strictEqual(service_command_join(read.lines), 'sg render -c \'./vk/llama-b12535/llama-server \\\n  -m bolt.gguf \\\n  --ctx-size 65536 \\\n  --jinja \\\n  --temp -1 \\\n  --host 127.0.0.1\'');
});

test('the shell reads the lines carried on by a backslash as the one line they were', async function () {
    const service_command_lines = await public_default('service_command_lines');
    const service_command_join = await public_default('service_command_join');
    const line = 'printf \'%s|\' ./server -m \'bolt model.gguf\' --ctx-size 65536 --jinja';
    const read = service_command_lines(line);
    const joined = service_command_join(read.lines);
    assert.notStrictEqual(joined, line);
    assert.strictEqual(child_process.execFileSync('/bin/sh', ['-c', joined], {encoding: 'utf8'}), child_process.execFileSync('/bin/sh', ['-c', line], {encoding: 'utf8'}));
});

test('typed lines are kept as they are written, never joined; blank lines around them and spaces at their ends go', async function () {
    const service_command_join = await public_default('service_command_join');
    assert.strictEqual(service_command_join(['', 'node server.js \\', '   --port 8080  ', '']), 'node server.js \\\n   --port 8080');
    assert.strictEqual(service_command_join(['cd app', 'node server.js']), 'cd app\nnode server.js');
    assert.strictEqual(service_command_join(['', '']), '');
});

test('a quote inside sg\'s quoted command is kept as written, and reads back the same', async function () {
    const service_command_lines = await public_default('service_command_lines');
    const service_command_join = await public_default('service_command_join');
    const command = 'sg video -c \'ffmpeg -i in.mp4 -vf "drawtext=text=\'\\\'\'hi there\'\\\'\'"\'';
    const read = service_command_lines(command);
    assert.deepStrictEqual(read, {lines: ['sg video -c \'ffmpeg \\', '  -i in.mp4 \\', '  -vf "drawtext=text=\'\\\'\'hi there\'\\\'\'"\'']});
    assert.strictEqual(service_command_lines(service_command_join(read.lines)).lines.join('\n'), read.lines.join('\n'));
});

test('a command written over several lines is shown as it is written', async function () {
    const service_command_lines = await public_default('service_command_lines');
    const service_command_join = await public_default('service_command_join');
    const read = service_command_lines('set -e\n  npm install\nnode server.js\n');
    assert.deepStrictEqual(read, {lines: ['set -e', '  npm install', 'node server.js']});
    assert.strictEqual(service_command_join(read.lines), 'set -e\n  npm install\nnode server.js');
});

test('a plain line and what joins two commands each start a line', async function () {
    const service_command_lines = await public_default('service_command_lines');
    assert.deepStrictEqual(service_command_lines('cd app && node server.js --port=8080 | tee log').lines, ['cd app \\', '  && node server.js \\', '  --port=8080 \\', '  | tee log']);
    assert.deepStrictEqual(service_command_lines(''), {lines: []});
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

test('the backslash that carries a line on is no change: only what the line says is', async function () {
    const service_command_diff = await public_default('service_command_diff');
    const diff = service_command_diff(['./llama-server \\', '  --ctx-size 65536 \\', '  --jinja'], ['./llama-server \\', '  --ctx-size 262144 \\', '  --jinja \\', '  --temp 1.0']);
    assert.deepStrictEqual(diff.marks, [{kind: 'same', was: ''}, {kind: 'changed', was: '65536'}, {kind: 'same', was: ''}, {kind: 'new', was: ''}]);
    assert.deepStrictEqual(diff.changes, [{kind: 'changed', text: '--ctx-size 65536 → 262144'}, {kind: 'new', text: '+ --temp 1.0'}]);
});

test('the program changed is said whole; nothing changed says nothing', async function () {
    const service_command_diff = await public_default('service_command_diff');
    const diff = service_command_diff(['./llama-b1', '  --jinja'], ['./llama-b2', '  --jinja']);
    assert.deepStrictEqual(diff.marks, [{kind: 'changed', was: './llama-b1'}, {kind: 'same', was: ''}]);
    assert.deepStrictEqual(diff.changes, [{kind: 'changed', text: './llama-b1 → ./llama-b2'}]);
    assert.deepStrictEqual(service_command_diff(['node a.js'], ['  node a.js  ']).changes, []);
});
