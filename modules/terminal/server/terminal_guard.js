// A pane's own errors are heard here: a frame the websocket's rules forbid, a payload past the
// limit. Heard, such a frame costs that pane. Unheard, the first one ends the whole host, with
// every service and every other pane: so every pane is guarded the moment it is made.
function terminal_guard(client)
{
    client.on('error', function () {
        client.terminate();
    });
}

module.exports = terminal_guard;
