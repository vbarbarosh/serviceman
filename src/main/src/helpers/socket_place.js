const os = require('os');
const path = require('path');

// An app's socket on serviceman's own side, two ways: the file serviceman dials, and the words
// every card says it in. A relative path is inside serviceman's state folder, as a forward's
// socket that lands here is, and an absolute one inside it is said the same way:
// sockets/va.sock and /app/data/sockets/va.sock are both data/sockets/va.sock. ~/ is
// serviceman's own home; any other path is said as it is.
//
//     {file, said}
function socket_place(app, socket)
{
    if (socket.startsWith('~/')) {
        return {file: path.join(os.homedir(), socket.slice(2)), said: socket};
    }
    const state = path.resolve(app.state_dir);
    const file = path.resolve(state, socket);
    const inside = path.relative(state, file);
    if ((inside === '') || inside.startsWith('..') || path.isAbsolute(inside)) {
        return {file, said: socket};
    }
    return {file, said: `${path.basename(state)}/${inside}`};
}

// What was typed for serviceman's own side, as the card shows it: data/sockets/va.sock is the
// file sockets/va.sock of the state folder named data, not data/data/sockets/va.sock
socket_place.typed = function (app, socket) {
    const prefix = `${path.basename(path.resolve(app.state_dir))}/`;
    return socket.startsWith(prefix) ? socket.slice(prefix.length) : socket;
};

module.exports = socket_place;
