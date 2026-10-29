const stream = require('stream');

// The most a pour may send, and for how long, whatever the host asks: a test, not a flood
const POUR_BYTES_MOST = 512*1024*1024;
const POUR_MS_MOST = 30000;
const PIECE_BYTES = 64*1024;
const ZEROS = Buffer.alloc(PIECE_BYTES);

// The two ends of a link test (link_test on the host). A sink takes whatever the host sends
// and keeps none of it, answering each piece as soon as it is in, so the host times the link
// and nothing else; when the host is done it says how many bytes came, in one line. A pour
// sends zeros to the host until it has sent `bytes` or `ms` is up, as fast as the link takes
// them. Each answers the way a socket does, which is all a tunnelled stream asks of its end.
const agent_net_test = {
    sink: function () {
        let bytes = 0;
        const out = new stream.Duplex({
            write: function (chunk, encoding, done) {
                bytes += chunk.length;
                done();
            },
            final: function (done) {
                out.push(Buffer.from(`${JSON.stringify({bytes})}\n`));
                out.push(null);
                done();
            },
            read: function () {},
        });
        out.setNoDelay = function () {};
        return out;
    },
    pour: function (target) {
        const most = Math.min(POUR_BYTES_MOST, Math.max(0, Number(target.bytes) || 0));
        const until = Date.now() + Math.min(POUR_MS_MOST, Math.max(0, Number(target.ms) || 0));
        let sent = 0;
        const out = new stream.Duplex({
            write: function (chunk, encoding, done) {
                done();
            },
            read: function () {
                if ((sent >= most) || (Date.now() >= until)) {
                    out.push(null);
                    return;
                }
                const piece = (most - sent < PIECE_BYTES) ? ZEROS.subarray(0, most - sent) : ZEROS;
                sent += piece.length;
                out.push(piece);
            },
        });
        out.setNoDelay = function () {};
        return out;
    },
};

module.exports = agent_net_test;
