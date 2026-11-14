const app_zip_items = require('./app_zip_items');

// A zip of a folder of files sent to serviceman: what is under its one top folder when it has
// one, and every file of it, data/ too, since nothing runs in it to keep a data/ of its own. A
// page starts with its index.html. What is wrong is thrown as a sentence with the zip's label in
// it. Every file is unpacked once here, to its last byte and kept nowhere, so a zip that breaks
// halfway is refused before anything of it is written.
//
//     label   what was sent, as the sender names it: notes.zip
//     source  the path of the zip, or its bytes as a Buffer
//
//     {items, files, bytes}
//     items  [{path, dir, mtime_s}, {path, mode, mtime_s, size, stream()}], paths under the folder
//     files  how many files, folders not counted
//     bytes  their bytes together
async function files_zip_items(label, source)
{
    const entries = app_zip_items.entries_read(label, source);
    // index.html at the top is the page as it is; one folder holding everything is its folder
    const tops = Array.from(new Set(entries.map(v => v.name.slice(0, v.name.indexOf('/') + 1))));
    const at_top = entries.some(v => v.name === 'index.html');
    const top = ((at_top === false) && (tops.length === 1) && (tops[0] !== '')) ? tops[0] : '';
    const names = entries.filter(v => v.dir === false).map(v => v.name.slice(top.length));
    if (entries.some(v => v.link)) {
        throw new Error(`${label} holds links, which are not sent: put the files they point at in their place.`);
    }
    if (names.length === 0) {
        throw new Error(`${label} is empty.`);
    }
    if (names.includes('index.html') === false) {
        throw new Error(`${label} has no index.html, at its top or in its one folder: a page starts with it.`);
    }
    const out = {items: [], files: names.length, bytes: 0};
    for (const entry of entries) {
        const path = entry.name.slice(top.length);
        if (path === '') {
            continue;
        }
        if (app_zip_items.path_leaves(path)) {
            throw new Error(`${label} names ${entry.name}, which leads outside the folder.`);
        }
        if (entry.dir) {
            out.items.push({path, dir: true, mtime_s: entry.mtime_s});
            continue;
        }
        await app_zip_items.entry_check(label, entry);
        // Read, never run: a page's files are the visitor's to fetch
        out.items.push({path, mode: 0o644, mtime_s: entry.mtime_s, size: entry.size, stream: entry.stream});
        out.bytes += entry.size;
    }
    return out;
}

module.exports = files_zip_items;
