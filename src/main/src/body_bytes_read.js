// Collects a request body as its bytes; a body above the limit is refused, not buffered
function body_bytes_read(req, limit_bytes)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (chunk) {
            size += chunk.length;
            if (size > limit_bytes) {
                reject(new Error(`the body is above ${limit_bytes} bytes`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            resolve(Buffer.concat(chunks));
        });
        req.on('error', reject);
    });
}

module.exports = body_bytes_read;
