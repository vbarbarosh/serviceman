const apt_lane = require('./apt_lane');
const apt_said = require('./apt_said');
const door_peer_known = require('./door_peer_known');
const doors_tell = require('./doors_tell');
const format_bytes = require('@vbarbarosh/node-helpers/src/format_bytes');
const format_duration_ms = require('../../../helpers/format_duration_ms');
const forwards_tell = require('./forwards_tell');
const image_prepull_start = require('./image_prepull_start');
const k6_lane = require('./k6_lane');
const link_read = require('../../../helpers/link_read');
const link_send_message = require('../../../helpers/link_send_message');
const load_test_said = require('./load_test_said');
const log_bind = require('./log_bind');
const log_event = require('./log_event');
const log_line = require('./log_line');
const log_scope = require('./log_scope');
const logline_tell = require('./logline_tell');
const program_ended = require('./program_ended');
const remote_call = require('./remote_call');
const remote_measure = require('./remote_measure');
const remote_services_lost = require('./remote_services_lost');
const remote_services_wake = require('./remote_services_wake');
const remote_tags = require('./remote_tags');
const remotes_update = require('./remotes_update');
const service_probe = require('./service_probe');
const service_said = require('./service_said');
const tags_declared = require('./tags_declared');
const tunnel_inbound = require('./tunnel_inbound');
const tunnel_read = require('./tunnel_read');

const HELLO_TIMEOUT_MS = 10000;
const KEEPALIVE_MS = 30000;

const TUNNEL_KINDS = ['d', 'e', 'x', 'r'];

// Joins a fresh link to its remote and reads what comes over it until it drops. The link says
// what it does in the group of the knock that opened it; nothing new is made for it.
function remote_attach(app, remote, socket, claimed)
{
    return link_join(app, remote, socket, (claimed === undefined) ? [] : claimed);
}

function link_join(app, remote, socket, claimed)
{
    const state = remote.state;
    state.declared = tags_declared(app, remote, claimed);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, KEEPALIVE_MS);
    state.socket = socket;
    state.phase = 'greeting';
    state.address = socket.remoteAddress;
    state.connected_at = Date.now();
    state.last_error = null;
    // A new link is a new story: the groups this machine told us about belong to the old one
    state.groups = new Set();
    link_read(socket, log_bind(function (kind, body) {
        try {
            frame_read(app, remote, kind, body);
        }
        catch (error) {
            link_error(app, remote, {reason: error.message});
            socket.destroy();
        }
    }));
    socket.on('error', function (error) {
        state.last_error = error.message;
    });
    // The machine hung up. A socket taken over from an http upgrade stays half-open when that
    // happens — readable closed, writable still open — so without this the link would read as
    // online until a ping half a minute later said otherwise, and services would be sent to a
    // machine that is already gone.
    socket.on('end', function () {
        socket.destroy();
    });
    socket.on('close', log_bind(function () {
        link_gone(app, remote, socket);
    }));
    const timer = setTimeout(function () {
        if ((state.socket === socket) && (state.phase === 'greeting')) {
            link_error(app, remote, {reason: 'no_hello', within_ms: HELLO_TIMEOUT_MS});
            socket.destroy();
        }
    }, HELLO_TIMEOUT_MS);
    timer.unref();
}

function frame_read(app, remote, kind, body)
{
    // Anything arriving is the machine saying it is there — a beat, an answer, a line of
    // output. This is what the host reads instead of asking.
    remote.state.heard_at = Date.now();
    remote.state.quiet_said = false;
    if (kind === 'o') {
        // The one frame a machine opens a stream with: something knocked at its http socket
        tunnel_inbound(app, remote, body);
        return;
    }
    if (TUNNEL_KINDS.includes(kind)) {
        tunnel_read(remote, kind, body);
        return;
    }
    if (kind === 'b') {
        call_answer(remote, body.readUInt32BE(0), true, {bytes: body.length - 4});
        return;
    }
    if (kind !== 'm') {
        link_error(app, remote, {reason: 'unknown_frame', kind});
        return;
    }
    let message;
    try {
        message = JSON.parse(body.toString('utf8'));
    }
    catch (error) {
        link_error(app, remote, {reason: error.message});
        return;
    }
    message_read(app, remote, message);
}

