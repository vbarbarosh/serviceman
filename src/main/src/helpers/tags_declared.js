// What a machine may say about itself.
//
// A machine written into the config holds a token of its own, so it is trusted with what it
// says: it knows it has a gpu, and the host does not have to be told twice. A machine that
// added itself holds the join token, which is the fleet's password and not a promise about that
// machine — so it may only claim what `join.tags_allowed` says, on every link, not just the
// first one.
function tags_declared(app, remote, claimed)
{
    if (remote.machine === null) {
        return claimed;
    }
    const allowed = (app.config.join === null) ? [] : app.config.join.tags_allowed;
    return claimed.filter(v => allowed.includes(v));
}

module.exports = tags_declared;
