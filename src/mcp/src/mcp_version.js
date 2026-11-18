const package_json = require('../../../package.json');

// The version this server says it is, serviceman's own: read from the repo's package.json when
// it runs from the checkout. The bundled file has no package.json beside it, so the bundler
// writes the version itself in this module's place (src/mcp/bundler/mcp_bundle.js).
const mcp_version = package_json.version;

module.exports = mcp_version;
