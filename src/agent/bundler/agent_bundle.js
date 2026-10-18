const agent_built_at = require('./agent_built_at');
const agent_version = require('../version.json');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENTRY = 'agent/index';
const HOUSE = '@vbarbarosh/node-helpers/';
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
    const sources = {};
    module_read(ENTRY, sources);
    // The day the file was made, which for a file made from the modules is the day the newest
    // of them changed. The agent says it at startup, so a machine nobody logs in to can still
    // be asked what it is running.
    sources['agent/src/agent_built'] = `module.exports = process.env.SERVICEMAN_AGENT_BUILT || ${JSON.stringify(built_at(sources))};`;
    const parts = [head_text()];
    for (const key of Object.keys(sources)) {
        parts.push(`modules[${JSON.stringify(key)}] = function (module, exports, require) {\n${sources[key]}\n};`);
    }
    parts.push(`load(${JSON.stringify(ENTRY)});\n`);
    return parts.join('\n');
}

function built_at(sources)
{
    return agent_built_at([...Object.keys(sources).map(file_from_key), ...Object.values(TEXTS).map(v => path.resolve(__dirname, '..', '..', v))]);
}

function module_read(key, sources)
{
    if (sources[key] !== undefined) {
        return;
    }
    if (TEXTS[key] !== undefined) {
        sources[key] = `module.exports = ${JSON.stringify(fs.readFileSync(path.resolve(__dirname, '..', '..', TEXTS[key]), 'utf8'))};`;
        return;
    }
    const text = fs.readFileSync(file_from_key(key), 'utf8');
    if (key.endsWith('.json')) {
        sources[key] = `module.exports = ${text.trim()};`;
        return;
    }
    sources[key] = requires_rewritten(text.replace(/^#!.*\n/, ''), key);
    for (const asked of requires_from_text(text, key)) {
        module_read(asked, sources);
    }
}

function requires_from_text(text, from_key)
{
    const out = [];
    const found = text.matchAll(/require\('([^']+)'\)/g);
    for (const item of found) {
        const key = key_from_request(item[1], from_key);
        if (key !== null) {
            out.push(key);
        }
    }
    return out;
}

// './agent_say' from 'agent/index' -> 'agent/agent_say'; '../helpers/format_seconds'
// -> 'helpers/format_seconds'. Every key is the module's path from src/, so the same file is
// always one key however it is asked for; a helper of the house keeps its full name.
function key_from_request(text, from_key)
{
    if (text.startsWith(HOUSE)) {
        return text;
    }
    if (text.startsWith('.') === false) {
        // node's own, or something the agent does not carry
        return null;
    }
    return path.posix.join(path.posix.dirname(from_key), text);
}

function file_from_key(key)
{
    const file = (key.startsWith(HOUSE) ? path.resolve(__dirname, '..', '..', '..', 'node_modules', key) : path.resolve(__dirname, '..', '..', key));
    return (key.endsWith('.json') ? file : `${file}.js`);
}

// Every relative require in a bundled module is written as the key it resolves to, so the
// require string and the module table always agree, whatever folder the module lives in.
function requires_rewritten(text, key)
{
    const dir = path.posix.dirname(key);
    return text.replace(/require\('(\.[^']+)'\)/g, (whole, name) => `require('${path.posix.join(dir, name)}')`);
}

function head_text()
{
    return `#!/usr/bin/env node

// serviceman-agent ${VERSION} — one file, no dependencies.
// Built from the serviceman repo by src/agent/bin/build; change it there, not here.
// Run it on a machine that should carry services:
//
//     node serviceman-agent.js --url https://serviceman.example.com --token <secret>

const modules = {};
const loaded = {};

function load(key)
{
    if (loaded[key] === undefined) {
        loaded[key] = {exports: {}};
        modules[key](loaded[key], loaded[key].exports, from);
    }
    return loaded[key].exports;
}

// A module of the agent, or node's own
function from(name)
{
    const key = name.replace(/^\\.\\//, '');
    if (modules[key] === undefined) {
        return require(name);
    }
    return load(key);
}
`;
}

// What the agent this host serves is stamped with, without building it: the same modules, the
// same answer, for comparing against what a machine says it is running
agent_bundle.built_at = function () {
    const sources = {};
    module_read(ENTRY, sources);
    return built_at(sources);
};

// A fingerprint of every module the agent is built from, its version file aside: it changes
// with any change to the agent, and src/agent/version.json keeps the one its version was given
// for, so a change that was not given a new version is found (tests/agent_version.test.js)
agent_bundle.sources_hash = function () {
    const sources = {};
    module_read(ENTRY, sources);
    const hash = crypto.createHash('sha256');
    for (const key of Object.keys(sources).sort()) {
        if (key !== VERSION_KEY) {
            hash.update(`${key}\n${sources[key]}\n`);
        }
    }
    return hash.digest('hex').slice(0, 16);
};

module.exports = agent_bundle;
