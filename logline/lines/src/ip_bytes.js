const net = require('net');

// "100.64.1.7" -> 4 bytes, "fd7a:115c::1" -> 16 bytes, anything else -> null. An IPv4 address
// written the IPv6 way, "::ffff:100.64.1.7", is the IPv4 address: a node server says that for
// every IPv4 caller when it listens on both.
function ip_bytes(text)
{
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
    const bare = (mapped === null) ? text : mapped[1];
    if (net.isIPv4(bare)) {
        return Buffer.from(bare.split('.').map(v => parseInt(v, 10)));
    }
    if (net.isIPv6(bare) === false) {
        return null;
    }
    const halves = bare.split('::');
    const head = (halves[0] === '') ? [] : halves[0].split(':');
    const tail = ((halves.length < 2) || (halves[1] === '')) ? [] : halves[1].split(':');
    const words = head.concat(new Array(8 - head.length - tail.length).fill('0'), tail);
    const out = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
        out.writeUInt16BE(parseInt(words[i], 16), i*2);
    }
    return out;
}

module.exports = ip_bytes;
