const databases_path = require('./databases_path');
const fs = require('fs');

// The database servers as kept: {servers}
//
//   servers  [{name, engine, version, remote, sample, root, users, phase, said, error, port, made, root_held}]
//            root     the password of its root user, made by serviceman
//            users    {<database>: {user, password}}, the user made for each database
//            phase    starting, up, failed or removing; said what a start does now
//            port     its port on 127.0.0.1 of its machine, once it is up
//            root_held  a MongoDB's root signs in from inside its container alone
//                     (database_root_hold); missing on one made before that
function databases_read(app)
{
    let text;
    try {
        text = fs.readFileSync(databases_path(app), 'utf8');
    }
    catch {
        return {servers: []};
    }
    const kept = JSON.parse(text);
    return {servers: Array.isArray(kept.servers) ? kept.servers : []};
}

module.exports = databases_read;
