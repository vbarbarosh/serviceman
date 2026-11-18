const agent_built_at = require('./agent_built_at');
const agent_version = require('../version.json');
const bundle_file_from_key = require('../../helpers/bundle_file_from_key');
const bundle_sources_read = require('../../helpers/bundle_sources_read');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const render_bundle = require('../../helpers/render_bundle');

const ENTRY = 'agent/index';
// Modules that are a file of another part as text, for the agent to write out on its machine:
// the key, and the file from src/ it holds
const TEXTS = {'agent/src/agent_servermon_text': 'servermon/servermon.js'};
const VERSION = agent_version.version;
// The file the version itself is kept in, which the fingerprint of the sources leaves out
const VERSION_KEY = 'agent/version.json';

// The agent as one file: every module it reaches, wrapped in a require of its own. A machine
// that carries services needs node and nothing else — no repo, no npm install, no build step
// over there. The file is written from the modules every time, so it can never drift.
function agent_bundle()
{
    const sources = sources_read();
    // The day the file was made, which for a file made from the modules is the day the newest
    // of them changed. The agent says it at startup, so a machine nobody logs in to can still
    // be asked what it is running.
    sources['agent/src/agent_built'] = `module.exports = process.env.SERVICEMAN_AGENT_BUILT || ${JSON.stringify(built_at(sources))};`;
    return render_bundle(intro_text(), 'the agent', sources, ENTRY);
}

function built_at(sources)
{
    return agent_built_at([...Object.keys(sources).map(bundle_file_from_key), ...Object.values(TEXTS).map(v => path.resolve(__dirname, '..', '..', v))]);
}

// Every module the agent reaches, the texts of TEXTS written in as the modules that hold them
function sources_read()
{
    const made = {};
    for (const key of Object.keys(TEXTS)) {
        made[key] = `module.exports = ${JSON.stringify(fs.readFileSync(path.resolve(__dirname, '..', '..', TEXTS[key]), 'utf8'))};`;
    }
    return bundle_sources_read(ENTRY, made);
}

function intro_text()
{
    return `// serviceman-agent ${VERSION} — one file, no dependencies.
// Built from the serviceman repo by src/agent/bin/build; change it there, not here.
// Run it on a machine that should carry services:
//
//     node serviceman-agent.js --url https://serviceman.example.com --token <secret>`;
}

// What the agent this host serves is stamped with, without building it: the same modules, the
// same answer, for comparing against what a machine says it is running
agent_bundle.built_at = function () {
    return built_at(sources_read());
};

// A fingerprint of every module the agent is built from, its version file aside: it changes
// with any change to the agent, and src/agent/version.json keeps the one its version was given
// for, so a release finds an agent changed since (bin/release)
agent_bundle.sources_hash = function () {
    const sources = sources_read();
    const hash = crypto.createHash('sha256');
    for (const key of Object.keys(sources).sort()) {
        if (key !== VERSION_KEY) {
            hash.update(`${key}\n${sources[key]}\n`);
        }
    }
    return hash.digest('hex').slice(0, 16);
};

module.exports = agent_bundle;
