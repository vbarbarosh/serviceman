const body_bytes_read = require('./body_bytes_read');

// Collects a small request body as text; a body above the limit is refused, not buffered
async function body_read(req, limit_bytes)
{
    return (await body_bytes_read(req, limit_bytes)).toString('utf8');
}

module.exports = body_read;
