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

// base -> {copies, copying, note, bad, landed, landed_dir, whole, part_bytes, take, refuse, stop,
// clear}. `landed` counts the files that arrived and `landed_dir` is the folder of the last one,
// for a tab showing that folder to read it again; `whole` is a disk that keeps no parts;
// `part_bytes` is how big a part gets through; `began` is when the copying under way started.
function upload_queue(base)
{
    if (queues[base] === undefined) {
        const queue = reactive({base, copies: [], copying: false, cancelled: false, note: '', bad: false, landed: 0, landed_dir: '', began: 0, whole: false, part_bytes: PART_BYTES});
        queue.take = function (list, held) {
            return take(queue, list, held);
        };
        queue.release = function (items, why) {
            release(queue, items, why);
        };
        queue.refuse = function (labels, why) {
            refuse(queue, labels, why);
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
// `label` the name as the list of uploads shows it, with the folders it came in. `held` files
// are shown at once and wait for their folders to be made: release() lets them go.
function take(queue, list, held)
{
    const out = [];
    for (const {file, dir, label} of list) {
        queue.copies.push({name: file.name, label, size: file.size, file, dir, phase: (held ? 'held' : 'waiting'), said: '', replaced: false, sent: 0, began: 0, began_at: null, id: '', wait_s: 0, finish_sent_at: null});
        out.push(queue.copies.at(-1));
    }
    if (held !== true) {
        copy(queue);
    }
    return out;
}

// The folders of files held are made, and they join the queue; or not, and they say why
function release(queue, items, why)
{
    for (const item of items.filter(v => v.phase === 'held')) {
        item.phase = ((why === '') ? 'waiting' : 'error');
        item.said = why;
    }
    if (why === '') {
        copy(queue);
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
    report(queue, '', false);
    try {
        for (;;) {
            const item = queue.copies.find(v => v.phase === 'waiting');
            if ((item === undefined) || queue.cancelled) {
                break;
            }
            await copy_one(queue, item);
        }
    }
    finally {
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
    while (queue.cancelled === false) {
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
        error.lasting = (error.lasting || (error.status === 413));
        throw error;
    }
}

// The file in one request. One that fails is sent again whole, after the same pauses as a part:
// the disk writes it under a name of its own until the last byte is in, so a half never stands.
async function copy_whole(queue, item)
{
    let failures = 0;
    while (queue.cancelled === false) {
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
    item.phase = 'cancelled';
    report(queue, 'stopped', false);
}

// A file is in: where it landed, for the list of uploads and for a tab showing its folder
function land(queue, item, landed)
{
    item.phase = 'ok';
    item.said = landed.path;
    item.replaced = landed.replaced;
    queue.landed_dir = item.dir;
    queue.landed++;
    report(queue, 'copied', false);
}

// XMLHttpRequest, and not fetch, for the one thing fetch cannot say: how much of the body has
// gone over. A gigabyte is minutes, and minutes of a page saying nothing is a page that looks
// broken. A refusal that sending again will not change is `lasting`; the rest is retried.
function upload_call(queue, method, action, item, query, body, progress)
{
    const words = Object.assign({dir: item.dir, name: item.name}, ((action === '') ? {} : {id: item.id}), query);
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
            const error = new Error((outcome === null) ? `the server answered ${request.status}` : outcome.error);
            error.status = request.status;
            error.lasting = ((request.status === 400) || (request.status === 404) || (request.status === 409) || ((request.status === 413) && (action !== 'part')));
            reject(error);
        });
        request.addEventListener('error', function () {
            reject(new Error('the connection was lost'));
        });
        request.addEventListener('abort', function () {
            const error = new Error('stopped');
            error.aborted = true;
            reject(error);
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
    if (requests[queue.base] !== undefined) {
        requests[queue.base].abort();
    }
    if (waits[queue.base] !== undefined) {
        waits[queue.base]();
    }
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
