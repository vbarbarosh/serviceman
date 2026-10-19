const crypto = require('crypto');
const log_event = require('./log_event');
const logline_token = require('./logline_token');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');

// Tells a connected machine where its lines go and with what token — or that they go nowhere.
// The machine writes the answer down before acting on it, so it keeps sending to the last
// endpoint it heard of while this host is away. Told once per link, and again when the answer
// changes; one telling at a time.
function logline_tell(app, remote)
{
    const state = remote.state;
    if (state.logline_busy === null) {
        state.logline_busy = tell(app, remote).finally(function () {
            state.logline_busy = null;
        });
    }
    return state.logline_busy;
}

async function tell(app, remote)
{
    const state = remote.state;
    if ((state.phase !== 'online') || (remote_can(remote, 'logline') === false)) {
        return;
    }
    try {
        const answer = await answer_make(app, remote);
        const told = logline_mark(answer.logs, (answer.endpoint === undefined) ? null : answer.endpoint, (answer.token === undefined) ? null : crypto.createHash('sha256').update(answer.token).digest('hex'), (answer.dirs === undefined) ? [] : answer.dirs);
        if (state.logline_told === told) {
            return;
        }
        const outcome = await remote_call(app, remote, 'logline_set', answer);
        state.logline_told = told;
        state.logline_floor = outcome.floor;
        state.logline_error = null;
        log_event(app, 'logline_told', {remote: remote.name, logs: answer.logs, floor: outcome.floor});
    }
    catch (error) {
        // Said once per reason: the sweep asks every minute, and a Logline that is down for an
        // hour is one line, not sixty
        if (state.logline_error !== error.message) {
            log_event(app, 'logline_tell_error', {remote: remote.name, reason: error.message, then: 'tried again within a minute'});
        }
        state.logline_error = error.message;
    }
}

// {logs: "off"}, or where to send and with what, and which folders besides the containers:
// {endpoint, token, logs: "all", dirs}
async function answer_make(app, remote)
{
    const logline = app.config.logline;
    if ((logline === null) || (remote.logs !== 'all')) {
        return {logs: 'off'};
    }
    const resources = remote.state.resources;
    const ips = ((resources === null) || (Array.isArray(resources.addresses) === false)) ? [] : resources.addresses;
    if (ips.length === 0) {
        throw new Error('its agent named no address of its own, so there is nothing to bind a token to');
    }
    const kept = await logline_token(app, remote.name, ips);
    remote.state.logline_ips = kept.ips;
    remote.state.logline_issued_at = (kept.issued_at === undefined) ? null : kept.issued_at;
    return {endpoint: logline.endpoint, token: kept.token, logs: 'all', dirs: (remote.log_dirs === undefined) ? [] : remote.log_dirs};
}

// What a telling amounts to, the way the agent says it at hello: the token by its hash, so the
// two can be compared without the agent ever sending the token back
function logline_mark(logs, endpoint, token_sha, dirs)
{
    return JSON.stringify({logs, endpoint, token_sha, dirs});
}

logline_tell.mark = logline_mark;

module.exports = logline_tell;
