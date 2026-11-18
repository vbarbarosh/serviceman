const bundle_file_from_key = require('./bundle_file_from_key');
const fs = require('fs');
const path = require('path');

// The modules a program made one file is built from (render_bundle): its entry and every module
// it reaches by a relative require, and every helper of the house it asks for, each read once.
// Every key is the module's path from src/, so the same file is always one key however it is
// asked for, and each relative require in a module is written as the key it resolves to, so the
// require string and the module table always agree. A module in `made` is not read: it is the
// text given, written by the bundler (a version, a file as text), and what it asks for is not
// followed. A first line #! is dropped; a .json is its value.
//
//     entry  agent/index
//     made   {'agent/src/agent_servermon_text': 'module.exports = "…";'}
//
//     {key: text} in the order the modules were reached, the entry first
function bundle_sources_read(entry, made)
{
    const out = {};
    module_read(entry, made, out);
    return out;
}

function module_read(key, made, sources)
{
    if (sources[key] !== undefined) {
        return;
    }
    if (made[key] !== undefined) {
        sources[key] = made[key];
        return;
    }
    const text = fs.readFileSync(bundle_file_from_key(key), 'utf8');
    if (key.endsWith('.json')) {
        sources[key] = `module.exports = ${text.trim()};`;
        return;
    }
    sources[key] = requires_rewritten(text.replace(/^#!.*\n/, ''), key);
    for (const asked of requires_from_text(text, key)) {
        module_read(asked, made, sources);
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
// -> 'helpers/format_seconds'. A helper of the house keeps its full name.
function key_from_request(text, from_key)
{
    if (text.startsWith(bundle_file_from_key.HOUSE)) {
        return text;
    }
    if (text.startsWith('.') === false) {
        // node's own, or something the bundle does not carry
        return null;
    }
    return path.posix.join(path.posix.dirname(from_key), text);
}

function requires_rewritten(text, key)
{
    const dir = path.posix.dirname(key);
    return text.replace(/require\('(\.[^']+)'\)/g, (whole, name) => `require('${path.posix.join(dir, name)}')`);
}

module.exports = bundle_sources_read;
