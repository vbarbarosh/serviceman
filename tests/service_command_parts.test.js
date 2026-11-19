const assert = require('assert');
const path = require('path');
const test = require('node:test');

async function parts_of(line)
{
    const service_command_parts = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'service_command_parts.js'))).default;
    return service_command_parts(line);
}

// A program run as a group reads as the group, the program and each option with its value
test('sg <group> -c \'…\' is read as its group, the program and its options', async function () {
    const parts = await parts_of('sg render -c \'./llama-server -m bolt.gguf --ctx-size 65536 --jinja --host 127.0.0.1\'');
    assert.strictEqual(parts.group, 'render');
    assert.strictEqual(parts.lead, 'sg render -c');
    assert.strictEqual(parts.program, './llama-server');
    assert.deepStrictEqual(parts.options, [{flag: '-m', value: 'bolt.gguf'}, {flag: '--ctx-size', value: '65536'}, {flag: '--jinja', value: ''}, {flag: '--host', value: '127.0.0.1'}]);
});

test('a plain line has no group; a word with no flag is an option of its own', async function () {
    const parts = await parts_of('node server.js --port=8080 "a b"');
    assert.strictEqual(parts.group, '');
    assert.strictEqual(parts.lead, '');
    assert.strictEqual(parts.program, 'node');
    assert.deepStrictEqual(parts.options, [{flag: '', value: 'server.js'}, {flag: '--port=8080', value: ''}, {flag: '', value: 'a b'}]);
});

test('an empty line is nothing to read', async function () {
    const parts = await parts_of('');
    assert.deepStrictEqual(parts, {group: '', lead: '', program: '', options: []});
});

test('a quote inside a group\'s quoted line, written \'\\\'\', is read as a quote', async function () {
    const parts = await parts_of('sg video -c \'ffmpeg -vf "text=\'\\\'\'hi\'\\\'\'"\'');
    assert.strictEqual(parts.group, 'video');
    assert.deepStrictEqual(parts.options, [{flag: '-vf', value: 'text=\'hi\''}]);
});
