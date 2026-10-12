const path = require('path');

const BODY_LIMIT_BYTES = 1024*1024;
// A comment line down a watch or a tree this often, which is what keeps a proxy from closing it as idle
const WATCH_KEEP_MS = 15000;

// What a file may land under: a name of its own, and nothing that walks out of the folder it
// was sent to
const RE_FILE_NAME = /^[^/\\]+$/;
const RE_FILE = /^\/file(\/.*)$/;
const RE_DO = /^\/(rename|delete|mkdir)$/;
// The id the page draws for one upload in parts: letters and digits
const RE_UPLOAD_ID = /^[a-z0-9]{8,64}$/;

const TYPE_BY_EXT = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wasm': 'application/wasm',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
};

// The File Manager's whole API, under whatever base the host mounts it at. The host routes
// every address under that base here, with `tail` the part after it, and gives a disk:
// {list, stat, read, tar, write, rename, remove, mkdir}, for a file in parts
// {part_stat, part_write, part_finish, part_remove}, for a folder watched {watch}, and for a whole tree
// {tree}. What the disk is — a machine over a
// link, a folder here — is the host's business, and so is who may ask.
//
//     options = {disk, tail, log, name}
//     log(event, fields)  what was done, for the host's own log
//     name                a tar of the root folder is saved under this
async function file_manager_serve(req, res, options)
{
    const url = new URL(req.url, 'http://file-manager.invalid');
    const tail = options.tail;
    const log = ((options.log === undefined) ? function () {} : options.log);
    const ctx = {disk: options.disk, log, name: ((options.name === undefined) ? 'files' : options.name)};
    if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
        await list_serve(ctx, req, res, url);
        return;
    }
    const file = RE_FILE.exec(tail);
    if ((file !== null) && ((req.method === 'GET') || (req.method === 'HEAD'))) {
        await file_serve(ctx, req, res, decodeURIComponent(file[1]));
        return;
    }
    if ((tail === '/tar') && ((req.method === 'GET') || (req.method === 'HEAD'))) {
        tar_serve(ctx, req, res, url);
        return;
    }
    if ((tail === '/watch') && (req.method === 'GET')) {
        watch_serve(ctx, req, res, url);
        return;
    }
    const act = RE_DO.exec(tail);
    if ((act !== null) && (req.method === 'POST')) {
        await act_serve(ctx, req, res, act[1]);
        return;
    }
    if ((tail === '/upload') && (req.method === 'POST')) {
        await upload_serve(ctx, req, res, url);
        return;
    }
    if ((tail === '/upload/part') && ((req.method === 'GET') || (req.method === 'POST'))) {
        await part_serve(ctx, req, res, url);
        return;
    }
    if (((tail === '/upload/finish') || (tail === '/upload/cancel')) && (req.method === 'POST')) {
        await part_end_serve(ctx, res, url, tail.slice('/upload/'.length));
        return;
    }
    send_json(res, 404, {error: `no such door: ${url.pathname}`});
}

