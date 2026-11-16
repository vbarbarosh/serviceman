const child_process = require('child_process');
const crypto = require('crypto');
const log_event = require('./log_event');
const tailnet_name_read = require('./tailnet_name_read');
const tls = require('tls');

// The first one takes a while: tailscale asks Let's Encrypt for it and waits for its DNS
const TIMEOUT_MS = 180000;
// tailscale renews the one it holds well before it ends and gives that one until then: asked
// once a day, the one in use is never the old one for long
const RENEW_MS = 86400000;
// One that tailscale could not give is asked for again after this long
const RETRY_MS = 600000;

const RE_PEM = /-----BEGIN ([A-Z ]+)-----[\s\S]+?-----END \1-----/g;

// The tailnet's certificate for serviceman's own tailnet name (serviceman.tail1234.ts.net), as
// tailscale in its image gives it, for each app's own port to answer https with
// (app_ports_here). It is kept in memory alone; tailscale keeps its own copy. With no
// tailscale, off the tailnet, or on a tailnet that gives no certificates (HTTPS is off in its
// DNS settings) there is none: the ports answer http as before, and the log says why, once per
// reason.
//
// Called at the start and on the minute; it asks only when one is due, one ask at a time.
// app.tailnet_cert holds {domain, context, until, at, error, busy}: context null while there
// is none.
async function tailnet_cert_read(app)
{
    const held = app.tailnet_cert;
    const wait = (held.context === null) ? RETRY_MS : RENEW_MS;
    if (held.busy || ((held.at !== 0) && (Date.now() - held.at < wait))) {
        return;
    }
    held.busy = true;
    try {
        // Not on the tailnet yet: asked again on the next minute
        const domain = await tailnet_name_read();
        if (domain === null) {
            return;
        }
        held.at = Date.now();
        try {
            const pair = pair_of(await cert_ask(domain));
            const until = new Date(new crypto.X509Certificate(pair.cert).validTo).toISOString();
            const context = tls.createSecureContext(pair);
            if ((held.domain !== domain) || (held.until !== until)) {
                log_event(app, 'tailnet_cert', {domain, until});
            }
            Object.assign(held, {domain, context, until, error: null});
        }
        catch (error) {
            // One held is still good until it ends, and is kept
            const then = (held.context === null) ? 'the apps\' ports answer http; asked again in 10 minutes' : `the one held is used until ${held.until}; asked again tomorrow`;
            if (error.message !== held.error) {
                log_event(app, 'tailnet_cert_error', {domain, reason: error.message, then});
            }
            held.error = error.message;
        }
    }
    finally {
        held.busy = false;
    }
}

// What `tailscale cert` prints with both its files on stdout: the certificate, then the key
function cert_ask(domain)
{
    return new Promise(function (resolve, reject) {
        child_process.execFile('tailscale', ['cert', '--cert-file', '-', '--key-file', '-', domain], {timeout: TIMEOUT_MS, maxBuffer: 1024*1024}, function (error, stdout, stderr) {
            if (error !== null) {
                // tailscale's own last line says why: a tailnet with HTTPS off, a name it does not have
                const said = String(stderr).trim().split('\n').pop();
                reject(new Error((said === '') ? error.message : said));
                return;
            }
            resolve(String(stdout));
        });
    });
}

// The certificate with its chain, and the key: {cert, key}
function pair_of(text)
{
    const blocks = text.match(RE_PEM) || [];
    const cert = blocks.filter(v => v.startsWith('-----BEGIN CERTIFICATE-----')).join('\n');
    const key = blocks.find(v => /^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v));
    if ((cert === '') || (key === undefined)) {
        throw new Error('tailscale cert printed no certificate and key');
    }
    return {cert, key};
}

tailnet_cert_read.pair_of = pair_of;

module.exports = tailnet_cert_read;
