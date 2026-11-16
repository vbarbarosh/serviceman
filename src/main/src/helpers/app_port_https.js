const is_tailnet_address = require('../../../helpers/is_tailnet_address');

// Where a browser that visits an app's own port over http is sent on to, once the port answers
// https too (tailnet_cert_read): the same port and path under the certificate's name,
// https://serviceman.tail1234.ts.net:3402/. Only a page visit (a GET or a HEAD that says it
// would rather have https, as a browser's does) asked by serviceman's tailnet name, its first
// word or its tailnet address: a program's request, a websocket and a name of this computer are
// answered over http as before.
//
//     host   the name the request asked, without its port
//
// Gives null for every request that is answered where it is.
function app_port_https(app, req, host)
{
    const held = app.tailnet_cert;
    if ((req.socket.app_port === undefined) || (req.socket.encrypted === true) || (held.context === null)) {
        return null;
    }
    if ((req.headers['upgrade-insecure-requests'] !== '1') || ((req.method !== 'GET') && (req.method !== 'HEAD'))) {
        return null;
    }
    if ((host !== held.domain) && (host !== held.domain.split('.')[0]) && (is_tailnet_address(host) === false)) {
        return null;
    }
    return `https://${held.domain}:${req.socket.localPort}${req.url}`;
}

module.exports = app_port_https;
