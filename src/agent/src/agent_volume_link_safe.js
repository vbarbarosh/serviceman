const net = require('net');

// Whether a key may travel over the link this agent dialled: TLS, a socket file, this machine
// itself, or the tailnet (100.64.0.0/10, fd7a:115c:a1e0::/48 and its *.ts.net names), which
// WireGuard encrypts. Plain http to anywhere else would show the key to every hop on the way.
// `address` is where the link's socket went: a bare MagicDNS name, `http://serviceman:3001`,
// says nothing by itself, the tailnet address it reached does.
function agent_volume_link_safe(url_text, address)
{
    let url;
    try {
        url = new URL(url_text);
    }
    catch {
        return false;
    }
    if ((url.protocol === 'https:') || (url.protocol === 'unix:')) {
        return true;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if ((host === 'localhost') || host.endsWith('.localhost') || host.endsWith('.ts.net')) {
        return true;
    }
    return address_safe(host) || ((typeof address === 'string') && address_safe(address));
}

function address_safe(address)
{
    const ip = address.replace(/^::ffff:/i, '');
    if (net.isIPv4(ip)) {
        const octets = ip.split('.').map(Number);
        return (octets[0] === 127) || ((octets[0] === 100) && (octets[1] >= 64) && (octets[1] <= 127));
    }
    if (net.isIPv6(ip)) {
        return (ip === '::1') || /^fd7a:115c:a1e0:/i.test(ip);
    }
    return false;
}

module.exports = agent_volume_link_safe;
