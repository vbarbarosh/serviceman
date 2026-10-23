import zip_entries from './zip_entries.js';

// A zip of an app folder, read in the page: what is in it, under its one top folder when it
// has one as a zip of a folder does, and whether that is an app folder at all. What is wrong is
// said as problem, a sentence for the page, and nothing is thrown.
//
//     {file, top, files, configure, entries, problem}
//     top        the folder everything is in, 'appdir/', or '' when bin/run is at the top
//     files      how many files, folders not counted
//     configure  whether it has bin/configure
async function app_zip_read(file)
{
    const out = {file, top: '', files: 0, configure: false, entries: [], problem: null};
    try {
        out.entries = await zip_entries(file);
    }
    catch (error) {
        out.problem = `${file.name}: ${error.message}`;
    }
    // bin/run at the top is an app as it is; one folder holding everything is a zip of the app's folder
    const tops = Array.from(new Set(out.entries.map(v => v.name.slice(0, v.name.indexOf('/') + 1))));
    const at_top = out.entries.some(v => v.name === 'bin/run');
    out.top = ((at_top === false) && (tops.length === 1) && (tops[0] !== '')) ? tops[0] : '';
    const names = out.entries.filter(v => v.dir === false).map(v => v.name.slice(out.top.length));
    out.files = names.length;
    out.configure = names.includes('bin/configure');
    if ((out.problem === null) && out.entries.some(v => v.link)) {
        out.problem = `${file.name} holds links, which are not sent: zip the files they point at.`;
    }
    else if ((out.problem === null) && (names.includes('bin/run') === false)) {
        out.problem = `${file.name} has no bin/run, at its top or in its one folder: an app folder starts with it.`;
    }
    return out;
}

export default app_zip_read;
