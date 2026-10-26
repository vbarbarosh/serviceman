const crypto = require('crypto');

// What one machine is told: where the names are, the passphrase, and its own mounts. A machine
// with none is told nothing secret. The version is the table's own mark, so a machine told the
// same table twice is told once.
//
//     {version, meta: {address, port, password}, passphrase, mounts: [{folder, path, mode}]}
function shared_table(shared, remote_name)
{
    const mounts = shared.mounts.filter(v => v.remote === remote_name).map(v => ({folder: v.folder, path: v.path, mode: v.mode}));
    const home = shared.home;
    const ready = (home !== null) && (home.phase === 'ready');
    const meta = (ready && (mounts.length > 0)) ? {address: home.address, port: home.redis_port, password: home.secrets.redis_password} : null;
    const passphrase = (meta === null) ? null : home.secrets.passphrase;
    const told = (meta === null) ? [] : mounts;
    const version = crypto.createHash('sha256').update(JSON.stringify({meta, passphrase, mounts: told})).digest('hex').slice(0, 16);
    return {version, meta, passphrase, mounts: told};
}

module.exports = shared_table;
