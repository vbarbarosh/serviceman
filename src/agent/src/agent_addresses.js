const os = require('os');

// Bridges docker and its kin make on every machine alike: an address on one says nothing about
// which machine a caller is
const RE_BRIDGE = /^(docker\d*|br-|veth|podman|cni|virbr)/;

// The addresses other machines may see this one at — the ones Logline binds its token to.
// Loopback, link-local and container bridges are left out: every machine has the same ones.
function agent_addresses()
{
    const out = [];
    const all = os.networkInterfaces();
    for (const name of Object.keys(all)) {
        if (RE_BRIDGE.test(name)) {
            continue;
        }
        for (const item of all[name]) {
            if (item.internal || item.address.toLowerCase().startsWith('fe80:')) {
                continue;
            }
            if (out.includes(item.address) === false) {
                out.push(item.address);
            }
        }
    }
    out.sort();
    return out;
}

module.exports = agent_addresses;
