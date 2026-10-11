// The most specific claim wins: an exact hostname beats a wildcard, a longer path beats a shorter one
function route_from_request(app, host, pathname)
{
    const clean = String(host || '').toLowerCase().split(':')[0];
    const exact = app.routes_exact[clean];
    if (exact !== undefined) {
        for (const item of exact) {
            if (path_matches(item.path, pathname)) {
                return item;
            }
        }
    }
    let out = null;
    for (const item of app.routes_wildcard) {
        if ((clean.endsWith(item.suffix) === false) || (path_matches(item.path, pathname) === false)) {
            continue;
        }
        if ((out === null) || (item.path.length > out.path.length)) {
            out = item;
        }
    }
    return out;
}

// "/pdf" claims "/pdf" and everything under "/pdf/", and nothing like "/pdfx"
function path_matches(prefix, pathname)
{
    if (prefix === '') {
        return true;
    }
    if (pathname.startsWith(prefix) === false) {
        return false;
    }
    return (pathname.length === prefix.length) || (pathname[prefix.length] === '/');
}

module.exports = route_from_request;
