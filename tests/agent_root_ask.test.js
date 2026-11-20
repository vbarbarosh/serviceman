const agent_root_ask = require('../src/agent/src/agent_root_ask');
const agent_root_there = require('../src/agent/src/agent_root_there');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');

// A root half on a socket of the test's own: `answer` decides what each job gets, and every
// job asked is kept, by its method
async function root_fake(answer)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-root-'));
    const file = path.join(dir, 'root.sock');
    const asked = [];
    const server = net.createServer(function (socket) {
        let rest = '';
        socket.on('data', function (chunk) {
            rest += chunk.toString('utf8');
            const at = rest.indexOf('\n');
            if (at === -1) {
                return;
            }
            const job = JSON.parse(rest.slice(0, at));
            asked.push(job.method);
            answer(job, socket);
        });
        socket.on('error', function () {});
    });
    await new Promise(v => server.listen(file, v));
    return {options: {root_socket: file}, asked, close: () => server.close()};
}

function reply(socket, value)
{
    socket.end(`${JSON.stringify({type: 'reply', ok: true, value})}\n`);
}

// A root half whose one thread waits on a stalled sshfs takes every connection and answers
// none: the hello and bin/status waited on it forever
test('a root half that takes a ping and answers nothing is said stuck, and no job waits on it', async function () {
    const root = await root_fake(function () {});
    try {
        const t0 = Date.now();
        assert.strictEqual(await agent_root_there.state(root.options), 'stuck');
        assert.ok(Date.now() - t0 < 6000);
        await assert.rejects(agent_root_ask(root.options, 'mounts', {}), v => (v.code === 'ROOTSTUCK'));
        // The job itself was never sent: the ping before it found the root half stuck
        assert.deepStrictEqual(root.asked, ['ping', 'ping']);
    }
    finally {
        root.close();
    }
});

test('a root half that answers takes the job; one answer vouches for it for half a minute', async function () {
    const root = await root_fake((job, socket) => reply(socket, {method: job.method}));
    try {
        assert.deepStrictEqual(await agent_root_ask(root.options, 'mounts', {}), {method: 'mounts'});
        assert.deepStrictEqual(await agent_root_ask(root.options, 'ufw', {}), {method: 'ufw'});
        assert.deepStrictEqual(root.asked, ['ping', 'mounts', 'ufw']);
        assert.strictEqual(await agent_root_there.state(root.options), 'answers');
    }
    finally {
        root.close();
    }
});

test('no socket is no root half, not a stuck one', async function () {
    const options = {root_socket: path.join(os.tmpdir(), `serviceman-no-root-${process.pid}.sock`)};
    assert.strictEqual(await agent_root_there.state(options), 'none');
    await assert.rejects(agent_root_ask(options, 'mounts', {}), v => (v.code === 'NOROOT'));
});
