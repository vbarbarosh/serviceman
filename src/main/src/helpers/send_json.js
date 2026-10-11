// Every answer of the control API
function send_json(res, status, value)
{
    const text = JSON.stringify(value, null, 4);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
    });
    res.end(text);
}

module.exports = send_json;
