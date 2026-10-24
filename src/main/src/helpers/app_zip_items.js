const zip_entries = require('./zip_entries');

// A zip of an app folder sent to serviceman, judged as the page judges one picked there
// (src/main/public/app_entries_read.js and app_data_apart.js): what is under its one top
// folder when it has one, whether that is an app folder at all, and its data/ set apart, since
// data/ is the running app's alone and a version's own never reaches it. What comes back goes
// to the machine as one tar; what is wrong is thrown as a sentence with the zip's label in it.
//
//     label   what was sent, as the sender names it: ai-lab.zip
//
//     {items, files, bytes, data_files, configure, build}
//     items       [{path, dir, mtime_s}, {path, mode, mtime_s, bytes}], paths under the app's folder
//     files       how many files go, folders not counted
//     bytes       their bytes together
//     data_files  how many files its data/ held, left out; null when it had none
//     configure   whether it has bin/configure
//     build       whether it has bin/build
function app_zip_items(label, buffer)
{
    const entries = entries_read(label, buffer);
    // bin/run at the top is an app as it is; one folder holding everything is the app's folder
    const tops = Array.from(new Set(entries.map(v => v.name.slice(0, v.name.indexOf('/') + 1))));
    const at_top = entries.some(v => v.name === 'bin/run');
    const top = ((at_top === false) && (tops.length === 1) && (tops[0] !== '')) ? tops[0] : '';
    const kept = entries.filter(v => in_data(top, v) === false);
    const data_files = entries.filter(v => in_data(top, v) && (v.dir === false)).length;
    const names = kept.filter(v => v.dir === false).map(v => v.name.slice(top.length));
    if (entries.some(v => v.link)) {
        throw new Error(`${label} holds links, which are not sent: put the files they point at in their place.`);
    }
    if (names.length === 0) {
        throw new Error(`${label} is empty.`);
    }
    if (names.includes('bin/run') === false) {
        throw new Error(`${label} has no bin/run, at its top or in its one folder: an app folder starts with it.`);
    }
    const out = {items: [], files: names.length, bytes: 0, data_files: (data_files === 0) ? null : data_files, configure: names.includes('bin/configure'), build: names.includes('bin/build')};
    for (const entry of kept) {
        const path = entry.name.slice(top.length);
        if (path === '') {
            continue;
        }
        if (path_leaves(path)) {
            throw new Error(`${label} names ${entry.name}, which leads outside the folder.`);
        }
        if (entry.dir) {
            out.items.push({path, dir: true, mtime_s: entry.mtime_s});
            continue;
        }
        const bytes = bytes_read(label, entry);
        out.items.push({path, mode: (entry.mode !== 0) ? entry.mode : mode_guess(path, bytes), mtime_s: entry.mtime_s, bytes});
        out.bytes += bytes.length;
    }
    return out;
}

// What the zip lists, or what is wrong with it, said with the zip's name first
function entries_read(label, buffer)
{
    try {
        return zip_entries(buffer);
    }
    catch (error) {
        throw new Error(`${label}: ${error.message}`);
    }
}

function bytes_read(label, entry)
{
    try {
        return entry.bytes();
    }
    catch (error) {
        throw new Error(`${label}: ${error.message}`);
    }
}

// lab/data/settings.json is in data/; lab/database.txt is not
function in_data(top, entry)
{
    return entry.name.slice(top.length).startsWith('data/');
}

// A name the machine's agent would refuse anyway, said here before anything is sent
function path_leaves(path)
{
    return path.startsWith('/') || path.split('/').includes('..');
}

// A file with no mode of its own runs when it is in bin/ or is a script, #! first
function mode_guess(path, bytes)
{
    if (path.startsWith('bin/')) {
        return 0o755;
    }
    return ((bytes[0] === 0x23) && (bytes[1] === 0x21)) ? 0o755 : 0o644;
}

module.exports = app_zip_items;
