// 'docker port' answers 0.0.0.0:49153 or [::]:49153 — both mean the loopback side of this host
function upstream_from_text(text)
{
    const line = String(text || '').split('\n')[0].trim();
    const at = line.lastIndexOf(':');
    if (at < 0) {
        return null;
    }
    const port = parseInt(line.slice(at + 1), 10);
    if ((Number.isInteger(port) === false) || (port <= 0)) {
        return null;
    }
    const host = line.slice(0, at).replace(/^\[|\]$/g, '');
    if ((host === '') || (host === '0.0.0.0') || (host === '::') || (host === '*')) {
        return {host: '127.0.0.1', port};
    }
    return {host, port};
}

module.exports = upstream_from_text;
