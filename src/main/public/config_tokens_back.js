// A "token" of the config's text, its key and its value as written: a machine's, the join's
const RE_TOKEN_FIELD = /("token"\s*:\s*)("(?:[^"\\]|\\.)*")/g;

// The editor's text as it goes to serviceman: every token the editor drew as dots
// (config_tokens_hidden) put back as it was, where its dots stand now. Only a "token" field is
// read, so the same words anywhere else stay as they are; a token written over the dots is kept
// as written.
function config_tokens_back(text, kept)
{
    return String(text).replace(RE_TOKEN_FIELD, function (field, key, value) {
        const found = kept.find(v => v.shown === value);
        return (found === undefined) ? field : `${key}${found.real}`;
    });
}

export default config_tokens_back;
