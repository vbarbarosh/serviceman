const link_send_stream = require('../../../helpers/link_send_stream');
const log_event = require('./log_event');
const tunnel_open = require('./tunnel_open');
const tunnel_stream = require('./tunnel_stream');

// Something connected to a forward's `to` on the machine that carried it here: a stream to its
// `from`, where the service is, is opened, and the two are joined, byte for byte, until either
// end closes. A stream that cannot be joined is refused at once with the reason, and the
// connection over there closes.
//
// Only the forward's own `to` machine may open it, and only while the forward is on: a machine
// that names somebody else's forward is asking this host to dial for it.
function forward_join(app, remote, id, name)
{
    const state = remote.state;
    const forward = app.config.forwards.find(v => v.name === name);
    if ((forward === undefined) || (forward.off) || (forward.to.remote !== remote.name)) {
        refuse(state, id, 'EBADTARGET', `${remote.name} has no forward named ${name}`);
        return;
    }
    const counts = forward_counts(app, name);
    const from = app.remote_by_name[forward.from.remote];
    let far;
    try {
        far = tunnel_open(from, ((forward.from.socket === null) ? {host: ((forward.from.host === null) ? '127.0.0.1' : forward.from.host), port: forward.from.port} : {path: forward.from.socket}));
    }
    catch (error) {
        refuse(state, id, 'EHOSTDOWN', error.message);
        failed(app, counts, name, `${forward.from.remote} is offline`);
        return;
    }
    const near = tunnel_stream(state.socket, id, true);
    state.streams[id] = near;
    near.id = id;
    near.on('close', function () {
        delete state.streams[id];
    });
    counts.open++;
    counts.total++;
    near.on('data', function (chunk) {
        counts.bytes_sent += chunk.length;
    });
    far.on('data', function (chunk) {
        counts.bytes_back += chunk.length;
    });
    // The far end refused or broke: the near one goes with the reason, and the reason is kept
    far.on('error', function (error) {
        failed(app, counts, name, `${forward.from.remote}: ${error.message}`);
        near.destroy(error);
    });
    near.on('error', function (error) {
        far.destroy(error);
    });
    let closed = 0;
    function close() {
        closed++;
        if (closed === 2) {
            counts.open--;
        }
    }
    near.on('close', close);
    far.on('close', close);
    near.pipe(far);
    far.pipe(near);
}

// What went through one forward, sent to the service and back, by name so that an edited
// forward goes on counting; forward_totals_apply and forwards_sample fill in the rest
function forward_counts(app, name)
{
    if (app.forward_counts[name] === undefined) {
        app.forward_counts[name] = {
            open: 0,
            total: 0,
            bytes_sent: 0,
            bytes_back: 0,
            error: null,
            error_at: null,
            speed_sent: 0,
            speed_back: 0,
            history_sent: [],
            history_back: [],
            samples: [],
            bucket: null,
        };
    }
    return app.forward_counts[name];
}

// The last failure is shown until the next one; the log has it once per reason in a row
function failed(app, counts, name, reason)
{
    if (counts.error !== reason) {
        log_event(app, 'forward_error', {forward: name, reason});
    }
    counts.error = reason;
    counts.error_at = Date.now();
}

function refuse(state, id, code, message)
{
    link_send_stream(state.socket, 'x', id, Buffer.from(JSON.stringify({code, message})));
}

forward_join.counts = forward_counts;

module.exports = forward_join;
