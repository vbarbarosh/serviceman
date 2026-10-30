// A connection an agent's token holds open, kept until it closes: what the token may no longer
// do stops at once, an open shell, a folder watch and an upload in progress included
// (control_token_sweep). `right` is what it was let in with, as control_route_right says it;
// `ends` is what says the connection is over: the response, or the socket of a shell.
function control_token_live(app, token, right, socket, ends)
{
    const item = {token: token.id, sha256: token.sha256, label: token.label, right, socket};
    app.control_token_live.add(item);
    ends.once('close', function () {
        app.control_token_live.delete(item);
    });
}

module.exports = control_token_live;
