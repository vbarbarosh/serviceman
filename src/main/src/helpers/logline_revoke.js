const log_event = require('./log_event');
const logline_admin_call = require('./logline_admin_call');
const logline_tokens_read = require('./logline_tokens_read');
const logline_tokens_write = require('./logline_tokens_write');

// A remote taken out of the config has its token taken back from Logline. One that cannot be
// taken back now — Logline is away — is marked, and the next sweep tries again: a machine that
// is gone from the config must not go on writing to the log.
async function logline_revoke(app, name)
{
    const kept = logline_tokens_read(app);
    const found = kept[name];
    if (found === undefined) {
        return;
    }
    try {
        await logline_admin_call(app, 'DELETE', new URL(`/tokens/${encodeURIComponent(name)}`, found.endpoint));
    }
    catch (error) {
        if (found.revoke !== true) {
            found.revoke = true;
            logline_tokens_write(app);
        }
        log_event(app, 'logline_revoke_error', {remote: name, reason: error.message, then: 'tried again within a minute'});
        return;
    }
    delete kept[name];
    logline_tokens_write(app);
    log_event(app, 'logline_token_revoked', {remote: name});
}

module.exports = logline_revoke;
