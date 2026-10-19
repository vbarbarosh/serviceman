const asset_stamp = require('./asset_stamp');
const asset_stamped = require('./asset_stamped');
const fs = require('fs');
const mime_type_from_path = require('./mime_type_from_path');
const path = require('path');
const render_error_page = require('./render_error_page');

// The files of the control page and its skins, served from the folders they live in — the one
// thing serviceman serves from disk
async function serve_static_file(app, service, req, res, prefix)
{
    const mount = (prefix === undefined) ? '' : prefix;
    if ((req.method !== 'GET') && (req.method !== 'HEAD')) {
        render_error_page(res, 405, 'Only GET is served here', `${service.name} is a folder of files`);
        return;
    }
    const pathname = pathname_from_url(req.url);
    if (pathname === null) {
        render_error_page(res, 400, 'The address cannot be read', req.url);
        return;
    }
    const target = path.resolve(service.root, `.${pathname}`);
    if ((target !== service.root) && (target.startsWith(`${service.root}${path.sep}`) === false)) {
        render_error_page(res, 403, 'Outside the folder of this service', pathname);
        return;
    }
    const found = await stat_or_null(target);
    if ((found !== null) && found.isDirectory()) {
        if (pathname.endsWith('/') === false) {
            res.writeHead(301, {location: `${mount}${pathname}/`});
            res.end();
            return;
        }
        await send_file(res, path.join(target, 'index.html'), req.method, fresh_of(service));
        return;
    }
    if (found === null) {
        // A page that keeps what you are looking at in the address answers to every address it
        // wrote: /services/foo is that page again, so a reload lands where it left off. Only an
        // address that names a file is allowed to be missing, or a mistyped script would come
        // back as HTML and fail somewhere else entirely.
        if ((service.one_page === true) && (path.extname(pathname) === '')) {
            await send_file(res, path.join(service.root, 'index.html'), req.method, fresh_of(service));
            return;
        }
        render_error_page(res, 404, 'No such page', pathname);
        return;
    }
    await send_file(res, target, req.method, fresh_of(service));
}

// The control page is served fresh: every address it imports carries the stamp of the folder,
// so a file that changed is a file the browser has to ask for again. A folder a service serves
// is that service's own business, and is left alone.
function fresh_of(service)
{
    return (service.fresh === true) ? asset_stamp(service.root) : null;
}

function pathname_from_url(url)
{
    try {
        return decodeURIComponent(new URL(url, 'http://serviceman.invalid').pathname);
    }
    catch {
        return null;
    }
}

async function stat_or_null(target)
{
    try {
        return await fs.promises.stat(target);
    }
    catch {
        return null;
    }
}

// `fresh` is for the folder serviceman serves as itself — the control page. A browser that
// keeps an old copy of it shows an old page: the same buttons, the same fields, none of the new
// ones, and nothing on screen says why. A page a service serves is that service's business.
async function send_file(res, file_path, method, stamp)
{
    const found = await stat_or_null(file_path);
    if ((found === null) || (found.isFile() === false)) {
        render_error_page(res, 404, 'No such page', path.basename(file_path));
        return;
    }
    if ((stamp !== null) && /\.(js|html)$/.test(file_path)) {
        await send_stamped(res, file_path, method, stamp);
        return;
    }
    res.writeHead(200, Object.assign({
        'content-type': mime_type_from_path(file_path),
        'content-length': found.size,
        'last-modified': found.mtime.toUTCString(),
    }, (stamp === null) ? {} : {'cache-control': 'no-cache'}));
    if (method === 'HEAD') {
        res.end();
        return;
    }
    await new Promise(function (resolve) {
        const stream = fs.createReadStream(file_path);
        stream.on('error', function () {
            res.destroy();
            resolve();
        });
        res.once('close', resolve);
        stream.pipe(res);
    });
}

// A page and its modules, with the stamp written into every address they pull in
async function send_stamped(res, file_path, method, stamp)
{
    const text = asset_stamped(await fs.promises.readFile(file_path, 'utf8'), stamp);
    res.writeHead(200, {
        'content-type': mime_type_from_path(file_path),
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-cache',
    });
    res.end((method === 'HEAD') ? undefined : text);
}

module.exports = serve_static_file;
