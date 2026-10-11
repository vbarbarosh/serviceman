// A terminal pane's websocket joined to the stream at the far end — a shell in a container, a
// pty on a machine, whatever the host opened. Bytes from the far end go out as binary
// messages; the pane sends json: {type: 'input', data} and {type: 'resize', cols, rows}.
// The first word the pane gets is the note, {type: 'note', text, ok: true}.
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
        const message = message_from_raw(raw);
        if (message === null) {
            return;
        }
        if (message.type === 'input') {
            stream.write(message.data);
            return;
        }
        if (message.type === 'resize') {
            options.resize({cols: message.cols, rows: message.rows});
        }
    });
    client.on('close', function () {
        stream.destroy();
        options.end();
    });
    client.send(JSON.stringify({type: 'note', text: options.note, ok: true}));
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
