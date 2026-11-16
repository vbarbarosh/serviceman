// What tailscale says when HTTPS is off for the tailnet, the one reason the tailnet's owner mends
// in Tailscale's admin rather than here
const RE_HTTPS_OFF = /does not support getting TLS certs/;

// The apps' own ports answering http alone, because tailscale gives no certificate for
// serviceman's tailnet name (tailnet_cert_read): said with tailscale's own reason and what
// mends it. A certificate held whose renewal fails is no problem yet: it is used until it ends.
function problems_of_tailnet_cert(app)
{
    const cert = app.tailnet_cert;
    if ((cert.context !== null) || (cert.error === null)) {
        return [];
    }
    return [{
        key: 'tailnet_cert',
        kind: 'tailnet',
        remote: null,
        subject: 'The apps\' own ports answer http, not https',
        cause: `tailscale gives no certificate: ${cert.error}`,
        fix: RE_HTTPS_OFF.test(cert.error)
            ? 'Turn HTTPS on for the tailnet: Tailscale\'s admin, the DNS page, HTTPS Certificates, Enable HTTPS (MagicDNS on first). serviceman asks again every 10 minutes, with no restart.'
            : 'serviceman asks tailscale again every 10 minutes; its reason above says what keeps the certificate back.',
        since: null,
    }];
}

module.exports = problems_of_tailnet_cert;
