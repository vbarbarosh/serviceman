const app_port_route = require('../helpers/app_port_route');
const door_inbound = require('../helpers/door_inbound');
const format_seconds = require('../../../helpers/format_seconds');
const is_localhost_name = require('../helpers/is_localhost_name');
const localhost_name_allowed = require('../helpers/localhost_name_allowed');
const log_bind = require('../helpers/log_bind');
const log_event = require('../helpers/log_event');
const log_group_from = require('../helpers/log_group_from');
const pool_acquire = require('../helpers/pool_acquire');
const pool_release = require('../helpers/pool_release');
const proxy_upgrade = require('../proxy_upgrade');
const route_from_request = require('./route_from_request');
const service_ensure_running = require('../helpers/service_ensure_running');
const service_phase = require('../helpers/service_phase');
const url_logged = require('../helpers/url_logged');
const wall_ask = require('../helpers/wall_ask');
const wall_route = require('../helpers/wall_route');

// Websocket handshakes wake a sleeping service too, then hand the socket over. One that came
// in through a machine's door is held to the door's rules as a request is: the service the
// rule names, past the wall it names, and nothing else; one on an app's own port is that app's;
// one at this host's own door is held to the wall its service stands behind.
function handle_upgrade(app, req, socket, head)
{
    return log_group_from(socket.log_group, () => socket_answer(app, req, socket, head));
}

async function socket_answer(app, req, socket, head)
{
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    const mark = req.url.indexOf('?');
    const pathname = (mark === -1) ? req.url : req.url.slice(0, mark);
    const query = (mark === -1) ? '' : req.url.slice(mark);
    // Until it is joined to a copy a handshake has nothing more to say, so a client that ends
    // its side has hung up. Node closes a request's socket for that and leaves a handshake's
    // half open, with no close to hear: the client would keep its turn in the line and be
    // joined to a copy as if it were still here.
    function hung_up() {
        socket.destroy();
    }
    socket.once('end', hung_up);

    // One that came in on an app's own port is that app's, whatever name it carries
    const own = app_port_route(app, req, host, pathname);
    const door = (own === null) ? door_inbound(app, req, host, pathname) : null;
    if ((door !== null) && (door.service === null)) {
        // The visitor learns nothing of which machine this is or why: the log has that
        log_event(app, 'inbound_refused', Object.assign({remote: req.socket.tunnel_from, host, upgrade: String(req.headers.upgrade || '')}, door.off ? {off: true} : {}));
        socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
        return;
    }
    // A name under .localhost is this computer's own: asked from anywhere else it was typed by
    // hand, and it is no name here
    if ((own === null) && is_localhost_name(host) && (localhost_name_allowed(app, req) === false)) {
        log_event(app, 'localhost_refused', {host, ip: (req.socket.remoteAddress === undefined) ? '' : req.socket.remoteAddress, upgrade: String(req.headers.upgrade || '')});
        socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
        return;
    }
    // A load test's key is serviceman's alone: no service sees it
    delete req.headers[localhost_name_allowed.header];
    const found = found_of(app, host, pathname, own, door);
    if (found.wall !== null) {
        // Nothing of the service is touched until the wall has said this visitor may pass; a
        // handshake refused is a 401, since there is no page to send a socket to
        const said = await wall_ask(app, found.wall, req, host);
        if (said.ok === false) {
            log_event(app, 'wall_refused', {wall: found.wall.name, host, path: url_logged(pathname)});
            socket.end('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
            return;
        }
        req.headers['x-auth-user'] = said.user;
    }
    const route = found.route;
    if (route === null) {
        socket.destroy();
        return;
    }
    const service = route.service;
    if (service.type === 'files') {
        // A folder of files holds no socket to hand over
        socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
        return;
    }
    if (service.strip_prefix) {
        req.url = (pathname.slice(route.path.length) || '/') + query;
    }
    service.state.requests++;
    let instance;
    try {
        if (service_phase(service) !== 'running') {
            await service_ensure_running(app, service);
        }
        const deadline = (service.policy.request_timeout_ms === null) ? null : Date.now() + service.policy.request_timeout_ms;
        instance = await pool_acquire(app, service, deadline, socket);
    }
    catch (error) {
        log_event(app, 'socket_end_error', {service: service.name, reason: error.message});
        socket.destroy();
        return;
    }
    if (instance === null) {
        // The client left while the service was starting, or in the line: nothing is opened to
        // the service for nobody. A handshake says its first line when it is joined to a copy,
        // so this one says none: `connection_end` is where its story ends.
        return;
    }
    if (socket.destroyed) {
        // It left as the place was given. The close below is what gives a place back, and a
        // socket that has closed does not close again: the place goes back here, or never.
        pool_release(app, service, instance);
        return;
    }
    socket.removeListener('end', hung_up);
    const time0 = Date.now();
    const who = {host, ip: (req.socket.remoteAddress === undefined) ? '' : req.socket.remoteAddress};
    log_event(app, 'socket_begin', `${req.method} ${url_logged(req.url)} ${JSON.stringify(who)} ${service.name}#${instance.slot}`);
    socket.once('close', log_bind(function () {
        pool_release(app, service, instance);
        log_event(app, 'socket_end_ok', `${format_seconds(Date.now() - time0)} ${service.name}#${instance.slot}`);
    }));
    proxy_upgrade(app, service, instance, req, socket, head);
}

// Its route and its wall: as an app's own port or a machine's door gave them, and at this
// host's own door as the name routes it, behind the wall its service stands behind
function found_of(app, host, pathname, own, door)
{
    if (own !== null) {
        return own;
    }
    if (door !== null) {
        return {route: door.route, wall: door.wall};
    }
    return wall_route(app, host, pathname, route_from_request(app, host, pathname), null);
}

module.exports = handle_upgrade;
