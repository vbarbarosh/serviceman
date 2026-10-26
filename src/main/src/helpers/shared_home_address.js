// The address the other machines reach a home at: its tailnet IPv4 address, which WireGuard
// encrypts, and nothing public. null when the machine says it has none.
function shared_home_address(remote)
{
    const resources = remote.state.resources;
    const addresses = ((resources === null) || (Array.isArray(resources.addresses) === false)) ? [] : resources.addresses;
    const found = addresses.find(v => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v));
    return (found === undefined) ? null : found;
}

module.exports = shared_home_address;
