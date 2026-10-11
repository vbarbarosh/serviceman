const assert = require('assert');
const test = require('node:test');

const STALE = 'bin/update ran to the end, and this agent is still the old one — it said: serviceman: the agent is up';

test('an agent from before the fix that refuses over the last run is asked once more', async function () {
    const answers = [{started: false, reason: STALE}, {started: true}];
    const asked = stub_remote_call(answers);
    const remote_update_call = require('../src/main/src/helpers/remote_update_call');
    assert.deepStrictEqual(await remote_update_call({}, {name: 'vps1'}), {started: true});
    assert.strictEqual(asked.length, 2);

    // Any other refusal is the answer as it is, asked once
    answers.push({started: false, reason: 'bin/update failed with code 7: curl: (7) Failed to connect'});
    asked.length = 0;
    assert.deepStrictEqual(await remote_update_call({}, {name: 'vps1'}), {started: false, reason: 'bin/update failed with code 7: curl: (7) Failed to connect'});
    assert.strictEqual(asked.length, 1);
});

// remote_call answers from the list, one per ask, and keeps the methods it was asked
function stub_remote_call(answers)
{
    const out = [];
    const remote_call_path = require.resolve('../src/main/src/helpers/remote_call');
    require.cache[remote_call_path] = {id: remote_call_path, filename: remote_call_path, loaded: true, exports: async function (app, remote, method) {
        out.push(method);
        return answers.shift();
    }};
    return out;
}
