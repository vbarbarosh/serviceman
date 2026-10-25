const app_apply_config = require('./app_apply_config');
const config_file_save = require('./config_file_save');
const config_from_json = require('./config_from_json');
const config_locked = require('./config_locked');
const fs = require('fs');

// Writes one more remote into the config file and applies it, the same way the control page
// does — the file stays the one place a machine is written down, so a machine that added itself
// is as visible, as editable and as removable as one typed by hand.
function config_remote_add(app, remote)
{
    return config_locked(app, () => remote_write(app, remote));
}

async function remote_write(app, remote)
{
    if (app.config.path === undefined) {
        throw new Error('serviceman runs without a config file, so a machine cannot add itself');
    }
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    if (json.remotes === undefined) {
        // The machines come before what runs on them, so the file stays readable
        const services = json.services;
        delete json.services;
        json.remotes = [];
        json.services = services;
    }
    json.remotes.push(remote);
    const config = config_from_json(json, app.config.base_dir);
    await config_file_save(app.config.path, `${JSON.stringify(json, null, 4)}\n`);
    await app_apply_config(app, config);
}

module.exports = config_remote_add;
