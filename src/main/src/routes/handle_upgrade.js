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

// Websocket handshakes wake a sleeping service too, then hand the socket over
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

    const route = route_from_request(app, host, pathname);
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
