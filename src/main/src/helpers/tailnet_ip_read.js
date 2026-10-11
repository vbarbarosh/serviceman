const child_process = require('child_process');

const TIMEOUT_MS = 5000;
// A host that is not on the tailnet yet may be in a minute; it is asked again after this long
const RETRY_MS = 60000;

const known = {ip: null, at: 0};

// serviceman's own address on the tailnet, as tailscale in its image says, or null where it
// runs without one. Every remote reaches serviceman's doors there, so a load test of a
// .localhost name is sent to it from any of them.
function tailnet_ip_read()
{
    if ((known.ip !== null) || (Date.now() - known.at < RETRY_MS)) {
        return Promise.resolve(known.ip);
    }
    return new Promise(function (resolve) {
        child_process.execFile('tailscale', ['ip', '-4'], {timeout: TIMEOUT_MS}, function (error, stdout) {
            known.at = Date.now();
            const ip = (error === null) ? stdout.trim().split('\n')[0] : '';
            known.ip = /^[0-9.]+$/.test(ip) ? ip : null;
            resolve(known.ip);
        });
    });
}

module.exports = tailnet_ip_read;