function message_read(app, remote, message)
{
    const state = remote.state;
    if (message.type === 'beat') {
        // It says nothing but that it is there, which is the whole of what a beat is for. The
        // time it arrived was written down before this, with every other kind of frame. It is
        // answered in kind: the machine hangs up on a link that carries nothing from this end,
        // and a host that never speaks unasked is a host it would never hear.
        link_send_message(state.socket, {type: 'beat'});
        return;
    }
    if (message.type === 'bye') {
        // The machine is going and says why. There is nothing to wait out.
        state.leaving = String(message.reason || 'going');
        log_event(app, 'remote_leaving', {remote: remote.name, reason: state.leaving});
        return;
    }
    if (message.type === 'hello') {
        state.phase = 'online';
        state.heard_at = Date.now();
        state.agent_version = message.agent;
        // Which build of the agent that machine is running, so a refresh can be seen to have
        // happened: the version alone changes far more rarely than the file does
        state.agent_built = (message.built === undefined) ? null : message.built;
        state.resources = message.resources;
        state.stats = message.stats;
        log_event(app, 'remote_online', Object.assign({remote: remote.name, from: state.address, agent: message.agent, tags: remote_tags(remote)}, machine_words(message.resources)));
        remotes_update(app);
        measure_now(app, remote);
        services_wake(app, remote);
        image_prepull_start(app, remote);
        // What it already knows about Logline, as it says; it is told only what differs
        const said = message.resources.logline;
        state.logline_told = ((said === undefined) || (said === null)) ? null : logline_tell.mark(said.logs, said.endpoint, said.token_sha, Array.isArray(said.dirs) ? said.dirs : []);
        state.logline_floor = ((said === undefined) || (said === null)) ? null : said.floor;
        logline_tell(app, remote);
        // The door table it serves, and where its peers reach it — which is every other
        // machine's table changing, so each is told what differs
        const doors = message.resources.doors;
        state.doors_told = ((doors === undefined) || (doors === null)) ? null : doors.version;
        state.doors_peer = ((doors === undefined) || (doors === null) || (doors.peer === null)) ? state.doors_peer : door_peer_known(app, remote.name, doors.peer);
        doors_tell(app);
        // A new link is told its forwards afresh, whatever the last one was told
        state.forwards_told = null;
        state.forwards_error = null;
        forwards_tell(app);
        return;
    }
    if (message.type === 'stats') {
        state.stats = message.stats;
        doors_seen(app, remote, message.stats.doors_seen);
        // What a machine can be asked for is not fixed for the life of a link: a root half
        // installed while it is connected is a machine that can do more than it said at hello
        if (Array.isArray(message.stats.can) && (state.resources !== null)) {
            state.resources.can = message.stats.can;
        }
        return;
    }
    if (message.type === 'reply') {
        call_answer(remote, message.id, message.ok, message.ok ? message.value : message.error);
        return;
    }
    if (message.type === 'log') {
        remote_said(app, remote, message);
        return;
    }
    if (message.type === 'door_started') {
        // Its door woke a service that slept: the container is up, and this end takes it in
        door_adopt(app, String(message.service));
        return;
    }
    if (message.type === 'program_end') {
        // A program of ours stopped by itself over there. The line about it came up the link
        // as every line does; this is the fact, for the restart policy to act on.
        program_ended(app, remote, message);
        return;
    }
    link_error(app, remote, {reason: 'unknown_message', type: String(message.type)});
}

// What the machine said, written here as it was written there — keeping the uid it had, so a
// group is one group on both ends and one grep finds it in either file. It hangs under the
// link it came in on, said once, the first time that group has anything to say here.
function remote_said(app, remote, message)
{
    const text = (typeof message.words === 'string') ? message.words : null;
    const words = ((message.words === null) || (typeof message.words !== 'object')) ? {} : message.words;
    const group = String(message.group);
    if (remote.state.groups.has(group) === false) {
        remote.state.groups.add(group);
        // Where that group hangs here: under the link it came in on. Over there it hangs under
        // whatever caused it on that machine, and that chain is that machine's own business.
        const here = log_scope.getStore();
        log_line(app, group, 'group_spawn', (here === undefined) ? undefined : {parent: here.uid});
    }
    if (message.sender === 'group_spawn') {
        // Said once, above, with the parent this end knows about
        return;
    }
    log_line(app, group, String(message.sender), (text === null) ? Object.assign({remote: remote.name}, words) : text);
    // Its page says why the update did not take the moment the machine knows
    if ((message.sender === 'agent_update_failed') && (typeof words.reason === 'string')) {
        remote.state.update_refused = words.reason;
    }
    if ((message.service === apt_lane) && (text !== null)) {
        apt_said(app, remote, text);
        return;
    }
    if ((typeof message.service === 'string') && message.service.startsWith(k6_lane) && (text !== null)) {
        load_test_said(app, message.service, text);
        return;
    }
    service_said(app, (text === null) ? words : {service: message.service, text});
}

