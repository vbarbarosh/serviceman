// Collects a small request body; a body above the limit is refused, not buffered
function body_read(req, limit_bytes)
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
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

module.exports = body_read;
