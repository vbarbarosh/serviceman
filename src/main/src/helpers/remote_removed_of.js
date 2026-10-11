const crypto = require('crypto');

// Which machine this token used to be, when it was taken out of the config. The comparison is
// on hashes and takes the same time whichever it is, like every other comparison on this door.
function remote_removed_of(app, header)
{
    const given = crypto.createHash('sha256').update(String(header || '').replace(/^Bearer /i, '')).digest();
    let out = null;
    for (const item of app.removed) {
        if (crypto.timingSafeEqual(given, Buffer.from(item.mark, 'hex'))) {
            out = item;
        }
    }
    return out;
}

module.exports = remote_removed_of;
