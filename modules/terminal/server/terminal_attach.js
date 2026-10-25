const term_size_valid = require('../../../src/helpers/term_size_valid');

// A terminal pane's websocket joined to the stream at the far end — a shell in a container, a
// pty on a machine, whatever the host opened. Bytes from the far end go out as binary
// messages; the pane sends json: {type: 'input', data} and {type: 'resize', cols, rows}.
// The first word the pane gets is the note, {type: 'note', text, ok: true}.
//
// A frame is whoever sits at the pane, so only what a pane sends gets through: text as input,
// a size a terminal can have; anything else is dropped. A handler that fails closes this pane
// and nothing else: the host goes on.
//
//     options = {note, resize, end}
//     resize({cols, rows})   the far end takes the pane's size
//     end()                  the pane went away and the stream is closed
function terminal_attach(client, stream, options)
{
    stream.on('data', function (chunk) {
        client.send(chunk);
    });
    stream.on('close', function () {
        client.close();
    });
    stream.on('error', function () {
        client.close();
    });
    client.on('message', function (raw) {
        try {
            message_take(stream, options, message_from_raw(raw));
        }
        catch {
            client.close();
        }
    });
    client.on('close', function () {
        stream.destroy();
        options.end();
    });
    client.send(JSON.stringify({type: 'note', text: options.note, ok: true}));
}

function message_take(stream, options, message)
{
    if ((message === null) || (typeof message !== 'object')) {
        return;
    }
    if ((message.type === 'input') && (typeof message.data === 'string')) {
        stream.write(message.data);
        return;
    }
    if ((message.type === 'resize') && term_size_valid(message.cols, message.rows)) {
        options.resize({cols: message.cols, rows: message.rows});
    }
}

function message_from_raw(raw)
{
    try {
        return JSON.parse(String(raw));
    }
    catch {
        return null;
    }
}

module.exports = terminal_attach;
