const stream = require('stream');

// Output written for a screen, made into lines. A progress meter draws itself with carriage
// returns and cursor moves — `\r` is the end of a line as much as `\n` is, and the escapes
// belong to a terminal that is not there.
const RE_ESCAPE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Z0-9]|\x1b[=>]/g;

function stream_terminal_text()
{
    return new stream.Transform({
        transform: function (buffer, encoding, callback) {
            this.push(String(buffer).replace(RE_ESCAPE, '').replace(/\r/g, '\n'));
            callback();
        },
    });
}

module.exports = stream_terminal_text;
