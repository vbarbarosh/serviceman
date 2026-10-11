const config_from_json = require('./config_from_json');
const fs_read_json = require('@vbarbarosh/node-helpers/src/fs_read_json');
const path = require('path');

// Paths inside the db are resolved against the folder the db lives in
async function profile_from_db(db_path, settings)
{
    const json = await fs_read_json(db_path);
    // The settings are the base; the db's own keys win, so a db from before the split runs as it did
    const out = config_from_json(Object.assign({}, settings, json), path.dirname(path.resolve(db_path)));
    out.path = path.resolve(db_path);
    return out;
}

module.exports = profile_from_db;
