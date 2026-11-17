const door_peer_known = require('./door_peer_known');
const door_token = require('./door_token');
const remote_can = require('./remote_can');

// How a forward or a mount between two machines goes straight, agent to agent over the
// tailnet: where the far machine's agent listens for its peers and the token it is asked with,
// for the near one to dial. null when it goes through serviceman's links as before: either agent
// is from before peer streams, or the far one never said where it listens.
//
//     near   the machine the forward or the mount shows up on
//     name   the machine its far end is on: the service, or the folder
function stream_peer(app, near, name)
{
    const far = app.remote_by_name[name];
    if ((far === undefined) || (far === near) || (remote_can(near, 'peer_streams') === false) || (remote_can(far, 'peer_streams') === false)) {
        return null;
    }
    // What it said at its hello, or — away since serviceman started — what it said before
    const peer = far.state.doors_peer || door_peer_known(app, far.name);
    if ((peer === null) || (peer === undefined) || (Array.isArray(peer.addresses) === false) || (peer.addresses.length === 0)) {
        return null;
    }
    return {addresses: peer.addresses, port: peer.port, token: door_token(app, far.name)};
}

module.exports = stream_peer;
