import copy_sampler from './copy_sampler.js';
import tar_blob from './tar_blob.js';
import {reactive} from 'vue';

// The uploads to each disk, kept by the page and not by its File Manager. The tab is made again
// every time it is opened, and a copy of a gigabyte outlives many openings: leaving the tab
// must not leave the copy without a face.
const queues = {};

// The one request on its way to each disk, so Cancel has something to stop. Kept apart from
// the queue: a request watched by vue is a proxy, and a proxy cannot be aborted.
const requests = {};

// The pause before a retry, for each disk, so Cancel can end it
const waits = {};

// What a paused queue waits on, for each disk, so Resume and Cancel can end it
const resumes = {};

// The folders each choice of files needs before its files go: base -> {batch -> {path, folders}}.
// They are made when its turn comes, not when it is chosen: a drop added while another goes
// waits in line, its folders too.
const plans = {};

// How many folders are asked for at once: a tree of a hundred folders, one after another, is a
// hundred waits on a far machine
const MKDIR_AT_ONCE = 6;

// A stream that moves no byte for this long has stalled: it is cut and sent again
const STALL_MS = 30*1000;

// Two empty blocks: a tar of nothing, to ask a disk once whether it takes a stream at all
const TAR_EMPTY = new Uint8Array(1024);

// How many folders are read at once to see what a cut stream left
const SETTLE_AT_ONCE = 6;

// A stream is sized to take about a minute at the speed seen: a server cuts a request after
// five, and something in front of it may refuse a body over 100 MB. It starts at 8 MB, never
// takes more than 64 MB or 2000 files, and a file bigger than that goes in parts of its own.
const STREAM_FIRST_BYTES = 8*1024*1024;
const STREAM_MIN_BYTES = 1024*1024;
const STREAM_MAX_BYTES = 64*1024*1024;
const STREAM_MAX_FILES = 2000;
const STREAM_TARGET_MS = 60*1000;

// A part starts at 8 MB and is halved, down to this, when something in front of the server
// refuses bodies that big
const PART_BYTES = 8*1024*1024;
const PART_MIN_BYTES = 256*1024;

// A file this small goes in one request: the three of a file in parts cost a small file more
// than its bytes do, and a link to a far machine pays each of them in full
const WHOLE_MAX_BYTES = 1024*1024;

// The longest pause between two tries, in seconds; the first is one, then two, four…
const RETRY_MAX_S = 30;

// Where the browser keeps the ids of the uploads not finished yet
const IDS_KEY = 'file_manager.uploads';

// How much older than its finish a file may look and still be the one that finish made: the
// two clocks are the page's and the disk's
const FINISH_SLACK_MS = 10*60*1000;

// The copy is this page's own request: closing the page stops it, so the page asks first
addEventListener('beforeunload', function (event) {
    if (Object.values(queues).some(v => v.copying)) {
        event.preventDefault();
    }
});

// base -> {copies, copying, paused, samples, note, bad, landed, landed_dirs, making, whole,
// no_stream, part_bytes, began, take, folders_make, refuse, pause, resume, stop, clear}.
// `making` is {done, total} while the folders of a choice are made. `samples` are the speed
// across the copy, [{x: how far it is, 0 to 1; y: bytes a second}]. `landed` counts the
// landings and `landed_dirs` are the folders of the last one, for a tab showing one of them to
// read it again. `whole` is a disk that keeps no parts, `no_stream` one that takes no tar;
// `part_bytes` is how big a part gets through; `began` is when the copying under way started.
function upload_queue(base)
{
    if (queues[base] === undefined) {
        const queue = reactive({base, copies: [], copying: false, cancelled: false, paused: false, samples: [], note: '', bad: false, landed: 0, landed_dirs: [], making: null, began: 0, paused_ms: 0, whole: false, no_stream: false, stream_known: false, stream_bytes: STREAM_FIRST_BYTES, batches: 0, part_bytes: PART_BYTES});
        queue.take = function (list, plan) {
            take(queue, list, plan);
        };
        queue.folders_make = function (path, folders) {
            return folders_make(queue, path, folders);
        };
        queue.refuse = function (labels, why) {
            refuse(queue, labels, why);
        };
        queue.pause = function () {
            pause(queue);
        };
        queue.resume = function () {
            resume(queue);
        };
        queue.stop = function () {
            stop(queue);
        };
        queue.clear = function () {
            clear(queue);
        };
        queues[base] = queue;
    }
    return queues[base];
}

