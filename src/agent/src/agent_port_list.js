const agent_shell = require('./agent_shell');
const argv_line = require('../../helpers/argv_line');

// What ss prints for one socket: the protocol, the state, the two queues, the address it is
// listening on, the peer column that a listener leaves empty, and — where this agent may see
// it — what is holding it
const RE_LINE = /^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/;
// users:(("redis-server",pid=812,fd=6),("redis-server",pid=812,fd=7))
const RE_USER = /\("([^"]+)",pid=(\d+)/g;
const SS_ARGV = ['ss', '-tulpn'];

// Every port this machine is listening on: tcp and udp, v4 and v6, numbers rather than the
// names in /etc/services. A socket another user owns is listed either way — its process is
// named only where the agent may look, which is its own sockets, or all of them when it is
// root.
async function agent_port_list()
{
    const answer = await agent_shell(SS_ARGV);
    if (answer.ok === false) {
        throw new Error(`ss: ${answer.stderr}`);
    }
    const items = [];
    for (const line of answer.stdout.split('\n')) {
        const found = RE_LINE.exec(line.trim());
        if ((found === null) || (found[1] === 'Netid')) {
            continue;
        }
        const local = address_split(found[5]);
        items.push({
            proto: found[1],
            port: local.port,
            address: local.address,
            state: found[2],
            users: users_from_text(found[7]),
        });
    }
    // By port, so the same number over tcp and udp, or over v4 and v6, stands together
    items.sort((a, b) => ((a.port === b.port) ? a.proto.localeCompare(b.proto) : a.port - b.port));
    return {at: Date.now(), items, commands: [argv_line(SS_ARGV)]};
}

// `0.0.0.0:80`, `[::]:80`, `*:68`, `[fe80::1]%eth0:546` — the port is what follows the last
// colon, and the brackets around a v6 address are ss's, not the address's
function address_split(text)
{
    const at = text.lastIndexOf(':');
    const address = text.slice(0, at);
    return {
        address: ((address.startsWith('[') && address.includes(']')) ? address.slice(1, address.indexOf(']')) : address),
        // `*` where ss has no number to print, which is a socket bound to nothing
        port: parseInt(text.slice(at + 1), 10) || 0,
    };
}

function users_from_text(text)
{
    const out = [];
    for (const found of text.matchAll(RE_USER)) {
        out.push({pid: parseInt(found[2], 10), name: found[1]});
    }
    return out;
}

module.exports = agent_port_list;
