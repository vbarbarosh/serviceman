// No terminal after all: the pane is told why, in the note line it shows, and the socket closes
function terminal_refuse(client, text)
{
    client.send(JSON.stringify({type: 'note', text}));
    client.close();
}

module.exports = terminal_refuse;
