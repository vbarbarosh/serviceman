// What tailscale says when HTTPS is off for the tailnet, the one reason the tailnet's owner mends
// in Tailscale's admin rather than here
const RE_HTTPS_OFF = /does not support getting TLS certs/;
// Where HTTPS is turned on for a tailnet: the DNS page of Tailscale's admin, HTTPS Certificates
const TAILSCALE_DNS_URL = 'https://login.tailscale.com/admin/dns';

// The apps' own ports answering http alone, because tailscale gives no certificate for
// serviceman's tailnet name (tailnet_cert_read): said with tailscale's own reason, what mends
// it, and the page that mends it where there is one. A certificate held whose renewal fails is
// no problem yet: it is used until it ends. It is found and logged however "apps": {"http_said"}
// is set; that decides only where it is said (the page's state, the page of apps).
function problems_of_tailnet_cert(app)
{
    const cert = app.tailnet_cert;
    // With the apps off the tailnet there is no port to answer https on, and nothing missing
    if ((app.config.apps.ports === null) || (cert.context !== null) || (cert.error === null)) {
        return [];
    }
    const off = RE_HTTPS_OFF.test(cert.error);
    // In a few words, for the note beside each app's tailnet link
    const why = off ? 'HTTPS is off for your tailnet' : 'tailscale gives no certificate';
    return [{
        key: 'tailnet_cert',
        kind: 'tailnet',
        remote: null,
        subject: `No https for the apps: ${why}`,
        why,
        cause: `tailscale gives no certificate: ${cert.error}`,
        fix: off
            ? 'Turn HTTPS on for the tailnet: Tailscale\'s admin, the DNS page, HTTPS Certificates, Enable HTTPS (MagicDNS on first). serviceman asks again every 10 minutes, with no restart.'
            : 'serviceman asks tailscale again every 10 minutes; its reason above says what keeps the certificate back.',
        link: off ? {text: 'Turn HTTPS on in Tailscale', href: TAILSCALE_DNS_URL} : null,
        since: null,
    }];
}

module.exports = problems_of_tailnet_cert;
