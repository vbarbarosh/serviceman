const fs = require('fs');

// The tokens this endpoint has issued: [{name, token, ips, issued_at}]. No file is no tokens.
function tokens_read(file)
{
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const kept = JSON.parse(text);
    if (Array.isArray(kept.tokens) === false) {
        throw new Error(`${file}: expected {"tokens": [...]}`);
    }
    return kept.tokens;
}

module.exports = tokens_read;
