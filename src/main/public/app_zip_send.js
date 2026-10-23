import tar_blob from './tar_blob.js';

// A zip read by app_zip_read, sent to a folder of a machine as its files: the folder is made,
// and the files go as one tar through the File Manager's upload, which checks every name and
// keeps every mode. A zip made where there are no modes still runs what is in bin. What comes
// back is the folder as the machine names it, ~ written out.
//
//     say(text)  what is being done, for the page to show
async function app_zip_send(zip, machine, folder, say)
{
    const base = `/api/v1/remotes/${encodeURIComponent(machine)}/fs`;
    say(`reading ${zip.file.name}…`);
    const items = [];
    for (const entry of zip.entries) {
        const path = entry.name.slice(zip.top.length);
        if (path === '') {
            continue;
        }
        if (entry.dir) {
            items.push({path, dir: true, mtime_s: entry.mtime_s});
            continue;
        }
        const mode = (entry.mode !== 0) ? entry.mode : (path.startsWith('bin/') ? 0o755 : 0o644);
        items.push({path, mode, mtime_s: entry.mtime_s, bytes: await entry.bytes()});
    }
    await answer_read(fetch(`${base}/mkdir`, {method: 'POST', body: JSON.stringify({path: folder})}));
    const made = await answer_read(fetch(`${base}?path=${encodeURIComponent(folder)}`));
    say(`sending ${zip.file.name} to ${machine}…`);
    await answer_read(fetch(`${base}/upload/tar?dir=${encodeURIComponent(made.path)}`, {method: 'POST', body: tar_blob(items)}));
    return made.path;
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

export default app_zip_send;
