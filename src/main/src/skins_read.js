const fs = require('fs');
const path = require('path');

// The skins on disk: every folder under skins/ with a skin.json inside. A folder without one,
// or with one that cannot be read, is not a skin and is left out; no skins folder means no
// skins, not an error.
async function skins_read(skins_root)
{
    let names;
    try {
        names = await fs.promises.readdir(skins_root);
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of names.sort()) {
        try {
            const json = JSON.parse(await fs.promises.readFile(path.join(skins_root, name, 'skin.json'), 'utf8'));
            out.push({name, title: String(json.title || name), layout: String(json.layout || 'rail'), cover: await cover_there(skins_root, name)});
        }
        catch {
        }
    }
    return out;
}

// Whether the skin ships its covers for the picker — one per theme, cover-light.svg and
// cover-dark.svg. A skin without the pair simply shows no picture.
async function cover_there(skins_root, name)
{
    try {
        await fs.promises.access(path.join(skins_root, name, 'cover-light.svg'));
        await fs.promises.access(path.join(skins_root, name, 'cover-dark.svg'));
        return true;
    }
    catch {
        return false;
    }
}

module.exports = skins_read;
