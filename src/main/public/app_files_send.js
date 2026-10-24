import tar_blob from './tar_blob.js';

// The files of an app, from a zip or a folder (app_entries_read), sent to a folder of a machine:
// the folder is made, and the files go as one tar through the File Manager's upload, which checks
// every name and keeps every mode. A file that came with no mode, as every file of a folder
// picked in a browser does, runs when it is in bin/ or starts with #!. What comes back is the
// folder as the machine names it, ~ written out.
//
// The folder must be new or empty: files of another app left there would mix with these.
//
//     say(text)  what is being done, for the page to show
async function app_files_send(app, machine, folder, say)
{
    const base = `/api/v1/remotes/${encodeURIComponent(machine)}/fs`;
    const there = await list_read(`${base}?path=${encodeURIComponent(folder)}`);
    if ((there.error === undefined) && (there.items.length > 0)) {
        throw new Error(`${there.path} on ${machine} holds files already, left by another app: give this one another name`);
    }
    say(`reading ${app.label}…`);
    const items = [];
    for (const entry of app.entries) {
        const path = entry.name.slice(app.top.length);
        if (path === '') {
            continue;
        }
        if (entry.dir) {
            items.push({path, dir: true, mtime_s: entry.mtime_s});
            continue;
        }
        const bytes = await entry.bytes();
        const mode = (entry.mode !== 0) ? entry.mode : await mode_guess(path, bytes);
        items.push({path, mode, mtime_s: entry.mtime_s, bytes});
    }
    await answer_read(fetch(`${base}/mkdir`, {method: 'POST', body: JSON.stringify({path: folder})}));
    const made = await answer_read(fetch(`${base}?path=${encodeURIComponent(folder)}`));
    say(`sending ${app.label} to ${machine}…`);
    await answer_read(fetch(`${base}/upload/tar?dir=${encodeURIComponent(made.path)}`, {method: 'POST', body: tar_blob(items)}));
    return made.path;
}

// A file with no mode of its own runs when it is in bin/ or is a script, #! first
async function mode_guess(path, bytes)
{
    if (path.startsWith('bin/')) {
        return 0o755;
    }
    const head = new Uint8Array(await new Blob([bytes]).slice(0, 2).arrayBuffer());
    return ((head[0] === 0x23) && (head[1] === 0x21)) ? 0o755 : 0o644;
}

// What a request answered, or the error it said
async function answer_read(request)
{
    const answer = await request;
    const said = await answer.json().catch(() => ({}));
    if (answer.ok === false) {
        throw new Error(said.error || `the machine answered ${answer.status}`);
    }
    return said;
}

// A folder of a machine as its agent lists it, or {error} when it cannot: one not made yet
async function list_read(url)
{
    try {
        const answer = await fetch(url);
        const listed = await answer.json();
        return answer.ok ? listed : {error: listed.error || `${answer.status}`};
    }
    catch (error) {
        return {error: error.message};
    }
}

export default app_files_send;
