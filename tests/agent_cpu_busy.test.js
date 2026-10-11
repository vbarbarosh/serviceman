const agent_cpu_busy = require('../src/agent/src/agent_cpu_busy');
const assert = require('assert');
const test = require('node:test');

test('cpu use is a share of the cores, measured between two readings', async function () {
    // The first reading measures a short window of its own, so it has a value at once
    const first = await agent_cpu_busy();
    assert.strictEqual(typeof first, 'number');
    assert.ok((first >= 0) && (first <= 1), `first reading ${first}`);
    // Keep one core busy for a while: the next reading, over that time, is above nothing
    const until = Date.now() + 400;
    while (Date.now() < until) {
        Math.sqrt(Math.random());
    }
    const busy = await agent_cpu_busy();
    assert.ok((busy > 0) && (busy <= 1), `busy reading ${busy}`);
});
