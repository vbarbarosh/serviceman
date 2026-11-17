const board_rules = require('./board_rules');
const inbound_rule = require('./inbound_rule');
const route_from_request = require('../routes/route_from_request');
const wall_route = require('./wall_route');

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
//     wall     the service that has to say yes before it is answered, or null: the service's
//              own wall, or else the one the rule names (wall_route); a wall's own pages, its
//              sign-in and its callbacks, are the wall's to answer, with no wall in front of them
//     off      the name is there and set aside
//     route    {path, service} as the request is routed: a rule of "*" keeps the path its
//              service answers on, which the service may take off
//     home     a rule of "*" asked for the apps domain itself, which no service has: the page of
//              its apps answers it (render_apps_page), behind the rule's wall or else the one
//              Apps names
//     board    a board published on that machine, by name, asked at its name under .localhost
//              (board_rules): the page of its apps answers it, home too
function door_inbound(app, req, host, pathname)
{
    claim_drop(req);
    if (req.socket.tunnel_from === undefined) {
        return null;
    }
    const from = app.remote_by_name[req.socket.tunnel_from];
    const rule = (from === undefined) ? null : inbound_rule(board_rules.with_inbound(app, from), host);
    if ((rule === null) || rule.off) {
        return {service: null, wall: null, off: (rule !== null) && rule.off, route: null};
    }
    // A board published on that machine: the page of its apps, behind the wall Apps names, as
    // the page of every app is
    if (rule.board !== undefined) {
        const found = wall_route.apps_page(app, pathname);
        return {service: (found.route === null) ? null : found.route.service, wall: found.wall, off: false, route: found.route, home: true, board: rule.board};
    }
    if (rule.service === '*') {
        let found = wall_route(app, host, pathname, route_from_request(app, host, pathname), rule.auth);
        // The apps domain itself, which no service has: the page of its apps, behind the rule's
        // wall, or else the one Apps names, its sign-in that wall's on the domain
        if ((found.route === null) && (found.wall === null) && (app.config.apps.domain !== null) && (host === app.config.apps.domain)) {
            found = wall_route.apps_page(app, pathname);
        }
        const home = (found.route === null) && (app.config.apps.domain !== null) && (host === app.config.apps.domain);
        return {service: (found.route === null) ? null : found.route.service, wall: found.wall, off: false, route: found.route, home};
    }
    const named = app.service_by_name[rule.service];
    if (named === undefined) {
        return {service: null, wall: null, off: false, route: null};
    }
    const found = wall_route(app, host, pathname, {path: '', service: named}, rule.auth);
    return {service: found.route.service, wall: found.wall, off: false, route: found.route};
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
