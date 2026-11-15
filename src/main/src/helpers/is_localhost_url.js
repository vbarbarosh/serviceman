const is_localhost_name = require('./is_localhost_name');

// Whether an address is under .localhost: a name serviceman gives its services, which no DNS
// anywhere knows
function is_localhost_url(url)
{
    return is_localhost_name(new URL(url).hostname);
}

module.exports = is_localhost_url;
