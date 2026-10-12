// serviceman's files API for one machine, one function a door, for a page or a node program
// to copy: fetch and nothing else. Every call answers with the API's own JSON and throws with
// its {error} when the answer is not ok. `log` hears each request and its answer, for showing.
//
//     const files = fs_client({base: 'http://127.0.0.1:3001/api/v1/remotes/laptop/fs', log: console.log});
//     const {path, items} = await files.list(null);
//     await files.mkdir(`${path}/notes`);
//     await files.upload(`${path}/notes`, 'a.txt', 'hello');
//     const stop = files.watch(`${path}/notes`, {tree: false, skip: []}, v => console.log(v.type, v.path));
//     const {items, cut} = await files.tree(path, {hash: true, skip: ['.git', 'node_modules']});
export default function fs_client(options)
{
    const base = options.base;
    const log = ((options.log === undefined) ? log_nothing : options.log);
    return {
        // {path, items: [{name, kind: 'dir' or 'file', size, mtime_ms}]}; null is the
        // machine's starting folder
        list: function (path) {
            return call('GET', ((path === null) ? '' : `?path=${encodeURIComponent(path)}`));
        },
        // The body becomes the file, one there already replaced: {path, bytes, replaced}.
        // A string, a Blob or a File from a picker or a drop.
        upload: function (dir, name, body) {
            return call('POST', `/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`, body);
        },
        // The whole path, as mkdir -p
        mkdir: function (path) {
            return call('POST', '/mkdir', {path});
        },
        // A rename, or a move to another folder: `to` is the whole new path
        rename: function (from, to) {
            return call('POST', '/rename', {from, to});
        },
        // A file, or a folder with everything in it
        remove: function (path) {
            return call('POST', '/delete', {path});
        },
        // Where a file is downloaded from: a plain GET, a Range header for a part of it
        file_url: function (path) {
            return `${base}/file${path.split('/').map(encodeURIComponent).join('/')}`;
        },
        // Several names of one folder, as one tar
        tar_url: function (dir, names) {
            return `${base}/tar?dir=${encodeURIComponent(dir)}${names.map(v => `&names=${encodeURIComponent(v)}`).join('')}`;
        },
        // Every file under a folder, at any depth, in one answer: {path, items, unread, cut,
        // files, links, bytes, hashed}, an item {path, kind: 'file', size, mtime_ms, sha256}
        // (sha256 with hash) or {path, kind: 'link', target, mtime_ms}. cut: true when the
        // tree had more than 50,000 names; tree_events has no limit.
        tree: function (path, settings) {
            return call('GET', tree_query(path, Object.assign({}, settings, {delay: 0})));
        },
        tree_events,
        watch,
    };

    // The same walk as events, each the moment it is read: `on` hears start, then item (the
    // same object tree lists, with type: 'item') and unread, then end with the counts, or
    // error. settings.delay spaces them out by that many ms, up to 1000, for watching a page
    // fill. Answers the function that stops it; a walk is not opened again when it drops,
    // since it ended or failed.
    function tree_events(path, settings, on) {
        const url = `${base}${tree_query(path, settings)}`;
        const stop = new AbortController();
        run();
        return function () {
            stop.abort();
        };

        async function run() {
            log({type: 'request', method: 'GET', url, body: null});
            let files = 0;
            try {
                const answer = await fetch(url, {headers: {accept: 'text/event-stream'}, signal: stop.signal});
                if (answer.ok === false) {
                    const refusal = await answer.json();
                    log({type: 'answer', method: 'GET', url, status: answer.status, body: refusal});
                    on({type: 'error', error: refusal.error});
                    return;
                }
                log({type: 'answer', method: 'GET', url, status: answer.status, body: 'a stream of events'});
                for await (const event of events_read(answer.body)) {
                    // An item an event: the log says how many, not each one
                    if (event.type === 'item') {
                        files++;
                    }
                    else {
                        log({type: 'event', url, body: ((event.type === 'end') ? Object.assign({names: files}, event) : event)});
                    }
                    on(event);
                }
            }
            catch (error) {
                if (stop.signal.aborted) {
                    log({type: 'event', url, body: {type: 'stopped', names: files}});
                    return;
                }
                log({type: 'answer', method: 'GET', url, status: 0, body: {error: error.message}});
                on({type: 'error', error: error.message});
            }
        }
    }

    async function call(method, tail, body) {
        const url = `${base}${tail}`;
        const json = ((body !== undefined) && (typeof body === 'object') && ((body instanceof Blob) === false));
        log({type: 'request', method, url, body: (json ? body : body_said(body))});
        const answer = await fetch(url, {
            method,
            headers: (json ? {'content-type': 'application/json'} : {}),
            body: (json ? JSON.stringify(body) : body),
        });
        const out = await answer.json();
        log({type: 'answer', method, url, status: answer.status, body: out});
        if (answer.ok === false) {
            throw new Error(out.error);
        }
        return out;
    }

    // A folder watched: `on` hears {type: 'ready'}, then created, changed and removed with the
    // path inside the folder, and resync when the list has to be read again. Events say what
    // changed, the list says what is there: list the folder after ready and after resync.
    // A stream that drops is opened again in a second, and says ready again. Answers the
    // function that ends it.
    //
    // Read with fetch, not EventSource: the same code runs in node, and a refusal (a 502 with
    // why) is read rather than lost.
    function watch(path, settings, on) {
        const tree = ((settings.tree === true) ? '&tree=1' : '');
        const skip = ((settings.skip === undefined) ? [] : settings.skip).map(v => `&skip=${encodeURIComponent(v)}`).join('');
        const url = `${base}/watch?path=${encodeURIComponent(path)}${tree}${skip}`;
        const stop = new AbortController();
        run();
        return function () {
            stop.abort();
        };

        async function run() {
            while (stop.signal.aborted === false) {
                log({type: 'request', method: 'GET', url, body: null});
                try {
                    const answer = await fetch(url, {signal: stop.signal});
                    if (answer.ok === false) {
                        const refusal = await answer.json();
                        log({type: 'answer', method: 'GET', url, status: answer.status, body: refusal});
                        on({type: 'error', error: refusal.error});
                        return;
                    }
                    log({type: 'answer', method: 'GET', url, status: answer.status, body: 'a stream of events'});
                    for await (const event of events_read(answer.body)) {
                        log({type: 'event', url, body: event});
                        on(event);
                        if (event.type === 'error') {
                            return;
                        }
                    }
                }
                catch (error) {
                    if (stop.signal.aborted) {
                        return;
                    }
                    log({type: 'answer', method: 'GET', url, status: 0, body: {error: error.message}});
                }
                // The link dropped: open it again, and the list is read again after its ready
                await new Promise(v => setTimeout(v, 1000));
            }
        }
    }
}

