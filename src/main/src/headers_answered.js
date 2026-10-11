const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

// The service answer as the caller should see it
function headers_answered(headers)
{
    const out = {};
    for (const name of Object.keys(headers)) {
        if (HOP_BY_HOP.includes(name)) {
            continue;
        }
        out[name] = headers[name];
    }
    return out;
}

module.exports = headers_answered;
