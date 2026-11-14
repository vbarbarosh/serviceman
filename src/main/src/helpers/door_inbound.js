const inbound_rule = require('./inbound_rule');
const route_from_request = require('../routes/route_from_request');
const wall_ask = require('./wall_ask');

// What a request that came in through a machine's door may reach on this host: the service the
// door's rule names for the host it carries, behind the wall the rule names, and nothing else;
// the control page never. The door is on a public address, and the file mode in front of it
// only says who may knock: what may be reached through it is said here, for a request and for
// a websocket handshake alike. A request that came in at this host's own door gets null: it is
// routed by the name it asks for.
//
// Whatever the visitor claimed in x-auth-user is dropped on the way in, at a machine's door and
// at this host's own alike: that header is the wall's word, or nobody's. A service answers on
// its own address too, and there nobody stands in front of it to say who the visitor is.
//
//     {service, wall, off, route}
//     service  the service that answers, or null for a name the door was never given, or one
//              set aside; for a rule of "*", the service whose own address the name is, or null
//              where none has it
//     wall     the service that has to say yes before it is answered, or null; a wall's own
//              pages, its sign-in and its callbacks, are the wall's to answer, with no wall in
//              front of them
//     off      the name is there and set aside
//     route    {path, service} as the request is routed: a rule of "*" keeps the path its
//              service answers on, which the service may take off
//     home     a rule of "*" asked for the apps domain itself, which no service has: the page of
//              its apps answers it (render_apps_page), behind the rule's wall
function door_inbound(app, req, host, pathname)
{
    claim_drop(req);
    if (req.socket.tunnel_from === undefined) {
        return null;
    }
    const from = app.remote_by_name[req.socket.tunnel_from];
    const rule = (from === undefined) ? null : inbound_rule(from, host);
    const walled = ((rule === null) || (rule.auth === null)) ? null : app.service_by_name[rule.auth] || null;
    const own = (walled !== null) && wall_ask.own(pathname);
    const named = own ? rule.auth : ((rule === null) ? null : rule.service);
    if ((named === '*') && (rule.off === false)) {
        const found = route_from_request(app, host, pathname);
        const home = (found === null) && (app.config.apps.domain !== null) && (host === app.config.apps.domain);
        return {service: (found === null) ? null : found.service, wall: walled, off: false, route: found, home};
    }
    const service = ((rule === null) || rule.off) ? null : app.service_by_name[named] || null;
    return {service, wall: own ? null : walled, off: (rule !== null) && rule.off, route: {path: '', service}};
}

// The visitor's own word on who they are, taken out before the request is routed, the wall is
// asked or a header is copied to a service. A stack behind may read `_` and `-` as one (CGI,
// WSGI and PHP do), so x_auth_user goes as x-auth-user does; sent twice or as a list, it is
// one name here and goes whole.
function claim_drop(req)
{
    for (const name of Object.keys(req.headers)) {
        if (name.replace(/_/g, '-') === 'x-auth-user') {
            delete req.headers[name];
        }
    }
}

module.exports = door_inbound;
