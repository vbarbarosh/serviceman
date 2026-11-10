const term_size_valid = require('../../../src/helpers/term_size_valid');

// How much of what the far end printed may wait here for a pane that reads slower than it is
// printed: a stream's window on a link, some three thousand lines
const MARK_BYTES = 256*1024;

// How long a held pane may take nothing. One gone dark without closing, a laptop asleep with
// its tab open, is let go then: held any longer it holds the program at the far end, and on a
// kept terminal everyone else joined to it. A page joins a kept terminal again by itself, and
// its history says what the pane missed.
const STUCK_MS = 20000;

// A terminal pane's websocket joined to the stream at the far end — a shell in a container, a
// pty on a machine, whatever the host opened. Bytes from the far end go out as binary
// messages; the pane sends json: {type: 'input', data} and {type: 'resize', cols, rows}.
// The first word the pane gets is the note, {type: 'note', text, ok: true}.
//
// A frame is whoever sits at the pane, so only what a pane sends gets through: text as input,
// a size a terminal can have; anything else is dropped. A handler that fails closes this pane
// and nothing else: the host goes on.
//
// A far end that prints faster than its pane reads is held back, as a terminal on a slow line
// holds its program: with more than MARK_BYTES waiting for the pane the stream is paused, and
// it goes on once the pane has taken them. So the stream answers pause() and resume() as a
// socket does, and paused it stops its far end: what is printed waits there, never here.
// Nothing is dropped and nothing overtakes; what the pane types goes the other way and is
// never held. A held pane that takes nothing at all for STUCK_MS is let go: its socket is cut,
// and the stream closed as for any pane that went away.
//
//     options = {note, resize, end, stuck_ms}
//     resize({cols, rows})   the far end takes the pane's size
//     end()                  the pane went away and the stream is closed
//     stuck_ms               how long a held pane may take nothing, STUCK_MS when not given
function terminal_attach(client, stream, options)
{
    const stuck_ms = (options.stuck_ms === undefined) ? STUCK_MS : options.stuck_ms;
    let held = false;
    let gone = false;
    let stuck = null;
    stream.on('data', function (chunk) {
        client.send(chunk, sent);
        if ((held === false) && (client.bufferedAmount > MARK_BYTES)) {
            held = true;
            stream.pause();
            stuck_watch();
        }
    });
    // The pane's socket took a piece, so it is not dark: with no more than the mark still
    // waiting the far end goes on, and with more the wait for its next piece begins again
    function sent() {
        if ((held === false) || gone) {
            return;
        }
        if (client.bufferedAmount <= MARK_BYTES) {
            held = false;
            clearTimeout(stuck);
            stream.resume();
            return;
        }
        stuck_watch();
    }
    function stuck_watch() {
        clearTimeout(stuck);
        stuck = setTimeout(function () {
            // A close frame would wait behind what the pane does not take: the socket is cut
            client.terminate();
        }, stuck_ms);
    }
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
        gone = true;
        clearTimeout(stuck);
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

terminal_attach.MARK_BYTES = MARK_BYTES;
terminal_attach.STUCK_MS = STUCK_MS;

module.exports = terminal_attach;
