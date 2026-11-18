// Why a token other than the owner's may not do this, in words that end "the token … ", or null
// when it may. `right` is what control_route_right says the request needs; a token holds it
// with the right it is under too: files reads the files as files_read does.
function control_token_refusal(right, token)
{
    if (right === null) {
        return 'has no right to this';
    }
    const under = (typeof right.under === 'string') && token.rights.includes(right.under);
    if ((token.rights.includes(right.right) === false) && (under === false)) {
        return `may not ${right.said}`;
    }
    if ((right.remote !== null) && (token.remotes.includes('*') === false) && (token.remotes.includes(right.remote) === false)) {
        return `may not see ${right.remote}`;
    }
    return null;
}

module.exports = control_token_refusal;
