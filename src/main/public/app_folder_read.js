import app_entries_read from './app_entries_read.js';

// A folder of this computer, picked or dropped on the page, read as the files of an app
// (app_entries_read says what comes back). The browser hands over its files with their paths
// from the folder picked, appdir/bin/run, and no unix modes: what runs is found when it is sent.
//
//     files  [{path, file}], file a File
function app_folder_read(files)
{
    const top = (files.length === 0) ? '' : files[0].path.split('/')[0];
    return app_entries_read((top === '') ? 'The folder' : `${top}/`, files.map(entry_of), null);
}

// A file as a zip's entry is: its bytes are the File itself, read only as it is sent
function entry_of(picked)
{
    const file = picked.file;
    return {name: picked.path, dir: false, link: false, mode: 0, mtime_s: Math.floor(file.lastModified/1000), size: file.size, bytes: () => Promise.resolve(file)};
}

export default app_folder_read;
