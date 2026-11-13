const config_from_json = require('./config_from_json');

// The config file, as JSON, read the way serviceman read it at its start (profile_from_db): the
// settings it started with (config/index.js) under it, the file's own keys winning. Read alone,
// a file that names no listen or control got the built-in ports, and every Save of it said they
// had changed and waited for a restart.
function config_from_file(app, json)
{
    const out = config_from_json(Object.assign({}, app.config.settings, json), app.config.base_dir);
    out.settings = app.config.settings;
    return out;
}

module.exports = config_from_file;