// GET <base> (query)
// One folder, read when asked and kept nowhere. No path is the disk's own starting folder.
async function list_serve(ctx, req, res, url)
{
    if (url.searchParams.get('tree') === '1') {
        tree_serve(ctx, req, res, url);
        return;
    }
    try {
        send_json(res, 200, await ctx.disk.list(url.searchParams.get('path')));
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// GET <base>?tree=1 (query, header:accept)
// Every file under a folder, at any depth, in one answer: links said as links and never
// followed, folders not said, the names given as skip left out wherever they are, and with
// hash=sha256 each file's hash, which the disk keeps while the file's size and time stay. An
// answer that accepts text/event-stream gets each file as an event the moment it is read, so
// a caller sees the walk go; any other gets one JSON once the walk is over. The answer waits
// for the first line, so a folder that cannot be read is an error, not an empty stream.
function tree_serve(ctx, req, res, url)
{
    if (ctx.disk.tree === undefined) {
        send_json(res, 501, {error: 'this disk cannot list a whole tree'});
        return;
    }
    const hash = url.searchParams.get('hash');
    if ((hash !== null) && (hash !== 'sha256')) {
        send_json(res, 400, {error: `a hash is sha256, and ${JSON.stringify(hash)} is not one`});
        return;
    }
    const dir = url.searchParams.get('path');
    const skip = url.searchParams.getAll('skip').flatMap(v => v.split(',')).map(v => v.trim()).filter(v => (v !== ''));
    const events = String(req.headers.accept).includes('text/event-stream');
    let stream;
    try {
        stream = ctx.disk.tree(dir, {hash: (hash === 'sha256'), skip});
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    const time0 = Date.now();
    const listed = {path: null, items: [], unread: []};
    let started = false;
    let end = null;
    let rest = '';
    // A long hash says nothing for a while; a comment line keeps the request from looking idle
    const timer = setInterval(function () {
        if (started && events) {
            res.write(': still reading\n\n');
        }
    }, WATCH_KEEP_MS);
    function fail(error) {
        if (started && events) {
            // The stream is under way and cannot become an error page: it says why, and ends
            res.end(`event: error\ndata: ${JSON.stringify({error: error.message})}\n\n`);
            return;
        }
        if (res.headersSent === false) {
            send_json(res, 502, {error: error.message});
        }
    }
    stream.on('data', function (chunk) {
        const lines = (rest + chunk.toString('utf8')).split('\n');
        rest = lines.pop();
        for (const line of lines) {
            if (line.trim() === '') {
                continue;
            }
            const event = JSON.parse(line);
            if (started === false) {
                started = true;
                if (events) {
                    res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no'});
                }
            }
            if (event.type === 'start') {
                listed.path = event.path;
            }
            if (event.type === 'end') {
                end = event;
            }
            if (events) {
                res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                continue;
            }
            if ((event.type === 'file') || (event.type === 'link')) {
                event.kind = event.type;
                delete event.type;
                listed.items.push(event);
            }
            else if (event.type === 'unread') {
                delete event.type;
                listed.unread.push(event);
            }
        }
    });
    stream.on('end', function () {
        if (end === null) {
            fail(new Error('the disk stopped before the whole tree was read'));
            return;
        }
        if (events) {
            res.end();
            return;
        }
        listed.items.sort((a, b) => ((a.path < b.path) ? -1 : ((a.path > b.path) ? 1 : 0)));
        send_json(res, 200, Object.assign(listed, {files: end.files, links: end.links, bytes: end.bytes, hashed: end.hashed}));
    });
    stream.on('error', fail);
    res.on('close', function () {
        clearInterval(timer);
        stream.destroy();
        if (end !== null) {
            ctx.log('tree_listed', {path: listed.path, hash: (hash === 'sha256'), files: end.files, hashed: end.hashed, ms: Date.now() - time0});
        }
    });
}

// GET <base>/file/<path> (header:range)
// A file served the way a file server serves one: its own content type, so a browser opens
// what it can; HEAD for the size alone; and one bytes= range answered as 206, which is what
// lets a video seek. The file's path is the address's own tail, so a page opened this way
// finds its neighbours: its style.css sits on the same address one name over.
async function file_serve(ctx, req, res, asked)
{
    let stat;
    try {
        stat = await ctx.disk.stat(asked);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    if (stat.kind === 'dir') {
        send_json(res, 400, {error: `${asked} is a folder — a folder comes as a tar`});
        return;
    }
    const range = range_of(req.headers.range, stat.size);
    if (range === 'bad') {
        res.writeHead(416, {'content-range': `bytes */${stat.size}`});
        res.end();
        return;
    }
    const headers = {
        'content-type': mime_type_of(asked),
        'content-length': ((range === null) ? stat.size : range.end - range.start + 1),
        'content-disposition': content_disposition('inline', path.basename(asked)),
        'accept-ranges': 'bytes',
        'last-modified': new Date(stat.mtime_ms).toUTCString(),
        'cache-control': 'no-cache',
    };
    if (range !== null) {
        headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    }
    res.writeHead(((range === null) ? 200 : 206), headers);
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    let stream;
    try {
        stream = ctx.disk.read(asked, range);
    }
    catch {
        // The disk went away between the stat and the read; the length promised above cannot
        // be kept, and a cut is what says so
        res.destroy();
        return;
    }
    let bytes = 0;
    stream.on('data', function (chunk) {
        bytes += chunk.length;
        if (res.write(chunk) === false) {
            stream.pause();
            res.once('drain', function () {
                stream.resume();
            });
        }
    });
    stream.on('end', function () {
        res.end();
        ctx.log('file_read', {path: asked, bytes});
    });
    stream.on('error', function () {
        res.destroy();
    });
    res.on('close', function () {
        stream.destroy();
    });
}

// GET <base>/tar (query)
// Several names — a folder among them — come as one tar written on the way out
function tar_serve(ctx, req, res, url)
{
    const dir = String(url.searchParams.get('dir') || '');
    const file_name = `${path.basename(dir) || ctx.name}.tar`;
    if (req.method === 'HEAD') {
        // A tar is written as it goes, so there is no length to promise — the headers alone
        res.writeHead(200, {'content-type': 'application/x-tar', 'content-disposition': content_disposition('attachment', file_name)});
        res.end();
        return;
    }
    let stream;
    try {
        stream = ctx.disk.tar(dir, url.searchParams.getAll('names'));
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    // The headers wait for the first byte: a folder that cannot be read has to be an error
    // here, not an empty download
    let started = false;
    let bytes = 0;
    function begin() {
        if (started) {
            return;
        }
        started = true;
        res.writeHead(200, {
            'content-type': 'application/x-tar',
            'content-disposition': content_disposition('attachment', file_name),
            'cache-control': 'no-store',
        });
    }
    stream.on('data', function (chunk) {
        begin();
        bytes += chunk.length;
        if (res.write(chunk) === false) {
            stream.pause();
            res.once('drain', function () {
                stream.resume();
            });
        }
    });
    stream.on('end', function () {
        begin();
        res.end();
        ctx.log('file_read', {dir, bytes});
    });
    stream.on('error', function (error) {
        if (started) {
            // The download is under way and cannot become an error page; a cut is what says so
            res.destroy();
            return;
        }
        send_json(res, 502, {error: error.message});
    });
    res.on('close', function () {
        stream.destroy();
    });
}

// GET <base>/watch (query)
// A folder watched, as server-sent events for as long as the page keeps the request open:
// ready once the watch holds, then created, changed and removed, and resync when the disk lost
// track and the folder should be listed again. tree=1 watches the folders under it too, but the
// names given as skip. The answer waits for the watch to hold, so a folder that cannot be
// watched is an error, not an empty stream; a disk that cannot watch says so with a 501.
function watch_serve(ctx, req, res, url)
{
    if (ctx.disk.watch === undefined) {
        send_json(res, 501, {error: 'this disk cannot watch a folder'});
        return;
    }
    const dir = url.searchParams.get('path');
    const tree = (url.searchParams.get('tree') === '1');
    let stream;
    try {
        stream = ctx.disk.watch(dir, {tree, skip: url.searchParams.getAll('skip')});
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    const time0 = Date.now();
    let started = false;
    let events = 0;
    let rest = '';
    // A quiet folder still says something now and then, so nothing between closes the request
    const timer = setInterval(function () {
        if (started) {
            res.write(': still watching\n\n');
        }
    }, WATCH_KEEP_MS);
    stream.on('data', function (chunk) {
        const lines = (rest + chunk.toString('utf8')).split('\n');
        rest = lines.pop();
        for (const line of lines) {
            if (line.trim() === '') {
                continue;
            }
            const event = JSON.parse(line);
            if (started === false) {
                started = true;
                res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no'});
            }
            else {
                events++;
            }
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
    });
    stream.on('end', function () {
        res.end();
    });
    stream.on('error', function (error) {
        if (started) {
            // The stream is under way and cannot become an error page: it says why, and ends
            res.end(`event: error\ndata: ${JSON.stringify({error: error.message})}\n\n`);
            return;
        }
        send_json(res, 502, {error: error.message});
    });
    res.on('close', function () {
        clearInterval(timer);
        stream.destroy();
        if (started) {
            ctx.log('folder_watched', {path: dir, tree, events, ms: Date.now() - time0});
        }
    });
}

// POST <base>/rename (body)
// POST <base>/delete (body)
// POST <base>/mkdir (body)
// Renaming carries a name to another — another folder included, which is what moving is —
// deleting takes a file or a whole folder away, and mkdir makes the whole path the way
// mkdir -p does
async function act_serve(ctx, req, res, action)
{
    let body;
    try {
        body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
        return;
    }
    try {
        if (action === 'mkdir') {
            const answer = await ctx.disk.mkdir(String(body.path));
            ctx.log('fs_folder_made', {path: body.path});
            send_json(res, 200, answer);
            return;
        }
        if (action === 'rename') {
            const answer = await ctx.disk.rename(String(body.from), String(body.to));
            ctx.log('fs_renamed', {from: body.from, to: body.to});
            send_json(res, 200, answer);
            return;
        }
        const answer = await ctx.disk.remove(String(body.path));
        ctx.log('fs_deleted', {path: body.path});
        send_json(res, 200, answer);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// POST <base>/upload (body, query)
// A file into a folder, under a name of its own. The disk answers where it landed, how big it
// is, and whether it replaced one.
async function upload_serve(ctx, req, res, url)
{
    const file = ((url.searchParams.get('name') === null) ? '' : url.searchParams.get('name'));
    const dir = ((url.searchParams.get('dir') === null) ? '' : url.searchParams.get('dir').trim());
    if ((RE_FILE_NAME.test(file) === false) || (file === '.') || (file === '..')) {
        send_json(res, 400, {error: `a file lands under a name of its own, and ${JSON.stringify(file)} is not one`});
        return;
    }
    if (dir === '') {
        send_json(res, 400, {error: 'a folder is required'});
        return;
    }
    try {
        const landed = await ctx.disk.write(dir, file, req);
        ctx.log('file_copied', {path: landed.path, bytes: landed.bytes});
        send_json(res, 200, landed);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// GET <base>/upload/part (query)
// POST <base>/upload/part (body, query)
// A file in parts, for a file too big for one request or a link that drops: GET says how
// much of it is in, POST writes one part at the offset it names. A part sent again after its
// answer was lost starts before the end, and what stood from there on is written over.
async function part_serve(ctx, req, res, url)
{
    const where = part_where(ctx, res, url);
    if (where === null) {
        return;
    }
    try {
        if (req.method === 'GET') {
            send_json(res, 200, await ctx.disk.part_stat(where.dir, where.name, where.id));
            return;
        }
        const offset = Number(url.searchParams.get('offset'));
        if ((Number.isInteger(offset) === false) || (offset < 0)) {
            send_json(res, 400, {error: 'a part starts at a byte of the file: offset'});
            return;
        }
        send_json(res, 200, await ctx.disk.part_write(where.dir, where.name, where.id, offset, req));
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// POST <base>/upload/finish (query)
// POST <base>/upload/cancel (query)
// The parts become the file once all `size` bytes are in; or what came of them goes
async function part_end_serve(ctx, res, url, action)
{
    const where = part_where(ctx, res, url);
    if (where === null) {
        return;
    }
    try {
        if (action === 'cancel') {
            const answer = await ctx.disk.part_remove(where.dir, where.name, where.id);
            ctx.log('file_copy_cancelled', {dir: where.dir, name: where.name});
            send_json(res, 200, answer);
            return;
        }
        const size = Number(url.searchParams.get('size'));
        if ((Number.isInteger(size) === false) || (size < 0)) {
            send_json(res, 400, {error: 'a file is finished at its size in bytes: size'});
            return;
        }
        const landed = await ctx.disk.part_finish(where.dir, where.name, where.id, size);
        ctx.log('file_copied', {path: landed.path, bytes: landed.bytes});
        send_json(res, 200, landed);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// The folder, name and id every request about a file in parts carries, or the refusal. A disk
// that cannot keep parts says so with a 501, and the page sends the file in one piece.
function part_where(ctx, res, url)
{
    if (ctx.disk.part_write === undefined) {
        send_json(res, 501, {error: 'this disk takes a file in one piece'});
        return null;
    }
    const name = ((url.searchParams.get('name') === null) ? '' : url.searchParams.get('name'));
    const dir = ((url.searchParams.get('dir') === null) ? '' : url.searchParams.get('dir').trim());
    const id = ((url.searchParams.get('id') === null) ? '' : url.searchParams.get('id'));
    if ((RE_FILE_NAME.test(name) === false) || (name === '.') || (name === '..')) {
        send_json(res, 400, {error: `a file lands under a name of its own, and ${JSON.stringify(name)} is not one`});
        return null;
    }
    if (dir === '') {
        send_json(res, 400, {error: 'a folder is required'});
        return null;
    }
    if (RE_UPLOAD_ID.test(id) === false) {
        send_json(res, 400, {error: `an upload is named by letters and digits, and ${JSON.stringify(id)} is not that`});
        return null;
    }
    return {dir, name, id};
}

// The name a download is saved under. A header holds ascii and a name holds anything, so the
// real name rides percent-encoded (RFC 6266), with a plain-ascii stand-in for whoever reads
// neither — a raw name here is the one thing node refuses whole.
function content_disposition(kind, file_name)
{
    const fallback = file_name.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]+/g, '_');
    const encoded = encodeURIComponent(file_name).replace(/[!'()*]/g, v => `%${v.charCodeAt(0).toString(16)}`);
    return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// The one range a browser asks with: bytes=from-to, either side open. A range that starts
// past the end cannot be served and says so; anything unreadable is answered whole.
function range_of(header, size)
{
    if (header === undefined) {
        return null;
    }
    const found = /^bytes=(\d*)-(\d*)$/.exec(header);
    if ((found === null) || ((found[1] === '') && (found[2] === ''))) {
        return null;
    }
    if (found[1] === '') {
        // The last N bytes — how a player reads an mp4's index
        const wanted = parseInt(found[2], 10);
        if ((wanted === 0) || (size === 0)) {
            return 'bad';
        }
        return {start: Math.max(0, size - wanted), end: size - 1};
    }
    const start = parseInt(found[1], 10);
    if (start >= size) {
        return 'bad';
    }
    const end = ((found[2] === '') ? size - 1 : Math.min(size - 1, parseInt(found[2], 10)));
    if (end < start) {
        return null;
    }
    return {start, end};
}

// Enough types for a folder of static pages; anything else is downloaded as bytes
function mime_type_of(file_path)
{
    return TYPE_BY_EXT[path.extname(file_path).toLowerCase()] || 'application/octet-stream';
}

// A small request body; a body above the limit is refused, not buffered
function body_read(req, limit_bytes)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (chunk) {
            size += chunk.length;
            if (size > limit_bytes) {
                reject(new Error(`the body is above ${limit_bytes} bytes`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

function send_json(res, status, value)
{
    const text = JSON.stringify(value, null, 4);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
    });
    res.end(text);
}

module.exports = file_manager_serve;
