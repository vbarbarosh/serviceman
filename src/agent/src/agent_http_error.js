const http = require('http');

// An error a visitor sees: the standard status and its standard words, and nothing about why —
// which machine, which service, what is switched off is written to this machine's log, not to
// whoever knocked
function agent_http_error(res, status)
{
    res.writeHead(status, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
    res.end(`${status} ${http.STATUS_CODES[status]}\n`);
}

module.exports = agent_http_error;
