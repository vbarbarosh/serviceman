const assert = require('assert');
const net = require('net');
const test = require('node:test');

// A door that takes the call and says nothing, a proxy half open, is given up within the
// deadline and dialled again later, instead of holding the agent for good
test('a dial that gets no answer is given up within its deadline', async function (t) {
    // The deadline is read when the dial's file loads, so it is set first, short, for this test
    process.env.SERVICEMAN_DIAL_TIMEOUT_MS = '400';
    const agent_connect_path = require.resolve('../src/agent/src/agent_connect');
    delete require.cache[agent_connect_path];
    const agent_connect = require(agent_connect_path);
    const server = net.createServer(function () {
        // Takes the connection and never answers
    });
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(function () {
        server.close();
        delete process.env.SERVICEMAN_DIAL_TIMEOUT_MS;
        delete require.cache[agent_connect_path];
    });
    const began = Date.now();
    await assert.rejects(agent_connect({url: `http://127.0.0.1:${server.address().port}`, token: 'x', machine: 'box', tags: []}), /no answer within 400ms/);
    assert.ok(Date.now() - began < 5000, 'given up, not waited out');
});
