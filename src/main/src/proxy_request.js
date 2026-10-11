const agent_reset = require('./helpers/agent_reset');
const error_detail = require('./error_detail');
const format_seconds = require('../../helpers/format_seconds');
const headers_answered = require('./headers_answered');
const headers_forwarded = require('./headers_forwarded');
const http = require('http');
const instance_stopped = require('./helpers/instance_stopped');
const log_bind = require('./helpers/log_bind');
const log_event = require('./helpers/log_event');
const render_error_page = require('./helpers/render_error_page');
const wants_html = require('./wants_html');

const DEAD_UPSTREAM_CODES = ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND'];

// Passes the request to one instance and pipes the answer back
function proxy_request(app, service, instance, req, res, deadline)
{
    return new Promise(function (resolve) {
        let severed = false;
        const upstream = instance.upstream;
        const options = {
            host: upstream.host,
            port: upstream.port,
            method: req.method,
            path: req.url,
            headers: headers_forwarded(req),
            agent: instance.agent,
        };
        let proxy_req;
        try {
            proxy_req = http.request(options, function (proxy_res) {
                proxy_res.on('error', function () {
                    res.destroy();
                });
                res.writeHead(proxy_res.statusCode, headers_answered(proxy_res.headers));
                proxy_res.pipe(res);
            });
        }
        catch (error) {
            // No way to it at all: an external service on a machine whose link is down
            log_event(app, 'upstream_error', {service: service.name, instance: instance.slot, upstream: `${upstream.host}:${upstream.port}`, reason: error.message});
            render_error_page(res, 502, 'The service did not answer', error_detail(app, req, error.message), {retry: wants_html(req)});
            resolve();
            return;
        }
        if (deadline !== null) {
            proxy_req.setTimeout(Math.max(1, deadline - Date.now()), function () {
                log_event(app, 'request_timeout', {service: service.name, instance: instance.slot, limit: format_seconds(service.policy.request_timeout_ms)});
                proxy_req.destroy();
                render_error_page(res, 504, 'The service did not answer in time', `${service.title} took longer than ${Math.round(service.policy.request_timeout_ms/1000)}s`, {retry: wants_html(req)});
            });
        }
        proxy_req.on('error', log_bind(function (error) {
            if (severed || res.writableEnded) {
                resolve();
                return;
            }
            if (DEAD_UPSTREAM_CODES.includes(error.code)) {
                log_event(app, 'upstream_error', {service: service.name, instance: instance.slot, upstream: `${upstream.host}:${upstream.port}`, reason: error.message, hint: port_hint(service, error)});
                instance.last_error = error.message;
                agent_reset(app, service, instance);
                // An external service is not ours to start again, so its address stays what it is
                if (service.type !== 'external') {
                    instance_stopped(instance);
                }
            }
            render_error_page(res, 502, 'The service did not answer', error_detail(app, req, error.message), {retry: wants_html(req)});
            resolve();
        }));
        req.on('aborted', function () {
            severed = true;
            proxy_req.destroy();
        });
        req.on('error', function () {
            severed = true;
            proxy_req.destroy();
        });
        res.once('close', resolve);
        req.pipe(proxy_req);
    });
}

// A connection that is accepted and then dropped means the container runs but nothing
// inside it listens on the configured port — a wrong publish.port looks exactly like this
function port_hint(service, error)
{
    if ((error.code !== 'ECONNRESET') || (service.port === undefined)) {
        return null;
    }
    return `nothing inside answers on port ${service.port}, check publish.port`;
}

module.exports = proxy_request;
