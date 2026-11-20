const fs = require('fs');
const net = require('net');

// The first port the tests take from: above the well-known and the most used ones
const FIRST = 20000;

// The lowest port the system hands a listener on port 0 (Linux says it in /proc; 32768 is its
// default, and below the range of others)
const EPHEMERAL_LOW = ephemeral_low();

// The ports already given in this test file
const given = new Set();

// A port free on 127.0.0.1, for a program a test starts and points serviceman at. Never one of
// the system's own range: a port from there, freed at once, could be handed again to one of
// serviceman's doors, which listen on port 0, before the program listens on it; the program then
// fails to start, and the door answers in its place, a 404 at once and 502s after. Each port is
// given once per file, and only when it binds.
//
//     await free_port()   43259 before, now a port between 20000 and the system's range
async function free_port()
{
    for (let i = 0; i < 200; i++) {
        const port = FIRST + Math.floor(Math.random()*(EPHEMERAL_LOW - FIRST));
        if ((given.has(port) === false) && (await port_binds(port))) {
            given.add(port);
            return port;
        }
    }
    throw new Error(`no free port between ${FIRST} and ${EPHEMERAL_LOW}`);
}

// Whether a listener can take this port on 127.0.0.1 now; it is let go at once
function port_binds(port)
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.once('error', function () {
            resolve(false);
        });
        server.listen(port, '127.0.0.1', function () {
            server.close(function () {
                resolve(true);
            });
        });
    });
}

function ephemeral_low()
{
    try {
        const low = Number(fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/)[0]);
        return (Number.isInteger(low) && (low > FIRST + 1000)) ? low : 32768;
    }
    catch {
        return 32768;
    }
}

module.exports = free_port;
