const fs = require('fs');

const TABLES = ['/proc/net/tcp', '/proc/net/tcp6'];
// The state column of a connection that is up, in the kernel's own numbering
const ESTABLISHED = '01';

// How many tcp connections the machine holds open right now, v4 and v6: the ones up, not the
// sockets listening or closing. An agent in a container sees its own network only. null off
// linux.
function agent_tcp_count()
{
    let out = null;
    for (const file of TABLES) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        out = ((out === null) ? 0 : out);
        for (const line of text.split('\n').slice(1)) {
            const fields = line.trim().split(/\s+/);
            if (fields[3] === ESTABLISHED) {
                out++;
            }
        }
    }
    return out;
}

module.exports = agent_tcp_count;
