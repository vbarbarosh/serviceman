const bundle_sources_read = require('../../helpers/bundle_sources_read');
const package_json = require('../../../package.json');
const render_bundle = require('../../helpers/render_bundle');

const ENTRY = 'mcp/index';
const VERSION = package_json.version;
// The module the checkout reads the version from package.json with, written here as the
// version itself
const VERSION_KEY = 'mcp/src/mcp_version';

// serviceman-mcp as one file, as the agent is one (agent_bundle): every module it reaches,
// wrapped in a require of its own. A coding agent's box has node, serviceman's control socket
// and a token, and nothing of serviceman's repo, so the file takes nothing from beside it, not
// even package.json: its version is written in. It is made from the modules at every ask, so it
// is always the server this serviceman's checkout runs.
function mcp_bundle()
{
    const made = {[VERSION_KEY]: `module.exports = ${JSON.stringify(VERSION)};`};
    return render_bundle(intro_text(), 'serviceman-mcp', bundle_sources_read(ENTRY, made), ENTRY);
}

function intro_text()
{
    return `// serviceman-mcp ${VERSION} — one file, no dependencies.
// Built from the serviceman repo, src/mcp, by src/mcp/bundler/mcp_bundle.js; change it there,
// not here. An MCP server on stdin and stdout, for a coding agent in a box that has
// serviceman's control socket and a token with the apps right (docs/mcp.md):
//
//     claude mcp add serviceman --env SERVICEMAN_TOKEN=<token> -- node serviceman-mcp.js`;
}

module.exports = mcp_bundle;