function log_nothing()
{
}

function tree_query(path, settings)
{
    const hash = ((settings.hash === true) ? '&hash=sha256' : '');
    const skip = (((settings.skip === undefined) || (settings.skip.length === 0)) ? '' : `&skip=${encodeURIComponent(settings.skip.join(','))}`);
    const delay = (((settings.delay === undefined) || (settings.delay === 0)) ? '' : `&delay=${settings.delay}`);
    return `?path=${encodeURIComponent((path === null) ? '' : path)}&tree=1${hash}${skip}${delay}`;
}

// Server-sent events: blocks parted by a blank line, `event:` naming it and `data:` holding the
// JSON; a line that starts with `:` only keeps a quiet stream open
async function* events_read(stream)
{
    const decoder = new TextDecoder();
    let text = '';
    for await (const chunk of stream) {
        text += decoder.decode(chunk, {stream: true});
        let end;
        while ((end = text.indexOf('\n\n')) !== -1) {
            const block = text.slice(0, end);
            text = text.slice(end + 2);
            const lines = block.split('\n');
            const name = lines.filter(v => v.startsWith('event:')).map(v => v.slice(6).trim()).pop();
            const data = lines.filter(v => v.startsWith('data:')).map(v => v.slice(5).trim()).join('\n');
            if (data !== '') {
                // The event's name is its type: an error's data has none of its own
                yield Object.assign({type: name}, JSON.parse(data));
            }
        }
    }
}

// What the log shows of a body that is not JSON
function body_said(body)
{
    if (body === undefined) {
        return null;
    }
    if (typeof body === 'string') {
        return `${body.length} characters`;
    }
    return `${body.size} bytes${(body.name === undefined) ? '' : ` of ${body.name}`}`;
}
