// A browser asking for a page, as opposed to a fetch, an API client or a curl
function wants_html(req)
{
    if (req.method !== 'GET') {
        return false;
    }
    return String(req.headers.accept || '').includes('text/html');
}

module.exports = wants_html;
