const fs = require('fs');
const path = require('path');

// Where each machine's agent listens for its peers, as it last said: {<remote>: {addresses,
// port}}. Kept beside the secrets, so a serviceman that starts again still writes a machine that
// has not dialled in yet into its peers' tables, instead of taking it out of them.
//
// `peer` given is what the machine says now, written down when it differs; left out, the one
// last written is answered, or null.
function door_peer_known(app, name, peer)
{
    const kept = peers_of(app);
    if (peer === undefined) {
        return ((kept[name] === undefined) ? null : kept[name]);
    }
    if (JSON.stringify(kept[name]) !== JSON.stringify(peer)) {
        kept[name] = peer;
        const file = path.resolve(app.state_dir, 'door_peers.json');
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(`${file}.new`, `${JSON.stringify(kept, null, 4)}\n`);
        fs.renameSync(`${file}.new`, file);
    }
    return peer;
}

function peers_of(app)
{
    if (app.door_peers === undefined) {
        try {
            app.door_peers = JSON.parse(fs.readFileSync(path.resolve(app.state_dir, 'door_peers.json'), 'utf8'));
        }
        catch {
            app.door_peers = {};
        }
    }
    return app.door_peers;
}

module.exports = door_peer_known;
