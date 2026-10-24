import app_entries_read from './app_entries_read.js';
import zip_entries from './zip_entries.js';

// A zip of an app folder, read in the page (app_entries_read says what comes back). Nothing is
// thrown: a zip that cannot be read is a problem, said as a sentence.
async function app_zip_read(file)
{
    try {
        return app_entries_read(file.name, await zip_entries(file), null);
    }
    catch (error) {
        return app_entries_read(file.name, [], `${file.name}: ${error.message}`);
    }
}

export default app_zip_read;
