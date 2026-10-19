const format_seconds = require('../../../helpers/format_seconds');
const http = require('http');
const log_event = require('./log_event');
const service_said = require('./service_said');
const service_tail = require('./service_tail');
const tail_new = require('./tail_new');
const timers = require('timers/promises');

const ATTEMPT_TIMEOUT_MS = 2000;
const INTERVAL_MS = 250;
const PROBE_AGENT = 'serviceman-probe';
const SLOW_AFTER_MS = 10000;

// How often the wait brings the service's own output to whoever is watching it, and how much
// of it. Often enough to look alive, rarely enough not to be a log.
const SAY_EVERY_MS = 3000;
const TAIL_LINES = 10;

// A container that accepts connections is not a service that answers. docker publishes the
// port before the app inside binds it, and a probe that only opens a socket is answered by
// docker itself — so the service is called ready while the first visitor gets a reset.
//
// This asks for a page instead, and waits for an answer. Any answer counts: a 404 or a 500 is
// still something inside speaking HTTP. It goes through the very pool the requests will use,
// so a service on a remote is probed down its own tunnel.
async function wait_http_answer(app, service, instance, upstream, timeout_ms)
{
    try {
        return await wait_answer(app, service, instance, upstream, timeout_ms);
    }
    finally {
        service.state.doing = null;
    }
}

async function wait_answer(app, service, instance, upstream, timeout_ms)
{
    const time0 = Date.now();
    const deadline = time0 + timeout_ms;
    let slow = false;
    // A start that is over in a moment says nothing at all: the first word comes only once
    // the wait has lasted long enough to be worth a word
    let said_at = time0;
    let reason_said = null;
    for (;;) {
        const answer = await ask(instance, upstream);
        if (answer.status !== null) {
            return answer.status;
        }
        if (Date.now() >= deadline) {
            throw new Error(`nothing answered on ${upstream.host}:${upstream.port} — ${answer.reason}${port_hint(service)}`);
        }
        // What is being waited for is the step the page shows, beside its own clock — not a
        // line of the story every few seconds, which would bury what the service itself says.
        // It becomes a line once, and again when the reason changes: a reset turning into a
        // refusal is news, the same refusal for a minute is not.
        service.state.doing = `waiting for an answer on ${upstream.host}:${upstream.port} — ${answer.reason}`;
        if (Date.now() - said_at > SAY_EVERY_MS) {
            said_at = Date.now();
            if (answer.reason !== reason_said) {
                reason_said = answer.reason;
                service_said(app, {service: service.name, text: `waiting for an answer on ${upstream.host}:${upstream.port} — ${answer.reason}`});
            }
            await tail_say(app, service, instance);
        }
        if ((slow === false) && (Date.now() - time0 > SLOW_AFTER_MS)) {
            slow = true;
            log_event(app, 'service_start_slow', {
                service: service.name,
                instance: instance.slot,
                upstream: `${upstream.host}:${upstream.port}`,
                waiting: format_seconds(Date.now() - time0),
                reason: answer.reason,
                hint: port_hint(service).replace(/^ — /, ''),
            });
        }
        await timers.setTimeout(INTERVAL_MS);
    }
}

// The service's own words while it comes up, said once each: the container's log, or the
// output of a program serviceman runs itself
async function tail_say(app, service, instance)
{
    try {
        const lines = await service_tail(app, service, instance, TAIL_LINES);
        for (const line of tail_new(lines, instance.tail_said)) {
            instance.tail_said = line;
            service_said(app, {service: service.name, text: line});
        }
    }
    catch {
        // Whatever holds the output is not answering; the wait itself is what matters here
    }
}

function ask(instance, upstream)
{
    return new Promise(function (resolve) {
        const request = http.request({
            host: upstream.host,
            port: upstream.port,
            method: 'GET',
            path: '/',
            agent: instance.agent,
            headers: {'user-agent': PROBE_AGENT},
        }, function (answer) {
            // The body is nobody's business here, but it has to be read for the socket to
            // go back to the pool the requests will take it from
            answer.resume();
            resolve({status: answer.statusCode, reason: null});
        });
        request.setTimeout(ATTEMPT_TIMEOUT_MS, function () {
            request.destroy();
        });
        request.on('error', function (error) {
            resolve({status: null, reason: error.message});
        });
        request.end();
    });
}

// The one mistake that looks exactly like a slow start
function port_hint(service)
{
    if ((service.port === undefined) || (service.port === null)) {
        return '';
    }
    return ` — is publish.port (${service.port}) the port it listens on inside?`;
}

module.exports = wait_http_answer;
