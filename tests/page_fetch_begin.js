const fetch_host = require('./fetch_host');

// The page's fetch for the length of a test: what a module of the page asks of its own origin
// goes to the control door on this port, with the token the signed-in page brings; a door that
// is away fails as a browser's fetch does. Answers with the way back to the fetch there was.
function page_fetch_begin(port)
{
    const fetch_before = globalThis.fetch;
    globalThis.fetch = async function (url, options) {
        if ((typeof url !== 'string') || (url.startsWith('/') === false)) {
            return await fetch_before(url, options);
        }
        const answer = await fetch_host(Object.assign({port, host: '127.0.0.1', path: url}, options));
        return new Response(answer.body, {status: answer.status});
    };
    return function () {
        globalThis.fetch = fetch_before;
    };
}

module.exports = page_fetch_begin;
