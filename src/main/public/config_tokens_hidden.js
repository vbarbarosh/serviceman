import secret_hidden from './secret_hidden.js';

// A "token" of the config's text, its key and its value as written: a machine's, the join's
const RE_TOKEN_FIELD = /("token"\s*:\s*)("(?:[^"\\]|\\.)*")/g;

// The config's text as the editor shows it: every token drawn as dots and a number, and what
// each number stands for. The number tells them apart, so a Save puts each back where it stands
// however the blocks were moved (config_tokens_back); one written over the dots is the new one.
// An empty token has nothing to hide and is left as it is.
function config_tokens_hidden(text)
{
    const kept = [];
    const shown = String(text).replace(RE_TOKEN_FIELD, function (field, key, value) {
        if (value === '""') {
            return field;
        }
        let found = kept.find(v => v.real === value);
        if (found === undefined) {
            found = {shown: JSON.stringify(`${secret_hidden(value, value)} ${kept.length + 1}`), real: value};
            kept.push(found);
        }
        return `${key}${found.shown}`;
    });
    return {text: shown, kept};
}

export default config_tokens_hidden;
