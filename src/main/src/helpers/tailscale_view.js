const tailscale_run = require('./tailscale_run');

const TIMEOUT_MS = 5000;

// Everything serviceman does with tailscale, as the Tailscale page shows it: tailscale's own
// word on this machine now (`tailscale status --json`, asked when the page asks), the
// certificate the apps' own ports answer https with (tailnet_cert_read), the names of the apps
// serviceman answers on the tailnet (apps_dns_start), the way out to the tailnet
// (tailnet_request), and the last calls to tailscale (tailscale_run).
//
//     here           false where there is no tailscale: serviceman runs outside its image
//     error          why tailscale said nothing, null when it did
//     state          tailscale's BackendState: Running, NeedsLogin, Stopped, ...
//     login_link     where to sign this machine in, while tailscale waits for it
//     cert_domains   the names the tailnet gives a certificate for; none while HTTPS is off
async function tailscale_view(app)
{
    const status = await status_read();
    const self = status.json.Self || {};
    const tailnet = status.json.CurrentTailnet || {};
    const cert = app.tailnet_cert;
    const dns = ((app.servers === undefined) || (app.servers === null)) ? null : app.servers.dns;
    return {
        here: status.here,
        error: status.error,
        state: status.json.BackendState || null,
        version: status.json.Version || null,
        name: String(self.DNSName || '').replace(/\.$/, '') || null,
        addresses: Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [],
        tailnet: tailnet.Name || null,
        magic_dns: (tailnet.MagicDNSEnabled === undefined) ? null : (tailnet.MagicDNSEnabled === true),
        cert_domains: Array.isArray(status.json.CertDomains) ? status.json.CertDomains : [],
        login_link: status.json.AuthURL || null,
        // `wanted` false while the apps are off the tailnet: no port answers https, none is asked for
        certificate: {domain: cert.domain, until: cert.until, error: cert.error, held: (cert.context !== null), asked_at: (cert.at === 0) ? null : cert.at, wanted: (app.config.apps.ports !== null)},
        apps_dns: ((dns === null) || (dns === undefined)) ? null : {domain: app.config.apps.domain, port: app.config.apps.dns, address: dns.address()},
        proxy: process.env.TAILNET_PROXY || null,
        calls: tailscale_run.calls(),
    };
}

// tailscale's answer to `status --json`: {here, error, json}, json {} when it gave none
function status_read()
{
    return new Promise(function (resolve) {
        tailscale_run(['status', '--json'], {timeout: TIMEOUT_MS, maxBuffer: 8*1024*1024}, function (error, stdout, stderr) {
            if ((error !== null) && (error.code === 'ENOENT')) {
                resolve({here: false, error: tailscale_run.reason_of(error, stderr), json: {}});
                return;
            }
            // What it printed is read even when it exited with an error
            try {
                resolve({here: true, error: null, json: JSON.parse(String(stdout))});
            }
            catch {
                resolve({here: true, error: (error === null) ? 'tailscale status said no JSON' : tailscale_run.reason_of(error, stderr), json: {}});
            }
        });
    });
}

module.exports = tailscale_view;
