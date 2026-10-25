const door_inbound = require('../helpers/door_inbound');
const format_seconds = require('../../../helpers/format_seconds');
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

// Websocket handshakes wake a sleeping service too, then hand the socket over. One that came
// in through a machine's door is held to the door's rules as a request is: the service the
// rule names, past the wall it names, and nothing else.
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

    const door = door_inbound(app, req, host, pathname);
    if ((door !== null) && (door.service === null)) {
        // The visitor learns nothing of which machine this is or why: the log has that
        log_event(app, 'inbound_refused', Object.assign({remote: req.socket.tunnel_from, host, upgrade: String(req.headers.upgrade || '')}, door.off ? {off: true} : {}));
        socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
        return;
    }
    if ((door !== null) && (door.wall !== null)) {
        // Nothing of the service is touched until the wall has said this visitor may pass; a
        // handshake refused is a 401, since there is no page to send a socket to
        const said = await wall_ask(app, door.wall, req, host);
        if (said.ok === false) {
            log_event(app, 'wall_refused', {wall: door.wall.name, host, path: url_logged(pathname)});
            socket.end('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
            return;
        }
        req.headers['x-auth-user'] = said.user;
    }
    const route = (door === null) ? route_from_request(app, host, pathname) : {path: '', service: door.service};
    if (route === null) {
        socket.destroy();
        return;
    }
    const service = route.service;
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
        instance = await pool_acquire(app, service, deadline);
    }
    catch (error) {
        log_event(app, 'socket_end_error', {service: service.name, reason: error.message});
        socket.destroy();
        return;
    }
    const time0 = Date.now();
    const who = {host, ip: (req.socket.remoteAddress === undefined) ? '' : req.socket.remoteAddress};
    log_event(app, 'socket_begin', `${req.method} ${url_logged(req.url)} ${JSON.stringify(who)} ${service.name}#${instance.slot}`);
    socket.once('close', log_bind(function () {
        pool_release(app, service, instance);
        log_event(app, 'socket_end_ok', `${format_seconds(Date.now() - time0)} ${service.name}#${instance.slot}`);
    }));
    proxy_upgrade(app, service, instance, req, socket, head);
}

module.exports = handle_upgrade;
