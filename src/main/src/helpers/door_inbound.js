const inbound_rule = require('./inbound_rule');
const wall_ask = require('./wall_ask');

// What a request that came in through a machine's door may reach on this host: the service the
// door's rule names for the host it carries, behind the wall the rule names, and nothing else;
// the control page never. The door is on a public address, and the file mode in front of it
// only says who may knock: what may be reached through it is said here, for a request and for
// a websocket handshake alike. A request that came in at this host's own door gets null: it is
// routed by the name it asks for.
//
// Whatever the visitor claimed in x-auth-user is dropped on the way in: that header is the
// wall's word, or nobody's.
//
//     {service, wall, off}
//     service  the service that answers, or null for a name the door was never given, or one
//              set aside
//     wall     the service that has to say yes before it is answered, or null; a wall's own
//              pages, its sign-in and its callbacks, are the wall's to answer, with no wall in
//              front of them
//     off      the name is there and set aside
function door_inbound(app, req, host, pathname)
{
    if (req.socket.tunnel_from === undefined) {
        return null;
    }
    delete req.headers['x-auth-user'];
    const from = app.remote_by_name[req.socket.tunnel_from];
    const rule = (from === undefined) ? null : inbound_rule(from, host);
    const walled = ((rule === null) || (rule.auth === null)) ? null : app.service_by_name[rule.auth] || null;
    const own = (walled !== null) && wall_ask.own(pathname);
    const named = own ? rule.auth : ((rule === null) ? null : rule.service);
    const service = ((rule === null) || rule.off) ? null : app.service_by_name[named] || null;
    return {service, wall: own ? null : walled, off: (rule !== null) && rule.off};
}

module.exports = door_inbound;
