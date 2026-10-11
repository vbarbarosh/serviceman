// Whether an address is under .localhost: a name serviceman gives its services, which no DNS
// anywhere knows
function is_localhost_url(url)
{
    const host = new URL(url).hostname;
    return host.endsWith('.localhost') || (host === 'localhost');
}

module.exports = is_localhost_url;
