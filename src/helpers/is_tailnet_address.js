// A tailnet address: tailscale's 100.64.0.0/10, and its fd7a:115c:a1e0::/48
function is_tailnet_address(address)
{
    const v4 = /^100\.(\d+)\.\d+\.\d+$/.exec(address);
    if (v4 !== null) {
        const second = Number(v4[1]);
        return (second >= 64) && (second <= 127);
    }
    return String(address).toLowerCase().startsWith('fd7a:115c:a1e0:');
}

module.exports = is_tailnet_address;
