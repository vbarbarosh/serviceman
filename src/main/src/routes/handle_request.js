const client_address = require('../client_address');
const error_detail = require('../error_detail');
const format_seconds = require('../../../helpers/format_seconds');
const fs_host_of = require('../helpers/fs_host_of');
const handle_control_request = require('./handle_control_request');
const inbound_rule = require('../helpers/inbound_rule');
const log_bind = require('../helpers/log_bind');
const log_event = require('../helpers/log_event');
const log_group_from = require('../helpers/log_group_from');
const log_within = require('../helpers/log_within');
const pool_acquire = require('../helpers/pool_acquire');
const pool_release = require('../helpers/pool_release');
const proxy_request = require('../proxy_request');
const render_error_page = require('../helpers/render_error_page');
const render_waiting_page = require('../render_waiting_page');
const route_from_request = require('./route_from_request');
const send_json = require('../helpers/send_json');
const service_ensure_running = require('../helpers/service_ensure_running');
const service_phase = require('../helpers/service_phase');
const service_redir = require('../service_redir');
const socket_pending = require('../helpers/socket_pending');
const timers = require('timers/promises');
const url_logged = require('../helpers/url_logged');
const wall_ask = require('../helpers/wall_ask');
const wants_html = require('../wants_html');

const RESERVED_PREFIX = '/__serviceman__/';
const NO_REFERER = '';
const QUICK_START_MS = 2500;

// The page that asked for this one, and nothing when a visitor came on their own. A browser
// opens several connections at once, so the connection cannot say which page a script or an
// image belongs to; the referer can, and it is written with its query values dropped, like
// every other address in this file.
function referer_logged(req)
{
    const text = req.headers.referer;
    if ((typeof text !== 'string') || (text === '')) {
        return NO_REFERER;
    }
    return url_logged(text);
}

