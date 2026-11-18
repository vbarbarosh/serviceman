const path = require('path');
const socket_place = require('./socket_place');

// Why a token may not put an app on this socket, or null when it may; the owner always may. A
// socket is a door into whatever listens on it, docker's own among them, and the app's names pass
// every visitor through it: so a token puts an app on a machine it sees alone, and at the socket
// named after the app, ~/<name>.sock there or sockets/<name>.sock in serviceman's state folder,
// which the app's own program makes; any other file is the owner's to name.
//
//     token   the control token of the call, undefined for the owner
//     socket  the path as given: from / or ~/ on a machine, as typed on serviceman's side
//     remote  the machine, null for serviceman's own side
//
//     the words of the refusal, after the token's label, or null
function app_socket_token_refusal(app, token, name, socket, remote)
{
    if (token === undefined) {
        return null;
    }
    if (remote !== null) {
        if ((token.remotes.includes('*') === false) && (token.remotes.includes(remote) === false)) {
            return `may not put an app on ${remote}: it sees ${(token.remotes.length === 0) ? 'no machine' : token.remotes.join(', ')}`;
        }
        if (socket !== `~/${name}.sock`) {
            return `may put ${name} on a socket at ~/${name}.sock alone, not ${socket}: another file is the owner's to name`;
        }
        return null;
    }
    const own = path.resolve(app.state_dir, 'sockets', `${name}.sock`);
    if (socket_place(app, socket).file !== own) {
        return `may put ${name} on a socket at ${socket_place(app, `sockets/${name}.sock`).said} alone, not ${socket}: another file is the owner's to name`;
    }
    return null;
}

module.exports = app_socket_token_refusal;
