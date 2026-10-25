// Collects a request body as its bytes; a body above the limit is refused, not buffered: the
// rest of it is left unread, and the refusal carries `status` 413 for the caller to answer
// with before it closes the connection
function body_bytes_read(req, limit_bytes)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        let over = false;
        req.on('data', function (chunk) {
            if (over) {
                return;
            }
            size += chunk.length;
            if (size > limit_bytes) {
                over = true;
                const error = new Error(`the body is above ${limit_bytes} bytes`);
                error.status = 413;
                req.pause();
                reject(error);
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
