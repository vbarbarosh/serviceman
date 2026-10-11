// A query string can carry a password, a token or an email — the visitor's, not serviceman's.
// The log keeps the shape of the request, so it still explains what happened, and drops the
// values, so a log file is never worth stealing.
//
// What is left behind is `***`, printable ascii: the address stays one bare word in the line
// instead of being quoted for the sake of one character.
function url_logged(url)
{
    const mark = url.indexOf('?');
    if (mark === -1) {
        return url;
    }
    const names = [];
    for (const pair of url.slice(mark + 1).split('&')) {
        const at = pair.indexOf('=');
        names.push((at === -1) ? pair : `${pair.slice(0, at)}=***`);
    }
    return `${url.slice(0, mark)}?${names.join('&')}`;
}

module.exports = url_logged;
