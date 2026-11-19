const docker_exec_connect = require('./docker_exec_connect');
const engine_files_put = require('./engine_files_put');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', 'adminer', 'serviceman_database.php');
// Where the adminer image looks for plugins at every request
const PLUGINS_DIR = '/var/www/html/plugins-enabled';
// Adminer's own image, any tag, wherever it is pulled from
const RE_ADMINER = /^(.*\/)?adminer(:[^/]*)?$/;

// An Adminer given a database opens on it, logged in (src/main/adminer): the plugin put into its
// container as it starts, through the machine's Engine API, where its index.php finds it at the
// next request. Answers whether it was one: an image of anything else is left as it is.
async function adminer_login_put(app, remote, image, container)
{
    if (RE_ADMINER.test(image) === false) {
        return false;
    }
    await engine_files_put(docker_exec_connect(app, remote), container, PLUGINS_DIR, [{name: '000-serviceman-database.php', bytes: fs.readFileSync(PLUGIN), mode: 0o644}]);
    return true;
}

module.exports = adminer_login_put;
