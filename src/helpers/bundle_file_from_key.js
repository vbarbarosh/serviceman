const path = require('path');

// The helpers of the house a bundle carries from node_modules, by their full name
const HOUSE = '@vbarbarosh/node-helpers/';
const SRC_DIR = path.resolve(__dirname, '..');

// The file a module of a bundle is read from (bundle_sources_read): its key is its path from
// src/ with no .js, or the full name of a helper of the house, which is in node_modules. A .json
// keeps its extension in the key.
//
//     agent/src/agent_say                        /app/src/agent/src/agent_say.js
//     agent/version.json                         /app/src/agent/version.json
//     @vbarbarosh/node-helpers/src/format_bytes  /app/node_modules/@vbarbarosh/node-helpers/src/format_bytes.js
function bundle_file_from_key(key)
{
    const file = key.startsWith(HOUSE) ? path.resolve(SRC_DIR, '..', 'node_modules', key) : path.resolve(SRC_DIR, key);
    return key.endsWith('.json') ? file : `${file}.js`;
}

bundle_file_from_key.HOUSE = HOUSE;

module.exports = bundle_file_from_key;
