import app_entries_read from './app_entries_read.js';

// A new version of an app with its own data/ set apart: data/ is the running app's alone, so
// what a version brings there (a working copy's saves, keys, logs) stays on this computer and is
// never sent. What comes back is the version as app_entries_read reads it without that data/,
// and how many files its data/ held; null when it had none.
//
//     {app, data_files}
function app_data_apart(app)
{
    const left = app.entries.filter(v => in_data(app, v));
    if (left.length === 0) {
        return {app, data_files: null};
    }
    const kept = app.entries.filter(v => in_data(app, v) === false);
    return {app: app_entries_read(app.label, kept, app.problem), data_files: left.filter(v => v.dir === false).length};
}

// lab/data/settings.json is in data/; lab/database.txt is not
function in_data(app, entry)
{
    return entry.name.slice(app.top.length).startsWith('data/');
}

export default app_data_apart;
