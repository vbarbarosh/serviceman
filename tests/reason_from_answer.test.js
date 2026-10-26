const assert = require('assert');
const reason_from_answer = require('../src/helpers/reason_from_answer');
const test = require('node:test');

// apt-get update that fails: its stdout ends where it stopped, its reason is on stderr, a W:
// after the E:
test('a failed apt-get names its E: line, not the last line it printed on stdout', function () {
    const answer = {
        code: 100,
        stdout: 'Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\nGet:2 https://download.docker.com/linux/ubuntu noble InRelease [48.8 kB]\nReading package lists...',
        stderr: 'E: Could not get lock /var/lib/apt/lists/lock. It is held by process 1234 (apt-get)\nE: Unable to lock directory /var/lib/apt/lists/\nW: Problem unlinking the file /var/cache/apt/pkgcache.bin',
    };
    assert.strictEqual(reason_from_answer(answer), 'E: Unable to lock directory /var/lib/apt/lists/');
});

test('without an error line it is the last line of stderr, then of stdout, then nothing', function () {
    assert.strictEqual(reason_from_answer({stdout: 'Reading package lists...', stderr: 'sudo: a password is required\n'}), 'sudo: a password is required');
    assert.strictEqual(reason_from_answer({stdout: 'latest: Pulling from library/node\n', stderr: 'Error response from daemon: manifest for node:99 not found\n'}), 'Error response from daemon: manifest for node:99 not found');
    assert.strictEqual(reason_from_answer({stdout: 'Status: inactive\n\n', stderr: ''}), 'Status: inactive');
    assert.strictEqual(reason_from_answer({stdout: '', stderr: ''}), null);
    assert.strictEqual(reason_from_answer({}), null);
});
