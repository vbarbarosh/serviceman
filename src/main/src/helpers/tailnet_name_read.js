const tailscale_run = require('./tailscale_run');

const TIMEOUT_MS = 5000;
// A host that is not on the tailnet yet may be in a minute; it is asked again after this long
const RETRY_MS = 60000;

const known = {name: null, at: 0};

// serviceman's own name on the tailnet, as tailscale in its image says (MagicDNS:
// serviceman.tail1234.ts.net), or null where it runs without one. A machine on the tailnet
// reaches serviceman's doors by it, so a new agent is told to dial it.
function tailnet_name_read()
{
    if ((known.name !== null) || (Date.now() - known.at < RETRY_MS)) {
        return Promise.resolve(known.name);
    }
    return new Promise(function (resolve) {
        tailscale_run(['status', '--json'], {timeout: TIMEOUT_MS, maxBuffer: 8*1024*1024}, function (error, stdout) {
            known.at = Date.now();
            known.name = (error === null) ? name_of(stdout) : null;
            resolve(known.name);
        });
    });
}

// The name in tailscale's answer, without the dot DNS ends it with
function name_of(text)
{
    try {
        const name = String(JSON.parse(text).Self.DNSName || '').replace(/\.$/, '');
        return /^[a-z0-9.-]+$/i.test(name) ? name : null;
    }
    catch {
        return null;
    }
}

// The name as last read, for an answer that cannot wait for tailscale
tailnet_name_read.known = function () {
    return known.name;
};

tailnet_name_read.name_of = name_of;

module.exports = tailnet_name_read;
