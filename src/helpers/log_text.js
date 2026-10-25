// Tab is text; every other control character, a newline above all, could end this line and
// start another in the file
const RE_CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/;

// Free text in a log line stays as it was written, unless it could pass for more than one line:
// a line a command printed that holds a newline and `[time][uid][sender]` after it would be a
// forged event in the file. Such text goes as one JSON string, escapes and all.
function log_text(text)
{
    return RE_CONTROL.test(text) ? JSON.stringify(text) : text;
}

module.exports = log_text;
