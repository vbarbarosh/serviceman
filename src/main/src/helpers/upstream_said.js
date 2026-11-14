// Where a service answers, in words for a log line or the page: host:port, or the socket file an
// app listens on
function upstream_said(upstream)
{
    return (upstream.socket === undefined) ? `${upstream.host}:${upstream.port}` : upstream.socket;
}

module.exports = upstream_said;
