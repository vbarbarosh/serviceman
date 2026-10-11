const fs = require('fs');

const NET_DEV = '/proc/net/dev';
const SYS_NET = '/sys/class/net';

// The bytes the machine has taken in and sent out since it booted, over its own network cards.
// A container's traffic crosses its veth and then the card, and a tailnet's crosses tailscale0
// and then the card: counting only the cards counts each byte once. A machine that shows no
// card, a container above all, counts everything but loopback. null off linux.
function agent_net_bytes()
{
    let text;
    try {
        text = fs.readFileSync(NET_DEV, 'utf8');
    }
    catch {
        return null;
    }
    const rows = [];
    for (const line of text.split('\n').slice(2)) {
        const found = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
        if (found === null) {
            continue;
        }
        const fields = found[2].trim().split(/\s+/);
        rows.push({name: found[1], rx: parseInt(fields[0], 10), tx: parseInt(fields[8], 10)});
    }
    const cards = rows.filter(v => fs.existsSync(`${SYS_NET}/${v.name}/device`));
    const counted = ((cards.length > 0) ? cards : rows.filter(v => v.name !== 'lo'));
    const out = {rx: 0, tx: 0};
    for (const row of counted) {
        out.rx += row.rx;
        out.tx += row.tx;
    }
    return out;
}

module.exports = agent_net_bytes;
