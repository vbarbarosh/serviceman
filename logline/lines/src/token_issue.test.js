const assert = require('assert');
const test = require('node:test');
const token_find = require('./token_find');
const token_issue = require('./token_issue');

test('a name asked for twice with the same addresses keeps its token; new addresses get a new one', function () {
    const first = token_issue([], 'vps1', ['100.64.1.7', '100.64.1.8'], 0);
    assert.match(first.item.token, /^[0-9a-f]{64}$/);
    const again = token_issue(first.tokens, 'vps1', ['100.64.1.8', '100.64.1.7'], 1000);
    assert.strictEqual(again.item.token, first.item.token, 'the order of the addresses does not matter');
    assert.strictEqual(again.tokens, first.tokens);

    const moved = token_issue(again.tokens, 'vps1', ['100.64.1.9'], 2000);
    assert.notStrictEqual(moved.item.token, first.item.token);
    assert.deepStrictEqual(moved.tokens.map(v => v.name), ['vps1'], 'the old token is gone');
    assert.strictEqual(token_find(moved.tokens, first.item.token), null);
    assert.strictEqual(token_find(moved.tokens, moved.item.token).name, 'vps1');
    assert.strictEqual(token_find(moved.tokens, ''), null);
});