// Choosing a file is the act, and the copy follows it. Each lands in the folder it was chosen
// for, whichever folder the tab shows by the time its turn comes. list: [{file, dir, label}],
// `label` the name as Uploads shows it, with the folders it came in. plan: {path, folders}, the
// folders under `path` to make first, when the turn of these files comes.
function take(queue, list, plan)
{
    // The files taken at once go as one stream
    const batch = ++queue.batches;
    for (const {file, dir, label} of list) {
        queue.copies.push({name: file.name, label, size: file.size, file, dir, batch, phase: 'waiting', said: '', replaced: false, sent: 0, began: 0, began_at: null, id: '', wait_s: 0, finish_sent_at: null});
    }
    if ((plan !== undefined) && (plan.folders.length > 0)) {
        if (plans[queue.base] === undefined) {
            plans[queue.base] = {};
        }
        plans[queue.base][batch] = plan;
    }
    copy(queue);
}

// The folders asked for a few at a time, Uploads counting them; the tab showing `path` reads it
// again once they are there. What comes back is '' or why one was refused.
async function folders_make(queue, path, folders)
{
    const left = folders.slice();
    let why = '';
    queue.making = {done: 0, total: folders.length};
    async function next() {
        while ((left.length > 0) && (why === '')) {
            const dir = left.shift();
            try {
                const answer = await fetch(`${queue.base}/mkdir`, {method: 'POST', body: JSON.stringify({path: `${path}/${dir}`})});
                if (answer.ok === false) {
                    throw new Error((await answer.json()).error);
                }
                queue.making.done++;
            }
            catch (error) {
                why = `${dir}: ${error.message}`;
            }
        }
    }
    await Promise.all(Array.from({length: Math.min(MKDIR_AT_ONCE, folders.length)}, next));
    queue.making = null;
    queue.landed_dirs = [path];
    queue.landed++;
    return why;
}

// A choice whose turn has come: its folders first. Refused, its files fail with the reason.
async function plan_run(queue, batch)
{
    const plan = (plans[queue.base] === undefined) ? undefined : plans[queue.base][batch];
    if (plan === undefined) {
        return;
    }
    delete plans[queue.base][batch];
    const why = await folders_make(queue, plan.path, plan.folders);
    if (why !== '') {
        for (const item of queue.copies.filter(v => (v.batch === batch) && (v.phase === 'waiting'))) {
            item.phase = 'error';
            item.said = `its folder was not made: ${why}`;
        }
        report(queue, why, true);
    }
}

// What was chosen but cannot be sent, said in the list where the rest goes: it stays until
// Clear, and counts among the failed
function refuse(queue, labels, why)
{
    for (const label of labels) {
        queue.copies.push({name: label.split('/').pop(), label, size: 0, file: null, dir: '', phase: 'error', said: why, replaced: false, sent: 0, began: 0, began_at: null, id: '', wait_s: 0, finish_sent_at: null});
    }
}

// One at a time, in the order they were chosen: a link carrying six files at once carries none
// of them any faster. A file chosen while this runs joins the queue and is picked up by the
// same loop.
async function copy(queue)
{
    if (queue.copying) {
        return;
    }
    queue.copying = true;
    queue.cancelled = false;
    queue.began = Date.now();
    queue.paused_ms = 0;
    queue.samples = [];
    report(queue, '', false);
    const sampler_stop = sampler_start(queue);
    try {
        for (;;) {
            if (queue.paused) {
                await new Promise(function (resolve) {
                    resumes[queue.base] = resolve;
                });
            }
            let item = queue.copies.find(v => v.phase === 'waiting');
            if ((item === undefined) || queue.cancelled) {
                break;
            }
            await plan_run(queue, item.batch);
            item = queue.copies.find(v => v.phase === 'waiting');
            if ((item === undefined) || queue.cancelled) {
                continue;
            }
            const batch = stream_next(queue, item);
            if ((batch.length > 1) && (queue.no_stream === false)) {
                await copy_stream(queue, batch);
            }
            else {
                await copy_one(queue, item);
            }
        }
    }
    finally {
        sampler_stop();
        // Cancel stops the queue, not only the file in it: nothing is left looking as though
        // it is still on its way
        for (const item of queue.copies.filter(v => v.phase === 'waiting')) {
            item.phase = 'cancelled';
        }
        queue.copying = false;
        queue.cancelled = false;
        delete requests[queue.base];
    }
}