// One request: find the service by hostname, wake it if it sleeps, hand the answer back.
// Everything it causes is written under its own group, so the line that explains a slow page
// sits under the line that asked for it.
function handle_request(app, req, res)
{
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    // A request that came in through a machine's door is answered by the service that machine's
    // door was told to answer this name with, and by nothing else. The door is on a public
    // address and the file mode in front of it only says who may knock; what may be reached
    // through it is said here — the control page never among it.
    let inbound = null;
    let wall = null;
    if (req.socket.tunnel_from !== undefined) {
        const from = app.remote_by_name[req.socket.tunnel_from];
        const rule = (from === undefined) ? null : inbound_rule(from, host);
        // A name with a wall in front of it: the wall's own pages — its sign-in, its callbacks —
        // are answered by the wall on that same name, and everything else is answered by the
        // service once the wall has said the visitor may pass
        const walled = ((rule === null) || (rule.auth === null)) ? null : app.service_by_name[rule.auth] || null;
        const own = (walled !== null) && wall_ask.own(pathname_of(req));
        const named = own ? rule.auth : ((rule === null) ? null : rule.service);
        wall = own ? null : walled;
        inbound = ((rule === null) || rule.off) ? null : app.service_by_name[named] || null;
        if (inbound === null) {
            // A name that is switched off says so, because the answer is the same 404 either
            // way and the difference is the whole of what somebody is looking for
            const off = ((rule !== null) && rule.off) ? {off: true} : {};
            // Async because what answers a request is a promise here, always: the caller
            // hangs its own error handling off the one it gets back
            return log_group_from(req.socket.log_group, async function () {
                log_event(app, 'inbound_refused', Object.assign({remote: req.socket.tunnel_from, host}, off));
                // The visitor learns nothing of which machine this is or why: the log has that
                res.writeHead(404, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
                res.end('404 Not Found\n');
            });
        }
    }
    // The control page, and a machine's files under it — phone.fs.<control host> — are the
    // control's to answer on this door as well; the control decides who may have them
    if ((inbound === null) && (app.config.control.host !== null) && ((host === app.config.control.host) || (fs_host_of(app, req) !== null))) {
        return handle_control_request(app, req, res);
    }
    socket_pending(req.socket, res);
    // The waiting page asks this every couple of seconds for as long as somebody waits. It is
    // the page's own machinery, not a visit: it gets no group and no lines, because a log
    // three quarters made of polls is a log nobody can read.
    if (url_quiet(req.url)) {
        return log_within(req.socket.log_group, () => request_answer(app, req, res, host, true, inbound, wall));
    }
    return log_group_from(req.socket.log_group, () => request_answer(app, req, res, host, false, inbound, wall));
}

// Requests serviceman makes to itself from a page it wrote
function url_quiet(url)
{
    const mark = url.indexOf('?');
    return ((mark === -1) ? url : url.slice(0, mark)).includes(RESERVED_PREFIX);
}

// The path alone, for the questions asked before a request is answered at all
function pathname_of(req)
{
    const mark = req.url.indexOf('?');
    return (mark === -1) ? req.url : req.url.slice(0, mark);
}

// `inbound` is the service a machine's door named for this request, where it came in through
// one — a service answers there because a door says so, not because it publishes the name.
// `wall` is the service that has to say yes before it is answered.
async function request_answer(app, req, res, host, quiet, inbound, wall)
{
    const time0 = Date.now();
    let answered_by = null;
    const who = {from: referer_logged(req), host, ip: client_address(req)};
    if (quiet === false) {
        log_event(app, 'request_begin', `${req.method} ${url_logged(req.url)} ${JSON.stringify(who)}`);
        res.once('close', log_bind(function () {
            // An http status already says what happened, so the line is neither an ok nor an
            // error. The copy that answered is on the end, because for a pool it is the only
            // place that says which one it was.
            const outcome = res.writableEnded ? res.statusCode : 'cut_off';
            const by = (answered_by === null) ? '' : ` ${answered_by}`;
            log_event(app, 'request_end', `${outcome} ${format_seconds(Date.now() - time0)}${by}`);
        }));
    }
    const mark = req.url.indexOf('?');
    const pathname = (mark === -1) ? req.url : req.url.slice(0, mark);
    const query = (mark === -1) ? '' : req.url.slice(mark);
    // An address serviceman keeps for a service, on any hostname it answers on
    if (pathname.startsWith(service_redir.prefix)) {
        answered_by = redir_answer(app, req, res, pathname, query);
        return;
    }

    // Nothing of the service is touched — not woken, not asked, not even named in the log —
    // until the wall has said this visitor may pass
    if ((wall !== undefined) && (wall !== null)) {
        const said = await wall_ask(app, wall, req, host);
        if (said.ok === false) {
            log_event(app, 'wall_refused', {wall: wall.name, host, path: url_logged(pathname)});
            res.writeHead(302, {location: wall_ask.sign_in(req), 'cache-control': 'no-store'});
            res.end();
            answered_by = wall.name;
            return;
        }
        // Who the wall let through, for the service to read. Whatever the visitor claimed under
        // that name is gone: this one is the wall's word.
        req.headers['x-auth-user'] = said.user;
    }
    const route = ((inbound === undefined) || (inbound === null)) ? route_from_request(app, host, pathname) : {path: '', service: inbound};
    if (route === null) {
        render_error_page(res, 404, 'No service answers on this address', `${host || 'the request carries no Host header'}${pathname}`);
        return;
    }
    const service = route.service;
    answered_by = service.name;
    const remainder = pathname.slice(route.path.length);
    if ((remainder || '/').startsWith(RESERVED_PREFIX)) {
        // The waiting page polls this from a visitor's browser: it says whether the service is
        // up, and nothing else about it
        send_json(res, 200, {
            phase: service_phase(service),
            doing: service.state.doing,
            progress: service.state.progress,
            progress_text: service.state.progress_text,
            error: service.state.last_error,
            said: service.state.said,
        });
        return;
    }
    service.state.requests++;
    if (service.strip_prefix) {
        req.url = (remainder || '/') + query;
    }
    if (service_phase(service) !== 'running') {
        const woke = await wake_or_answer(app, service, req, res, route.path);
        if (woke === false) {
            return;
        }
    }
    if (service.redirect !== null) {
        // Woken, and the visitor finishes on the address the service knows itself by. This one
        // is the door: never cached, or a browser would stop knocking and find nobody up.
        res.writeHead(302, {location: `${service.redirect}${req.url}`, 'cache-control': 'no-store'});
        res.end();
        return;
    }
    // The clock of request_timeout starts on an awake service; a cold start is start_timeout's business
    const deadline = (service.policy.request_timeout_ms === null) ? null : Date.now() + service.policy.request_timeout_ms;
    let instance;
    try {
        instance = await pool_acquire(app, service, deadline);
    }
    catch (error) {
        render_error_page(res, error.status || 502, 'The service did not answer in time', error_detail(app, req, error.message), {retry: wants_html(req)});
        return;
    }
    answered_by = `${service.name}#${instance.slot}`;
    res.once('close', function () {
        pool_release(app, service, instance);
    });
    await proxy_request(app, service, instance, req, res, deadline);
}

// `/redir/<uid>/whatever?…` — the visitor is sent to that service's own address with the rest
// of the path and the query, and nothing of what they were carrying is touched.
function redir_answer(app, req, res, pathname, query)
{
    const asked = pathname.slice(service_redir.prefix.length);
    const uid = asked.split('/')[0];
    const service = app.services.find(v => service_redir(v) === `${service_redir.prefix}${uid}`);
    if ((service === undefined) || (service.hosts.length === 0)) {
        render_error_page(res, 404, 'Nothing is kept at this address', pathname);
        return null;
    }
    const rest = asked.slice(uid.length);
    res.writeHead(302, {location: `http://${service.hosts[0].split('/')[0]}${port_asked(req)}${(rest === '') ? '/' : rest}${query}`, 'cache-control': 'no-store'});
    res.end();
    return service.name;
}

// The port this request came in on, as the visitor would write it
function port_asked(req)
{
    const asked = String(req.headers.host || '');
    const at = asked.lastIndexOf(':');
    const named = ((at === -1) || (asked.indexOf(']') > at)) ? '' : asked.slice(at + 1);
    const port = (named === '') ? String(req.socket.localPort || '') : named;
    return ((port === '80') || (port === '')) ? '' : `:${port}`;
}

// What the machine said while it was starting, for whoever is trusted with the reason itself
function said_of(app, req, service)
{
    return (error_detail(app, req, null) === null) ? service.state.said : [];
}

// A cold service: fast starts stay invisible, slow ones show the waiting page to a browser
async function wake_or_answer(app, service, req, res, prefix)
{
    const ready = service_ensure_running(app, service);
    const outcome = await Promise.race([promise_outcome(ready), timers.setTimeout(QUICK_START_MS, 'slow', {ref: false})]);
    if (outcome === 'failed') {
        render_error_page(res, 502, `${service.title} did not start`, error_detail(app, req, service.state.last_error), {retry: wants_html(req), said: said_of(app, req, service)});
        return false;
    }
    if (outcome === 'ready') {
        return true;
    }
    if (wants_html(req)) {
        log_event(app, 'request_wait', {service: service.name, after: format_seconds(QUICK_START_MS)});
        render_waiting_page(app, service, res, prefix);
        return false;
    }
    if (await promise_outcome(ready) === 'failed') {
        render_error_page(res, 502, `${service.title} did not start`, error_detail(app, req, service.state.last_error), {retry: wants_html(req), said: said_of(app, req, service)});
        return false;
    }
    return true;
}

function promise_outcome(promise)
{
    function ready() {
        return 'ready';
    }
    function failed() {
        return 'failed';
    }
    return promise.then(ready, failed);
}

module.exports = handle_request;
