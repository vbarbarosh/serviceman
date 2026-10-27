const assert = require('assert');
const test = require('node:test');
const updates_check = require('../src/main/src/helpers/updates_check');

const NOW = Date.parse('2026-10-27T21:00:00Z');
const HOUR = 3600*1000;

// Nothing waiting is up to date only while apt's lists are fresh: counted from lists days old
// it is grey and says how old they are, and a count of what waits says so beside it
test('nothing waiting, counted from lists days old, is not up to date', function () {
    const fresh = updates_check({pending: 0, security: 0, held: 0, reboot: false, lists_at: NOW - 5*HOUR}, NOW);
    assert.deepStrictEqual([fresh.state, fresh.text, fresh.detail], ['ok', 'up to date', null]);
    const old = updates_check({pending: 0, security: 0, held: 0, reboot: false, lists_at: NOW - 9*24*HOUR - HOUR}, NOW);
    assert.deepStrictEqual([old.state, old.text], ['none', 'lists 9 days old']);
    assert.match(old.detail, /^apt last fetched its package lists 9 days ago, so an update published since is not counted\./);
    const waiting = updates_check({pending: 4, security: 1, held: 0, reboot: false, lists_at: NOW - 3*24*HOUR}, NOW);
    assert.deepStrictEqual([waiting.state, waiting.text], ['warn', '1 security']);
    assert.deepStrictEqual(waiting.detail.split('\n').map(v => v.slice(0, 40)), ['1 security update of 4 pending: Configur', 'apt last fetched its package lists 3 day']);
});

// An agent from before the lists' age says none: the check is as it was
test('a count with no lists\' age is said as before', function () {
    assert.deepStrictEqual(updates_check({pending: 0, security: 0, reboot: false}, NOW), {key: 'updates', label: 'Updates', state: 'ok', text: 'up to date', detail: null});
    assert.deepStrictEqual(updates_check({pending: 2, security: 0, reboot: false, lists_at: null}, NOW).text, '2 pending');
    assert.strictEqual(updates_check(null, NOW), null);
});
