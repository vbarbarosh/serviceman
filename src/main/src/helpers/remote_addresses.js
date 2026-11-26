const net = require('net');

// The addresses a machine is reached at: those its agent says its machine has (loopback,
// link-local and docker's bridges left out), and the one its agent dials serviceman from, the
// public address a machine behind its provider's NAT has nowhere on itself. Answers
// {all, public}: every one, and the first that is the internet's (not 10/8, 172.16/12,
// 192.168/16, 100.64/10, the tailnet's), or null when it has none.
function remote_addresses(remote)
{
    const all = [];
    const said = ((remote.state.resources === null) || (Array.isArray(remote.state.resources.addresses) === false)) ? [] : remote.state.resources.addresses;
    const dialled = (typeof remote.state.address === 'string') ? remote.state.address.replace(/^::ffff:(?=\d+\.)/, '') : '';
    for (const address of said.concat([dialled])) {
        if ((net.isIP(address) !== 0) && (all.includes(address) === false) && (loopback(address) === false)) {
            all.push(address);
        }
    }
    return {all, public: all.find(v => internet(v)) || null};
}

function loopback(address)
{
    return (address === '::1') || address.startsWith('127.');
}

// Whether an IPv4 address is the internet's, not a private network's or the tailnet's; an IPv6
// one, whether it is global unicast (2000::/3)
function internet(address)
{
    if (net.isIPv6(address)) {
        return /^[23][0-9a-f]{0,3}:/i.test(address);
    }
    const [a, b] = address.split('.').map(Number);
    if ((a === 10) || ((a === 172) && (b >= 16) && (b <= 31)) || ((a === 192) && (b === 168)) || ((a === 169) && (b === 254))) {
        return false;
    }
    return ((a === 100) && (b >= 64) && (b <= 127)) === false;
}

module.exports = remote_addresses;
