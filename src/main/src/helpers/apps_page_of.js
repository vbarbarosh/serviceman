const app_files_put = require('./app_files_put');

// Which page of apps a name asks for: the one address typed in a browser that shows every app,
// each a cell that opens it the way that browser reaches it. A name a service answers is that
// service's, and is asked of this only when none does.
//
//     domain   the apps domain itself, apps.example.com: each app's name under it
//     here     apps.localhost, beside serviceman.localhost: each app's name on this computer
//     tailnet  serviceman's own name on the tailnet, serviceman.tail1234.ts.net, its first word
//              (serviceman, as MagicDNS takes it) or its tailnet address: each app's own port; none
//              while the apps are off the tailnet ("apps": {"ports": null})
//
//     host     the name asked, lowercase, without its port
//     tailnet  serviceman's own on the tailnet, as tailscale last said: {name, ip}, null each
//              where it runs without one
//
// Gives {way, domain}, domain the apps domain for that way and null for the others; or null for
// a name that is no page of apps.
function apps_page_of(app, host, tailnet)
{
    const domain = app.config.apps.domain;
    if ((domain !== null) && (host === domain)) {
        return {way: 'domain', domain};
    }
    const here = app_files_put.hosts(app, 'apps');
    if (host === here[here.length - 1]) {
        return {way: 'here', domain: null};
    }
    // The apps off the tailnet, with no port of their own there: no page of them there either
    if (app.config.apps.ports === null) {
        return null;
    }
    if ((tailnet.name !== null) && ((host === tailnet.name.toLowerCase()) || (host === tailnet.name.toLowerCase().split('.')[0]))) {
        return {way: 'tailnet', domain: null};
    }
    if ((tailnet.ip !== null) && (host === tailnet.ip)) {
        return {way: 'tailnet', domain: null};
    }
    return null;
}

module.exports = apps_page_of;
