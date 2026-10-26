const fs = require('fs');

// Writes a request body to a file as it comes, held nowhere in memory; a body above the limit
// is refused as body_bytes_read refuses one: the rest of it is left unread, and the refusal
// carries `status` 413 for the caller to answer with before it closes the connection. A body
// the disk has no room for, or one the sender gave up on, is refused too. The file is the
// caller's to remove, whole or not.
//
//     {bytes}   how long the body was
function body_file_write(req, file, limit_bytes)
{
    return new Promise(function (resolve, reject) {
        const writer = fs.createWriteStream(file, {flags: 'wx', mode: 0o600});
        let size = 0;
        let settled = false;
        function fail(error) {
            if (settled) {
                return;
            }
            settled = true;
            req.unpipe(writer);
            req.pause();
            writer.destroy();
            reject(error);
        }
        req.on('data', function (chunk) {
            size += chunk.length;
            if (size > limit_bytes) {
                const error = new Error(`the body is above ${limit_bytes} bytes`);
                error.status = 413;
                fail(error);
            }
        });
        req.on('close', function () {
            if (req.complete === false) {
                fail(new Error('the sender gave up before the body was in'));
            }
        });
        req.on('error', fail);
        writer.on('error', function (error) {
            error.status = (error.code === 'ENOSPC') ? 507 : 500;
            fail(error);
        });
        writer.on('finish', function () {
            if (settled) {
                return;
            }
            settled = true;
            resolve({bytes: size});
        });
        req.pipe(writer);
    });
}

module.exports = body_file_write;
