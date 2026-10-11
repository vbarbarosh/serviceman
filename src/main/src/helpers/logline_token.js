const log_event = require('./log_event');
const logline_admin_call = require('./logline_admin_call');
const logline_tokens_read = require('./logline_tokens_read');
const logline_tokens_write = require('./logline_tokens_write');

// The token a remote sends its lines with — {endpoint, ips, token, issued_at} — bound by Logline
// to the machine's addresses. The one kept is used while the endpoint and the addresses are what
// they were when it was issued; otherwise Logline is asked again, and its answer replaces it.
async function logline_token(app, name, ips)
{
    const kept = logline_tokens_read(app);
    const endpoint = app.config.logline.endpoint;
    const wanted = ips.slice().sort();
    const found = kept[name];
    if ((found !== undefined) && (found.revoke !== true) && (found.endpoint === endpoint) && (JSON.stringify(found.ips) === JSON.stringify(wanted))) {
        return found;
    }
    const answer = await logline_admin_call(app, 'POST', new URL('/tokens', endpoint), {name, ips: wanted});
    if ((answer === null) || (typeof answer.token !== 'string') || (answer.token === '')) {
        throw new Error('Logline answered /tokens without a token');
    }
    kept[name] = {endpoint, ips: wanted, token: answer.token, issued_at: new Date().toISOString()};
    logline_tokens_write(app);
    log_event(app, 'logline_token_issued', {remote: name, ips: wanted});
    return kept[name];
}

module.exports = logline_token;
