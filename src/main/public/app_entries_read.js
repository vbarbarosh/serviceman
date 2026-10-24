// The files of an app, from a zip or a folder picked in the page, judged the same way: what is
// under its one top folder when it has one, and whether that is an app folder at all. What is
// wrong is said as problem, a sentence for the page.
//
//     entries    [{name, dir, link, mode, mtime_s, size, bytes()}], names with / between folders
//     label      what was picked, as the page names it: notes.zip, notes/
//
//     {label, top, files, size, configure, build, entries, problem}
//     top        the folder everything is in, 'appdir/', or '' when bin/run is at the top
//     files      how many files, folders not counted
//     size       their bytes together
//     configure  whether it has bin/configure
//     build      whether it has bin/build
function app_entries_read(label, entries, problem)
{
    const out = {label, top: '', files: 0, size: 0, configure: false, build: false, entries, problem};
    // bin/run at the top is an app as it is; one folder holding everything is the app's folder
    const tops = Array.from(new Set(entries.map(v => v.name.slice(0, v.name.indexOf('/') + 1))));
    const at_top = entries.some(v => v.name === 'bin/run');
    out.top = ((at_top === false) && (tops.length === 1) && (tops[0] !== '')) ? tops[0] : '';
    const files = entries.filter(v => v.dir === false);
    const names = files.map(v => v.name.slice(out.top.length));
    out.files = names.length;
    out.size = files.reduce((total, v) => total + v.size, 0);
    out.configure = names.includes('bin/configure');
    out.build = names.includes('bin/build');
    if ((out.problem === null) && entries.some(v => v.link)) {
        out.problem = `${label} holds links, which are not sent: put the files they point at in their place.`;
    }
    else if ((out.problem === null) && (out.files === 0)) {
        out.problem = `${label} is empty.`;
    }
    else if ((out.problem === null) && (names.includes('bin/run') === false)) {
        out.problem = `${label} has no bin/run, at its top or in its one folder: an app folder starts with it.`;
    }
    return out;
}

export default app_entries_read;
