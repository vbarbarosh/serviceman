// Whether a hostname is under .localhost: a name serviceman gives its services, which no DNS
// anywhere knows, and which a browser sends to its own computer's loopback and nowhere else
function is_localhost_name(host)
{
    return host.endsWith('.localhost') || (host === 'localhost');
}

module.exports = is_localhost_name;
