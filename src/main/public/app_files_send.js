import copy_sampler from 'file_manager/copy_sampler.js';
import tar_blob from './tar_blob.js';

// A tar is made of blocks of this many bytes
const TAR_BLOCK = 512;

// The files of an app, from a zip or a folder (app_entries_read), sent to a folder of a machine:
// the folder is made, and the files go as one tar through the File Manager's upload, which checks
// every name and keeps every mode. A file that came with no mode, as every file of a folder
// picked in a browser does, runs when it is in bin/ or starts with #!. What comes back is the
// folder as the machine names it, ~ written out.
//
// The folder must be new or empty: files of another app left there would mix with these.
//
//     say(text)  what is being done, for the page to show
//     copy       the copy as the panel every copy has shows it (copy_progress), filled here as the
//                files go: their count and bytes, how far, the speed across it, the time left
async function app_files_send(app, machine, folder, say, copy)
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
    const blob = tar_blob(items);
    const spans = file_spans(items);
    const files = spans.length;
    Object.assign(copy, {state: 'going', note: '', files, files_done: 0, failed: 0, bytes: blob.size, bytes_done: 0, samples: [], left_ms: null, now: null});
    const time0 = Date.now();
    const sampler_stop = copy_sampler(() => ({done: copy.bytes_done, total: copy.bytes, paused: false}), copy);
    try {
        await tar_post(`${base}/upload/tar?dir=${encodeURIComponent(made.path)}`, blob, function (loaded) {
            const ms = Date.now() - time0;
            copy.bytes_done = loaded;
            copy.files_done = spans.filter(v => v.begin + v.size <= loaded).length;
            const span = (copy.files_done < files) ? spans[copy.files_done] : spans.at(-1);
            copy.now = (span === undefined) ? null : {label: span.path, size: span.size, done: Math.max(0, Math.min(span.size, loaded - span.begin)), going: true, said: '', bad: false};
            copy.left_ms = ((ms > 2000) && (loaded > 0)) ? (blob.size - loaded)*ms/loaded : null;
        });
    }
    catch (error) {
        Object.assign(copy, {state: 'failed', failed: files - copy.files_done, left_ms: null});
        if (copy.now !== null) {
            copy.now.going = false;
        }
        throw error;
    }
    finally {
        sampler_stop();
    }
    Object.assign(copy, {state: 'done', files_done: files, bytes_done: blob.size, left_ms: null});
    if (copy.now !== null) {
        Object.assign(copy.now, {going: false, done: copy.now.size});
    }
    return made.path;
}

// Where each file of the tar begins, so the bytes sent say which file is on its way: a block of
// header, then the file in whole blocks (tar_blob)
function file_spans(items)
{
    const out = [];
    let at = 0;
    for (const item of items) {
        at += TAR_BLOCK;
        if (item.dir) {
            continue;
        }
        const size = (item.bytes instanceof Blob) ? item.bytes.size : item.bytes.length;
        out.push({path: item.path, begin: at, size});
        at += Math.ceil(size/TAR_BLOCK)*TAR_BLOCK;
    }
    return out;
}

// The tar, sent as one body with its progress told as it goes: fetch says nothing until the
// whole body is in, a request of the browser's older kind says each step
function tar_post(url, blob, moved)
{
    return new Promise(function (resolve, reject) {
        const request = new XMLHttpRequest();
        request.open('POST', url);
        request.upload.onprogress = function (event) {
            moved(event.loaded);
        };
        request.onload = function () {
            let said = {};
            try {
                said = JSON.parse(request.responseText);
            }
            catch {
                // An answer that is not JSON says nothing but its status
            }
            if ((request.status < 200) || (request.status >= 300)) {
                reject(new Error(said.error || `the machine answered ${request.status}`));
                return;
            }
            resolve(said);
        };
        request.onerror = function () {
            reject(new Error('the connection to serviceman was lost while the files went'));
        };
        request.send(blob);
    });
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