// One file, in parts: the disk says how much of it is in, and the next part starts there. A part
// the server refuses as too big is halved; a connection that drops is tried again a little
// later, and the disk is asked again where the file stands, so nothing is sent twice and
// nothing is missed. A disk that keeps no parts, and a small file, take it in one piece.
async function copy_one(queue, item)
{
    item.phase = 'copying';
    item.began = Date.now();
    if (queue.whole || (item.size <= WHOLE_MAX_BYTES)) {
        await copy_whole(queue, item);
        return;
    }
    item.id = upload_id(queue.base, item);
    let received = null;
    let failures = 0;
    while ((queue.cancelled === false) && (queue.paused === false)) {
        try {
            if (received === null) {
                received = await part_received(queue, item);
                if (received === null) {
                    await copy_whole(queue, item);
                    return;
                }
                if (item.began_at === null) {
                    item.began_at = received;
                }
                item.sent = received;
                if (await finished_already(queue, item, received)) {
                    return;
                }
            }
            if (received < item.size) {
                received = await part_send(queue, item, received);
                failures = 0;
                continue;
            }
            item.finish_sent_at = Date.now();
            const landed = await upload_call(queue, 'POST', 'finish', item, {size: item.size});
            upload_id_forget(queue.base, item);
            land(queue, item, landed);
            return;
        }
        catch (error) {
            if ((error.aborted === true) || queue.cancelled) {
                break;
            }
            if (error.lasting === true) {
                item.phase = 'error';
                item.said = error.message;
                report(queue, `${item.label} did not land`, true);
                return;
            }
            // Whatever went wrong, the disk is asked again where the file stands
            failures++;
            received = null;
            item.phase = 'retrying';
            item.said = error.message;
            await wait_out(queue, item, Math.min(RETRY_MAX_S, 2**(failures - 1)));
            item.phase = 'copying';
        }
    }
    // Paused: the file goes back in line, and its parts stay on the disk to carry on from
    if (queue.paused && (queue.cancelled === false)) {
        item.phase = 'waiting';
        return;
    }
    item.phase = 'cancelled';
    report(queue, 'stopped', false);
    // What came of it goes: a part of a file is nobody's file
    upload_call(queue, 'POST', 'cancel', item, {}).catch(function () {});
    upload_id_forget(queue.base, item);
}

// How much of the file the disk holds, or null for a disk that takes files in one piece
async function part_received(queue, item)
{
    try {
        return (await upload_call(queue, 'GET', 'part', item, {})).received;
    }
    catch (error) {
        if (error.status === 501) {
            queue.whole = true;
            return null;
        }
        throw error;
    }
}

// A finish whose answer was lost leaves no part behind and the file in place: nothing is in,
// yet the file is there, as big as it should be, and no older than the finish
async function finished_already(queue, item, received)
{
    if ((received !== 0) || (item.finish_sent_at === null)) {
        return false;
    }
    const answer = await fetch(`${queue.base}?path=${encodeURIComponent(item.dir)}`, {cache: 'no-store'});
    if (answer.ok === false) {
        return false;
    }
    const found = (await answer.json()).items.find(v => v.name === item.name);
    if ((found === undefined) || (found.size !== item.size) || (found.mtime_ms < item.finish_sent_at - FINISH_SLACK_MS)) {
        return false;
    }
    upload_id_forget(queue.base, item);
    land(queue, item, {path: `${item.dir}/${item.name}`, replaced: false});
    return true;
}

// One part from where the disk stands; what comes back is where it stands after it
async function part_send(queue, item, received)
{
    const size = Math.min(queue.part_bytes, item.size - received);
    try {
        const answer = await upload_call(queue, 'POST', 'part', item, {offset: received}, item.file.slice(received, received + size), function (loaded) {
            item.sent = received + loaded;
        });
        item.sent = answer.received;
        return answer.received;
    }
    catch (error) {
        // Something in front of the server takes bodies only so big: smaller parts get through
        if ((error.status === 413) && (queue.part_bytes > PART_MIN_BYTES)) {
            queue.part_bytes = Math.max(PART_MIN_BYTES, Math.floor(queue.part_bytes/2));
            return received;
        }
        error.lasting = error.lasting || (error.status === 413);
        throw error;
    }
}

