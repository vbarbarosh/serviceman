// Every change to the config file goes through here, one at a time.
//
// There are two writers now: the control page, and a machine adding itself with the join token.
// Both read the file, change what they came for, and write it back — so two of them at once
// would read the same text and the second would write the first's change away. The queue is one
// promise: a change waits for the one before it, whether that one worked or failed.
function config_locked(app, fn)
{
    const out = app.config_lock.then(fn, fn);
    app.config_lock = out.then(nothing, nothing);
    return out;
}

function nothing()
{
    return null;
}

module.exports = config_locked;
