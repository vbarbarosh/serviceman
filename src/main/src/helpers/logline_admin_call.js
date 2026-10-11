const secrets_read = require('./secrets_read');
const tailnet_request = require('./tailnet_request');

const ADMIN_TIMEOUT_MS = 10000;

// One call to Logline's /tokens, with the admin token from the Secrets library. Logline's own
// refusal comes back as the error, so the page can say what Logline said. It goes through
// tailscale's proxy where TAILNET_PROXY names one: in serviceman's image, that is the only way
// out to the tailnet.
async function logline_admin_call(app, method, url, body)
{
    const logline = app.config.logline;
    if (logline === null) {
        throw new Error('the config has no logline, so there is no admin token to ask with');
    }
    const secret = secrets_read(app).global[logline.admin];
    if (secret === undefined) {
        throw new Error(`the Secrets library has no ${JSON.stringify(logline.admin)} — the config names it as Logline's ADMIN_TOKEN`);
    }
    const headers = {authorization: `Bearer ${secret}`};
    const text_body = ((body === undefined) ? undefined : JSON.stringify(body));
    if (text_body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(text_body);
    }
    let answer;
    try {
        answer = await tailnet_request(url, {method, headers, body: text_body, timeout_ms: ADMIN_TIMEOUT_MS, proxy: process.env.TAILNET_PROXY});
    }
    catch (error) {
        throw new Error(`Logline at ${url.origin} did not answer: ${error.message}`);
    }
    let json = null;
    try {
        json = JSON.parse(answer.text);
    }
    catch {
        // Not Logline, or not Logline as it should be: the status says the rest
    }
    if ((answer.status < 200) || (answer.status > 299)) {
        throw new Error(`Logline refused ${method} ${url.pathname}: ${((json !== null) && (typeof json.error === 'string')) ? json.error : `${answer.status} ${answer.status_text}`}`);
    }
    return json;
}

module.exports = logline_admin_call;
