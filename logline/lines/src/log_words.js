// {remote: 'vps1', reason: 'no such token'} -> "remote=vps1 reason=\"no such token\"". A value
// stands bare when it is a plain word, and is JSON otherwise, the rules' way; a key with nothing
// behind it is left out.
function log_words(words)
{
    const pairs = [];
    for (const key of Object.keys(words)) {
        const value = words[key];
        if ((value === undefined) || (value === null)) {
            continue;
        }
        const text = ((typeof value === 'string') && /^[!#-Z^-~]+$/.test(value)) ? value : JSON.stringify(value);
        pairs.push(`${key}=${text}`);
    }
    return pairs.join(' ');
}

module.exports = log_words;