// The file in one request. One that fails is sent again whole, after the same pauses as a part:
// the disk writes it under a name of its own until the last byte is in, so a half never stands.
async function copy_whole(queue, item)
{
    let failures = 0;
    while ((queue.cancelled === false) && (queue.paused === false)) {
        try {
            const landed = await upload_call(queue, 'POST', '', item, {}, item.file, function (loaded) {
                item.sent = loaded;
            });
            item.sent = item.size;
            land(queue, item, landed);
            return;
        }
        catch (error) {
            if ((error.aborted === true) || queue.cancelled) {
                break;
            }
            if (error.lasting === true) {
                item.phase = 'error';
                item.said = error.message;
                report(queue, `${item.label} did not land`, true);
                return;
            }
            failures++;
            item.sent = 0;
            item.phase = 'retrying';
            item.said = error.message;
            await wait_out(queue, item, Math.min(RETRY_MAX_S, 2**(failures - 1)));
            item.phase = 'copying';
        }
    }
    // Paused: the file goes back in line, to be sent again whole
    if (queue.paused && (queue.cancelled === false)) {
        item.sent = 0;
        item.phase = 'waiting';
        return;
    }
    item.phase = 'cancelled';
    report(queue, 'stopped', false);
}

// A file is in: where it landed, for the list of uploads and for a tab showing its folder
function land(queue, item, landed)
{
    item.phase = 'ok';
    item.said = landed.path;
    item.replaced = landed.replaced;
    queue.landed_dirs = [item.dir];
    queue.landed++;
    report(queue, 'copied', false);
}

// Many files as one stream, as `tar | pv | socat` sends them: one request, nothing waited for
// between files, the bytes counted as they go. A file whose bytes have gone is `sent`, and done
// once the stream ends whole. A stream that is cut or stalls asks the disk what it holds: a
// file there at its size and with its date (a tar carries the date, and the disk keeps it) is
// done; the rest goes again. A disk that takes no tar gets its files one by one.
async function copy_stream(queue, items)
{
    if (await stream_able(queue) === false) {
        return;
    }
    const base = folder_common(items.map(v => v.dir));
    const names = items.map(v => `${(v.dir === base) ? '' : `${v.dir.slice(base.length + 1)}/`}${v.name}`);
    const {blob, ends} = tar_blob(items.map((v, index) => ({file: v.file, name: names[index]})));
    const starts = ends.map((v, index) => v - items[index].size);
    for (const item of items) {
        item.phase = 'copying';
        item.began = Date.now();
        item.sent = 0;
    }
    let moved_at = Date.now();
    const stall = setInterval(function () {
        if ((Date.now() - moved_at > STALL_MS) && (requests[queue.base] !== undefined)) {
            requests[queue.base].stalled = true;
            requests[queue.base].abort();
        }
    }, 1000);
    let failed = null;
    const began = Date.now();
    try {
        const landed = await upload_call(queue, 'POST', 'tar', {dir: base, name: '', id: ''}, {}, blob, function (loaded) {
            moved_at = Date.now();
            for (let i = 0; i < items.length; i++) {
                items[i].sent = Math.max(0, Math.min(items[i].size, loaded - starts[i]));
                if ((loaded >= ends[i]) && (items[i].phase === 'copying')) {
                    items[i].phase = 'sent';
                }
            }
        });
        if (landed.files === items.length) {
            for (const item of items) {
                item.phase = 'ok';
                item.sent = item.size;
            }
            const bytes = items.reduce((sum, v) => sum + v.size, 0);
            const ms = Math.max(1, Date.now() - began);
            queue.stream_bytes = Math.min(STREAM_MAX_BYTES, Math.max(STREAM_MIN_BYTES, Math.round(bytes*STREAM_TARGET_MS/ms)));
        }
        else {
            failed = new Error(`the disk says ${landed.files} of ${items.length} files are in`);
        }
    }
    catch (error) {
        failed = error;
    }
    finally {
        clearInterval(stall);
    }
    if (failed !== null) {
        await stream_settle(queue, items);
    }
    queue.landed_dirs = Array.from(new Set(items.filter(v => v.phase === 'ok').map(v => v.dir)));
    queue.landed++;
    if ((failed === null) || queue.cancelled || queue.paused || ((failed.aborted === true) && (failed.stalled !== true))) {
        report(queue, (failed === null) ? 'copied' : 'stopped', false);
        return;
    }
    // Something in front of the server takes bodies only so big: smaller streams get through
    if ((failed.status === 413) && (queue.stream_bytes > STREAM_MIN_BYTES)) {
        queue.stream_bytes = Math.max(STREAM_MIN_BYTES, Math.floor(queue.stream_bytes/2));
        return;
    }
    if (failed.lasting === true) {
        for (const item of items.filter(v => v.phase === 'waiting')) {
            item.phase = 'error';
            item.said = failed.message;
        }
        report(queue, `the stream was refused: ${failed.message}`, true);
        return;
    }
    const first = items.find(v => v.phase === 'waiting');
    if (first !== undefined) {
        first.phase = 'retrying';
        first.said = (failed.stalled === true) ? 'the stream stalled' : failed.message;
        await wait_out(queue, first, 5);
        first.phase = 'waiting';
    }
}

