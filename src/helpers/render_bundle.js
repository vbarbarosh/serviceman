// A program as one file that needs node and nothing else: the head, which says what it is and
// holds a require of its own, every module of it wrapped in a function that is given that
// require, and its entry loaded last. A module asks for another by its key, as
// bundle_sources_read wrote it, and for node's own by its name.
//
//     intro    the comment lines under the #! line: what the file is, where it is built from,
//              how it is run
//     whose    whose modules the require finds, said in its comment: the agent
//     sources  {key: text}, from bundle_sources_read
//     entry    the key of the module that runs: agent/index
//
//     the file's text
function render_bundle(intro, whose, sources, entry)
{
    const parts = [render_head(intro, whose)];
    for (const key of Object.keys(sources)) {
        parts.push(`modules[${JSON.stringify(key)}] = function (module, exports, require) {\n${sources[key]}\n};`);
    }
    parts.push(`load(${JSON.stringify(entry)});\n`);
    return parts.join('\n');
}

function render_head(intro, whose)
{
    return `#!/usr/bin/env node

${intro}

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

// A module of ${whose}, or node's own
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

module.exports = render_bundle;
