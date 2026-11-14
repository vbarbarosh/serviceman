const wall_ask = require('./wall_ask');

// The wall a request asks before the service it reaches is touched, and the route it takes:
// the service's own wall, the one it stands behind wherever it is asked, or else the wall a
// door's rule puts in front of the name it came in on. A wall's own pages, its sign-in and its
// callbacks under /auth, are the wall's to answer on any name it stands in front of, with no
// wall in front of them; a service that shares its name with one behind a wall gives its /auth
// to that wall as well, or the one behind it could never be signed in to.
//
//     route      {path, service} as the name routes it, or null
//     door_wall  the name of the wall a door's rule names, or null
//
// Gives {route, wall}, wall the service to ask first, or null.
function wall_route(app, host, pathname, route, door_wall)
{
    const service = (route === null) ? null : route.service;
    const name = wall_name(app, host, pathname, service, door_wall);
    const wall = (name === null) ? null : app.service_by_name[name];
    if ((wall === null) || (wall === undefined)) {
        return {route, wall: null};
    }
    if (wall_ask.own(pathname)) {
        return {route: {path: '', service: wall}, wall: null};
    }
    return {route, wall};
}

function wall_name(app, host, pathname, service, door_wall)
{
    if ((service !== null) && (service.auth !== null) && (service.auth !== undefined)) {
        return service.auth;
    }
    if (door_wall !== null) {
        return door_wall;
    }
    if (wall_ask.own(pathname) === false) {
        return null;
    }
    const walled = (app.routes_exact[host] || []).find(v => (v.service.auth !== null) && (v.service.auth !== undefined));
    return (walled === undefined) ? null : walled.service.auth;
}

module.exports = wall_route;
