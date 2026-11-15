const agent_addresses = require('./agent_addresses');
const agent_shell = require('./agent_shell');
const is_tailnet_address = require('../../helpers/is_tailnet_address');

// tailscale answers at once where it runs: one that hangs must not hold the dial or the hello
const TAILSCALE_SAY_MS = 3000;

// This machine on the tailnet, as its own tailscale says: {name, ip}, the name MagicDNS gives
// it (laptop.tail1234.ts.net) and its IPv4 address there, each null where it is not known; null
// for a machine on no tailnet. serviceman shows the name beside the machine's own, and names a
// machine that joins after it. Where tailscale cannot be asked (not installed, not running), the
// address is still the one on its own interfaces. options.tailscale is the command, tailscale.
async function agent_tailnet(options)
{
    const answer = await agent_shell([options.tailscale, 'status', '--json'], {timeout: TAILSCALE_SAY_MS});
    const said = answer.ok ? tailnet_of(answer.stdout) : {name: null, ip: null};
    const ip = (said.ip !== null) ? said.ip : (agent_addresses().find(v => v.includes('.') && is_tailnet_address(v)) || null);
    if ((said.name === null) && (ip === null)) {
        return null;
    }
    return {name: said.name, ip};
}

// The name and the address in tailscale's answer, without the dot DNS ends a name with
function tailnet_of(text)
{
    let self;
    try {
        self = JSON.parse(text).Self;
    }
    catch {
        return {name: null, ip: null};
    }
    if ((self === null) || (typeof self !== 'object')) {
        return {name: null, ip: null};
    }
    const name = String(self.DNSName || '').replace(/\.$/, '').toLowerCase();
    const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.map(String) : [];
    return {
        name: /^[a-z0-9][a-z0-9.-]*$/.test(name) ? name : null,
        ip: ips.find(v => v.includes('.') && is_tailnet_address(v)) || null,
    };
}

agent_tailnet.tailnet_of = tailnet_of;

module.exports = agent_tailnet;
