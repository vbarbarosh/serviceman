// Where a service answers, in words for a log line or the page: host:port, or the socket file an
// app listens on, one of serviceman's own side as its cards say it (socket_place)
function upstream_said(upstream)
{
    if (upstream.socket === undefined) {
        return `${upstream.host}:${upstream.port}`;
    }
    return (upstream.said === undefined) ? upstream.socket : upstream.said;
}

module.exports = upstream_said;