// A request a door carried to a service is work that service did, though it never passed
// through here: the copies on that machine are as busy as the door says, and not stopped as idle
function doors_seen(app, remote, seen)
{
    if ((seen === undefined) || (seen === null)) {
        return;
    }
    const now = Date.now();
    for (const name of Object.keys(seen)) {
        const service = app.service_by_name[name];
        if (service === undefined) {
            continue;
        }
        const at = now - seen[name];
        for (const instance of service.state.instances) {
            if ((instance.remote === remote.name) && ((instance.last_activity_at === null) || (instance.last_activity_at < at))) {
                instance.last_activity_at = at;
            }
        }
        // A door kept it busy while this end thinks it sleeps — woken while serviceman was
        // away, or the word of it lost with a link: it is looked for and taken in
        door_adopt(app, name);
    }
}

// A service a door woke, taken in as one that was found running: the same as at boot, so its
// page says it runs and its idle clock starts now. One that already runs here is left alone.
function door_adopt(app, name)
{
    const service = app.service_by_name[name];
    if ((service === undefined) || service.state.instances.some(v => (v.phase === 'running') || (v.phase === 'starting'))) {
        return;
    }
    service_probe(app, service).catch(function (error) {
        log_event(app, 'service_adopt_error', {service: name, reason: error.message});
    });
}

// Everything that goes wrong on a link says so in one line, written in one place
function link_error(app, remote, words)
{
    log_event(app, 'remote_link_error', Object.assign({remote: remote.name}, words));
}

function call_answer(remote, id, ok, value)
{
    const call = remote.state.calls[id];
    if (call === undefined) {
        return;
    }
    delete remote.state.calls[id];
    clearTimeout(call.timer);
    if (ok) {
        call.resolve(value);
        return;
    }
    call.reject(new Error(`remote ${remote.name}: ${value}`));
}

// A link that drops takes every unanswered call with it; nothing is left waiting for a dead machine
function link_gone(app, remote, socket)
{
    const state = remote.state;
    if (state.socket !== socket) {
        return;
    }
    const held = format_duration_ms(Date.now() - state.connected_at);
    // Why it went, in the machine's own words where it said any, and in this end's words when
    // it stopped talking without a word
    const reason = (state.leaving === null) ? state.gone_reason : `it said it was ${state.leaving}`;
    state.leaving = null;
    state.gone_reason = null;
    state.socket = null;
    state.phase = 'offline';
    state.left_at = Date.now();
    state.latency_ms = null;
    state.throughput_bps = null;
    state.measured_at = null;
    state.declared = [];
    for (const id of Object.keys(state.calls)) {
        const call = state.calls[id];
        delete state.calls[id];
        clearTimeout(call.timer);
        call.reject(new Error(`remote ${remote.name}: the link dropped before the answer came`));
    }
    for (const id of Object.keys(state.streams)) {
        stream_gone(state.streams[id], remote.name);
    }
    state.streams = {};
    log_event(app, 'remote_offline', {remote: remote.name, held, reason: ((reason === null) || (reason === undefined)) ? undefined : reason});
    remote_services_lost(app, remote);
}

// Every request in flight through the link ends where it stands; nothing waits for a dead machine
function stream_gone(found, name)
{
    const dropped = new Error(`the link to remote ${name} dropped`);
    dropped.code = 'ECONNRESET';
    found.tunnel_gone(dropped);
}

function services_wake(app, remote)
{
    const promise = remote_services_wake(app, remote);
    promise.catch(function (error) {
        log_event(app, 'remote_service_error', {remote: remote.name, reason: error.message});
    });
}

function measure_now(app, remote)
{
    const promise = remote_measure(app, remote);
    promise.then(function () {
        log_event(app, 'remote_measure_ok', {remote: remote.name, latency_ms: remote.state.latency_ms, speed: `${format_bytes(remote.state.throughput_bps)}/s`});
    }, function (error) {
        log_event(app, 'remote_measure_error', {remote: remote.name, reason: error.message});
    });
}

// What the machine said it is, for the line that says it is online
function machine_words(resources)
{
    if ((resources === undefined) || (resources === null)) {
        return {said: 'nothing'};
    }
    return {
        machine: resources.hostname,
        cpu: resources.cpu.count,
        ram: format_bytes(resources.mem.total),
        disk_free: format_bytes(resources.disk.free),
        docker: (resources.docker === null) ? 'none' : resources.docker,
    };
}

module.exports = remote_attach;
