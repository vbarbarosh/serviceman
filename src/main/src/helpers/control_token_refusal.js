// Why a token other than the owner's may not do this, in words that end "the token … ", or null
// when it may. `right` is what control_route_right says the request needs.
function control_token_refusal(right, token)
{
    if (right === null) {
        return 'has no right to this';
    }
    if (token.rights.includes(right.right) === false) {
        return `may not ${right.said}`;
    }
    if ((right.remote !== null) && (token.remotes.includes(right.remote) === false)) {
        return `may not see ${right.remote}`;
    }
    return null;
}

module.exports = control_token_refusal;