// The files to go in the next stream: from `item` on, of the same choice, as many as fit its size
function stream_next(queue, item)
{
    const files = [];
    let bytes = 0;
    for (const next of queue.copies) {
        if ((next.phase !== 'waiting') || (next.batch !== item.batch) || (next.size > STREAM_MAX_BYTES)) {
            continue;
        }
        if ((files.length > 0) && ((bytes + next.size > queue.stream_bytes) || (files.length >= STREAM_MAX_FILES))) {
            break;
        }
        files.push(next);
        bytes += next.size;
    }
    return ((files.length > 0) && (files[0] === item)) ? files : [item];
}

// Asked once of each disk: a tar of nothing either goes in, or the disk takes no stream
async function stream_able(queue)
{
    if (queue.stream_known !== true) {
        try {
            await upload_call(queue, 'POST', 'tar', {dir: '~', name: '', id: ''}, {}, new Blob([TAR_EMPTY]));
            queue.stream_known = true;
        }
        catch (error) {
            if (error.aborted === true) {
                return false;
            }
            queue.no_stream = true;
            queue.stream_known = true;
        }
    }
    return (queue.no_stream === false);
}

// After a cut: which files the disk holds whole, by a read of each of their folders, a few at
// once. The rest go back in line, to go again; a folder that cannot be read sends its files again.
async function stream_settle(queue, items)
{
    const open = items.filter(v => v.phase !== 'ok');
    const dirs = Array.from(new Set(open.map(v => v.dir)));
    const listed = new Map();
    async function next() {
        while (dirs.length > 0) {
            const dir = dirs.shift();
            listed.set(dir, await folder_files(queue, dir));
        }
    }
    await Promise.all(Array.from({length: Math.min(SETTLE_AT_ONCE, dirs.length)}, next));
    for (const item of open) {
        const now = listed.get(item.dir).get(item.name);
        if ((now !== undefined) && (now.size === item.size) && (Math.floor(now.mtime_ms/1000) === Math.floor(item.file.lastModified/1000))) {
            item.phase = 'ok';
            item.sent = item.size;
        }
        else {
            item.phase = 'waiting';
            item.sent = 0;
        }
    }
}

// The files of one folder: Map(name -> {size, mtime_ms}), empty when it cannot be read
async function folder_files(queue, dir)
{
    const out = new Map();
    try {
        const answer = await fetch(`${queue.base}?path=${encodeURIComponent(dir)}`, {cache: 'no-store'});
        if (answer.ok) {
            for (const item of (await answer.json()).items) {
                if (item.kind === 'file') {
                    out.set(item.name, {size: item.size, mtime_ms: item.mtime_ms});
                }
            }
        }
    }
    catch {
        // Nothing known is in: its files go again
    }
    return out;
}

// ['/a/b', '/a/b/c', '/a/d'] -> '/a': the folder all of them are in
function folder_common(dirs)
{
    let out = dirs[0];
    for (const dir of dirs) {
        while ((dir !== out) && (dir.startsWith(`${out}/`) === false)) {
            out = out.slice(0, Math.max(0, out.lastIndexOf('/')));
        }
    }
    return out;
}

// XMLHttpRequest, and not fetch, for the one thing fetch cannot say: how much of the body has
// gone over. A gigabyte is minutes, and minutes of a page saying nothing is a page that looks
// broken. A refusal that sending again will not change is `lasting`; the rest is retried.
function upload_call(queue, method, action, item, query, body, progress)
{
    const words = Object.assign({dir: item.dir, name: item.name}, (action === '') ? {} : {id: item.id}, query);
    const where = Object.keys(words).map(v => `${v}=${encodeURIComponent(words[v])}`).join('&');
    const request = new XMLHttpRequest();
    requests[queue.base] = request;
    return new Promise(function (resolve, reject) {
        if (progress !== undefined) {
            request.upload.addEventListener('progress', v => progress(v.loaded));
        }
        request.addEventListener('load', function () {
            const outcome = answer_of(request);
            if ((request.status === 200) && (outcome !== null)) {
                resolve(outcome);
                return;
            }
            const failure = new Error((outcome === null) ? `the server answered ${request.status}` : outcome.error);
            failure.status = request.status;
            failure.lasting = (request.status === 400) || (request.status === 404) || (request.status === 409) || ((request.status === 413) && (action !== 'part'));
            reject(failure);
        });
        request.addEventListener('error', function () {
            reject(new Error('the connection was lost'));
        });
        request.addEventListener('abort', function () {
            const stopped = new Error('stopped');
            stopped.aborted = true;
            stopped.stalled = (request.stalled === true);
            reject(stopped);
        });
        request.open(method, `${queue.base}/upload${(action === '') ? '' : `/${action}`}?${where}`);
        request.send((body === undefined) ? null : body);
    });
}

