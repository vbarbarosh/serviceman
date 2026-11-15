const wall_route = require('./wall_route');

// A request that came in on an app's own port (app_ports_here) is that app's, whatever name it
// carries: no machine's door, no control page and no other service is reached through it. It
// is behind the wall the app stands behind, whose own pages answer on the port as well, as they
// do on every name the app has.
//
//     req   the request or the websocket handshake; its socket says the port's app
//
// Gives {route, wall} as wall_route does, the route null for an app gone since it came in;
// null for a request that came in on any other door.
function app_port_route(app, req, host, pathname)
{
    const name = req.socket.app_port;
    if (name === undefined) {
        return null;
    }
    const service = app.service_by_name[name];
    const route = (service === undefined) ? null : {path: '', service};
    return wall_route(app, host, pathname, route, null);
}

module.exports = app_port_route;
