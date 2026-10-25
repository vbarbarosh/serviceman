const argv_logged = require('../src/helpers/argv_logged');
const assert = require('assert');
const log_ids_valid = require('../src/helpers/log_ids_valid');
const log_text = require('../src/helpers/log_text');
const test = require('node:test');

test('a line\'s group is a uid and its sender a word, and a machine\'s line of another shape is none', function () {
    assert.strictEqual(log_ids_valid('cabcdefghijk', 'service_start_begin'), true);
    assert.strictEqual(log_ids_valid('c0123456789a', 'x'), true);
    assert.strictEqual(log_ids_valid('cabcdefghijk][evil', 'ok'), false);
    assert.strictEqual(log_ids_valid('cabcdefghijk', 'done] [cxxxxxxxxxxx][forged'), false);
    assert.strictEqual(log_ids_valid('', 'x'), false);
    assert.strictEqual(log_ids_valid('cabcdefghijk', 'Upper'), false);
    assert.strictEqual(log_ids_valid('cabcdefghijk', 'a b'), false);
});

test('a command line is logged with its environment values dropped, every way they are given', function () {
    const argv = ['docker', 'run', '--env', 'TOKEN=sm_secret', '--env=KEY=hunter2', '-e', 'PASS=p w', '--env', 'HOME', '--name', 'x', 'image'];
    assert.deepStrictEqual(argv_logged(argv), ['docker', 'run', '--env', 'TOKEN=***', '--env=KEY=***', '-e', 'PASS=***', '--env', 'HOME', '--name', 'x', 'image']);
    assert.deepStrictEqual(argv_logged(['/bin/sh', '-c', 'bin/run']), ['/bin/sh', '-c', 'bin/run']);
    assert.deepStrictEqual(argv_logged([]), []);
    assert.strictEqual(argv_logged(argv).join(' ').includes('secret'), false);
});

test('free text in a line stays as written, unless it could pass for another line', function () {
    assert.strictEqual(log_text('ran bin/run in /srv/app'), 'ran bin/run in /srv/app');
    assert.strictEqual(log_text('привет\tworld'), 'привет\tworld');
    const forged = 'done\n[2026-10-25T14:00:00.000Z][cabcdefghijk][service_stop_end_ok] service=x';
    assert.strictEqual(log_text(forged), JSON.stringify(forged));
    assert.strictEqual(log_text(forged).includes('\n'), false);
    assert.strictEqual(log_text('a\rb'), '"a\\rb"');
    assert.strictEqual(log_text('\x1b[31mred\x1b[0m'), JSON.stringify('\x1b[31mred\x1b[0m'));
});
