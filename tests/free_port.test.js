const assert = require('assert');
const free_port = require('./free_port');
const net = require('net');
const test = require('node:test');

// A port given to a test's program is never one the system may hand serviceman's own doors,
// which listen on port 0: the lifecycle test once had its program's port taken by serviceman's
// door, answered 404 at once, and failed on a 502
test('a test\'s port is free, given once, and below every port a listener on 0 gets', async function () {
    const ports = [];
    for (let i = 0; i < 50; i++) {
        ports.push(await free_port());
    }
    assert.strictEqual(new Set(ports).size, ports.length, 'each port is given once');
    assert.ok(ports.every(v => v >= 20000), 'none of the well-known or most used ones');
    const servers = [];
    try {
        for (let i = 0; i < 20; i++) {
            servers.push(await listen_on(0));
        }
        const lowest = Math.min(...servers.map(v => v.address().port));
        assert.ok(ports.every(v => v < lowest), `every port given is below ${lowest}, the lowest a listener on 0 got`);
        for (const port of ports.slice(0, 5)) {
            servers.push(await listen_on(port));
        }
    }
    finally {
        for (const server of servers) {
            server.close();
        }
    }
});

function listen_on(port)
{
    return new Promise(function (resolve, reject) {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', function () {
            resolve(server);
        });
    });
}