// A pause before trying again, counted down on the screen; Cancel ends it at once
function wait_out(queue, item, seconds)
{
    item.wait_s = seconds;
    return new Promise(function (resolve) {
        const timer = setInterval(function () {
            item.wait_s--;
            if ((item.wait_s <= 0) || queue.cancelled) {
                clearInterval(timer);
                delete waits[queue.base];
                resolve();
            }
        }, 1000);
        waits[queue.base] = function () {
            clearInterval(timer);
            delete waits[queue.base];
            resolve();
        };
    });
}

// The id of an upload is kept by the browser under the file it is for, so the same file chosen
// again for the same folder — after a reload, a closed tab, a crash — carries on where it was
function upload_id(base, item)
{
    const kept = ids_read();
    const key = upload_key(base, item);
    if (kept[key] === undefined) {
        kept[key] = Array.from(crypto.getRandomValues(new Uint8Array(12)), v => (v % 36).toString(36)).join('');
        ids_write(kept);
    }
    return kept[key];
}

function upload_id_forget(base, item)
{
    const kept = ids_read();
    delete kept[upload_key(base, item)];
    ids_write(kept);
}

function upload_key(base, item)
{
    return [base, item.dir, item.name, item.size, item.file.lastModified].join('\n');
}

function ids_read()
{
    try {
        return JSON.parse(localStorage.getItem(IDS_KEY) || '{}');
    }
    catch {
        return {};
    }
}

function ids_write(kept)
{
    try {
        localStorage.setItem(IDS_KEY, JSON.stringify(kept));
    }
    catch {
        // A browser that keeps nothing still uploads; it only cannot carry on after a reload
    }
}

function stop(queue)
{
    queue.cancelled = true;
    delete plans[queue.base];
    if (requests[queue.base] !== undefined) {
        requests[queue.base].abort();
    }
    if (waits[queue.base] !== undefined) {
        waits[queue.base]();
    }
    resume(queue);
}

// The file under way stops where it is and goes back in line; the queue waits for Resume
function pause(queue)
{
    if ((queue.copying === false) || queue.paused) {
        return;
    }
    queue.paused = true;
    queue.paused_at = Date.now();
    if (requests[queue.base] !== undefined) {
        requests[queue.base].abort();
    }
    if (waits[queue.base] !== undefined) {
        waits[queue.base]();
    }
}

function resume(queue)
{
    // The time paused is not the copy's: its rate and the time left go on from where they stood
    if (queue.paused) {
        queue.paused_ms += Date.now() - queue.paused_at;
    }
    queue.paused = false;
    if (resumes[queue.base] !== undefined) {
        resumes[queue.base]();
        delete resumes[queue.base];
    }
}

// The speed across the copy, for its graph (copy_sampler): how far it is and how fast it went
// over the last few seconds, twice a second while it runs; a pause draws no points
function sampler_start(queue)
{
    return copy_sampler(function () {
        let bytes = 0;
        let done = 0;
        for (const item of queue.copies) {
            bytes += item.size;
            done += (item.phase === 'ok') ? item.size : item.sent;
        }
        return {done, total: bytes, paused: queue.paused};
    }, queue);
}

// What is done is taken off the list; what is still on its way stays
function clear(queue)
{
    queue.copies = queue.copies.filter(v => (v.phase === 'waiting') || (v.phase === 'copying') || (v.phase === 'retrying'));
    report(queue, '', false);
}

function report(queue, note, bad)
{
    queue.note = note;
    queue.bad = bad;
}

// What the server said back, where what came back is json at all
function answer_of(request)
{
    try {
        return JSON.parse(request.responseText);
    }
    catch {
        return null;
    }
}

export default upload_queue;
