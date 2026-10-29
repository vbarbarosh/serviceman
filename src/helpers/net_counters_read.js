const fs = require('fs');
const path = require('path');

// The counters of this machine's network that tell what it dropped and what it sent again:
// UDP datagrams its buffers had no room for, coming or going, and TCP segments sent again with
// the timeouts behind them; with the most a UDP socket may be given to buffer. Since the
// machine started, so two readings tell what happened between them. From /proc: null where
// there is none, a machine that is not Linux.
const WANTED = {
    Udp: {InDatagrams: 'udp_in', InErrors: 'udp_in_errors', RcvbufErrors: 'udp_rcvbuf_errors', SndbufErrors: 'udp_sndbuf_errors'},
    Tcp: {OutSegs: 'tcp_out', RetransSegs: 'tcp_retrans'},
    TcpExt: {TCPTimeouts: 'tcp_timeouts'},
};

function net_counters_read(root)
{
    const base = (root === undefined) ? '/proc' : root;
    const out = {};
    try {
        pairs_read(fs.readFileSync(path.join(base, 'net/snmp'), 'utf8'), out);
    }
    catch {
        return null;
    }
    out.tcp_timeouts = null;
    out.rmem_max = null;
    // These two a sandbox may hide, and the rest still says what it says
    try {
        pairs_read(fs.readFileSync(path.join(base, 'net/netstat'), 'utf8'), out);
    }
    catch {
        // left null
    }
    try {
        out.rmem_max = parseInt(fs.readFileSync(path.join(base, 'sys/net/core/rmem_max'), 'utf8'), 10);
    }
    catch {
        // left null
    }
    return out;
}

// The file says a table in two lines: `Udp: InDatagrams NoPorts …` then `Udp: 1944740 3 …`
function pairs_read(text, out)
{
    const lines = text.split('\n');
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const names = lines[i].split(/\s+/);
        const values = lines[i + 1].split(/\s+/);
        const table = names[0].replace(/:$/, '');
        const wanted = WANTED[table];
        if ((wanted === undefined) || (values[0] !== names[0])) {
            continue;
        }
        for (let j = 1; j < names.length; j++) {
            if (wanted[names[j]] !== undefined) {
                out[wanted[names[j]]] = Number(values[j]);
            }
        }
    }
}

module.exports = net_counters_read;
