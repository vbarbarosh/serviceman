const agent_apt = require('./agent_apt');
const agent_built = require('./agent_built');
const agent_dir_create = require('./agent_dir_create');
const agent_disk_list = require('./agent_disk_list');
const agent_disk_usage = require('./agent_disk_usage');
const agent_doors_set = require('./agent_doors_set');
const agent_doors_state = require('./agent_doors_state');
const agent_file_part_finish = require('./agent_file_part_finish');
const agent_file_part_remove = require('./agent_file_part_remove');
const agent_file_part_stat = require('./agent_file_part_stat');
const agent_forwards_set = require('./agent_forwards_set');
const agent_fs_delete = require('./agent_fs_delete');
const agent_fs_list = require('./agent_fs_list');
const agent_fs_rename = require('./agent_fs_rename');
const agent_fs_room = require('./agent_fs_room');
const agent_fs_stat = require('./agent_fs_stat');
const agent_link = require('./agent_link');
const agent_link_create = require('./agent_link_create');
const agent_logline = require('./agent_logline');
const agent_logline_set = require('./agent_logline_set');
const agent_metrics_read = require('./agent_metrics_read');
const agent_metrics_state = require('./agent_metrics_state');
const agent_package_list = require('./agent_package_list');
const agent_port_list = require('./agent_port_list');
const agent_proc_list = require('./agent_proc_list');
const agent_program_docker_start = require('./agent_program_docker_start');
const agent_program_install = require('./agent_program_install');
const agent_program_logs = require('./agent_program_logs');
const agent_program_probe = require('./agent_program_probe');
const agent_program_remove = require('./agent_program_remove');
const agent_program_start = require('./agent_program_start');
const agent_program_step = require('./agent_program_step');
const agent_program_stop = require('./agent_program_stop');
const agent_resources = require('./agent_resources');
const agent_root_current = require('./agent_root_current');
const agent_root_or = require('./agent_root_or');
const agent_say = require('./agent_say');
const agent_screenshot = require('./agent_screenshot');
const agent_secrets_put = require('./agent_secrets_put');
const agent_shell = require('./agent_shell');
const agent_stats = require('./agent_stats');
const agent_term_end = require('./agent_term_end');
const agent_term_list = require('./agent_term_list');
const agent_term_signal = require('./agent_term_signal');
const agent_term_start = require('./agent_term_start');
const agent_tunnel = require('./agent_tunnel');
const agent_ufw = require('./agent_ufw');
const agent_update = require('./agent_update');
const agent_uptime_count = require('./agent_uptime_count');
const agent_uptime_of = require('./agent_uptime_of');
const agent_version = require('../version.json');
const agent_volume_link_safe = require('./agent_volume_link_safe');
const agent_volume_terminals = require('./agent_volume_terminals');
const agent_volumes_link = require('./agent_volumes_link');
const format_seconds = require('../../helpers/format_seconds');
const last_line = require('../../helpers/last_line');
const link_read = require('../../helpers/link_read');
const link_send = require('../../helpers/link_send');
const link_send_message = require('../../helpers/link_send_message');
const log_uid = require('../../helpers/log_uid');
const log_words = require('../../helpers/log_words');
const shell_pty_argv = require('../../helpers/shell_pty_argv');
const shell_stream = require('../../helpers/shell_stream');

const AGENT_VERSION = agent_version.version;
// How often the machine says its numbers again, and what it can be asked for now: servermon's
// last line, which costs a read of a file's end, so the page is never more than a few seconds
// behind. The env name is for a test that cannot wait for a machine to change under it.
const STATS_EVERY_MS = parseInt(process.env.SERVICEMAN_STATS_MS || '5000', 10);
// And how often it says nothing more than "still here". Being alive is the machine's own to
// report: a host that has heard this has no reason to ask anything.
const BEAT_EVERY_MS = parseInt(process.env.SERVICEMAN_BEAT_MS || '10000', 10);
// One clock drives both: every second it looks at what is due and sends it. A tick that
// itself runs half a minute late is a machine that slept, and a link that was slept on is not
// trusted: the fresh dial is the ping the host can see.
const TICK_MS = 1000;
const SLEPT_MS = 30000;
// The host answers every beat with one of its own, so a link that carries nothing from the
// host for this long is not a link: a proxy in front may hold it half-open
// for as long as it likes, and the only way to find out is to hang up and dial again. The env
// name is for a test that cannot wait a minute and a half.
const HOST_GONE_MS = parseInt(process.env.SERVICEMAN_HOST_GONE_MS || '90000', 10);

const TUNNEL_KINDS = ['o', 'd', 'e', 'x', 'r'];
// The days an uptime answer covers at most: as many as uptime.json keeps
const UPTIME_DAYS_MOST = 90;

// What the host asks for every half minute, and every time it measures the link. These would
// bury everything worth reading, so they are done quietly.
const QUIET = ['ping', 'stats', 'metrics', 'uptime', 'resources', 'shell_resize', 'fs_list', 'fs_stat', 'fs_room', 'file_part_stat', 'proc_list', 'port_list', 'disk_list', 'disk_usage', 'package_list', 'term_list'];

// The work worth bracketing: a line that fetches a repo, an image that has to come down, a
// shell line somebody wrote. It takes seconds, so a reader wants to see it start and wait.
// Everything else is done and over before the next line is written, and takes one line.
const SLOW = ['apt_upgrade', 'docker', 'program_install', 'program_step'];

// The whole life of one link: say what this machine is, then do what serviceman asks
// until the link drops
async function agent_serve(options, socket, group, status)
{
    // Listened for before anything is awaited: a link that drops while the hello is being put
    // together would otherwise close unheard, and the agent would wait on a dead link for good
    const closed = new Promise(function (resolve) {
        socket.once('close', resolve);
    });
    socket.on('error', function (error) {
        agent_say(group, 'agent_link_error', {reason: error.message});
    });
    // serviceman hung up: the same half-open socket, and without this the agent would wait for
    // orders that can never come instead of dialling again
    socket.on('end', function () {
        socket.destroy();
    });
    // From here on, everything this agent says is also said to the host
    agent_link(socket);
    const resources = await agent_resources(options);
    link_send_message(socket, {
        type: 'hello',
        agent: AGENT_VERSION,
        built: agent_built,
        resources,
        stats: await agent_stats(options),
    });
    // The stream numbers this machine may open start at 1 and step by two: the host takes the
    // even ones, so neither end ever chooses a number the other is using
    // The programs are the agent's, not the link's: a link that drops and is dialled again
    // finds them as they were. The status file reads the same object the methods write to.
    const state = {link: socket, streams: {}, programs: (status === undefined) ? {} : status.programs, next_stream_id: -1, heard_at: Date.now()};
    // The link's one clock: the beat and the stats go when their time comes. A tick that
    // itself ran half a minute late means the machine slept; the slept-on link is closed and
    // dialled fresh.
    let tick_at = Date.now();
    let beat_at = tick_at + BEAT_EVERY_MS;
    let stats_at = tick_at + STATS_EVERY_MS;
    function tick() {
        const now = Date.now();
        const late = now - tick_at;
        tick_at = now;
        if (late >= SLEPT_MS) {
            agent_say(group, 'agent_woke', {slept: format_seconds(late), then: 'dialling fresh'});
            socket.destroy();
            return;
        }
        if (now - state.heard_at >= HOST_GONE_MS) {
            agent_say(group, 'agent_host_quiet', {silent: format_seconds(now - state.heard_at), then: 'dialling fresh'});
            socket.destroy();
            return;
        }
        if (now >= beat_at) {
            beat_at = now + BEAT_EVERY_MS;
            try {
                link_send_message(socket, {type: 'beat'});
                agent_metrics_state.beat_sent_at = now;
            }
            catch {
                // The link is gone; the close is what says so
            }
        }
        if (now >= stats_at) {
            stats_at = now + STATS_EVERY_MS;
            stats_send(options, socket, group);
        }
    }
    const clock = setInterval(tick, TICK_MS);
    // The way in for whatever stands in front of this machine, open for as long as the link is
    // What the door cannot route itself goes over this link while it is up
    agent_doors_state.link = state;
    link_read(socket, function (kind, body) {
        try {
            frame_read(options, state, kind, body, group);
        }
        catch (error) {
            agent_say(group, 'agent_frame_error', {reason: error.message, then: 'the agent closes the link'});
            socket.destroy();
        }
    });
    await closed;
    agent_link(null);
    clearInterval(clock);
    if (agent_doors_state.link === state) {
        agent_doors_state.link = null;
    }
    streams_drop(state);
}

function frame_read(options, state, kind, body, group)
{
    // Anything arriving is the host saying it is there, whatever else it says
    state.heard_at = Date.now();
    if (TUNNEL_KINDS.includes(kind)) {
        agent_tunnel(state, kind, body);
        return;
    }
    if (kind === 'b') {
        link_send(state.link, 'b', body);
        return;
    }
    if (kind !== 'm') {
        agent_say(group, 'agent_frame_unknown', {kind});
        return;
    }
    const message = JSON.parse(body.toString('utf8'));
    if (message.type === 'beat') {
        // The host's answer to a beat: it is there, and the time it said so is written above.
        // The way there and back is the machine's ping, kept for its charts.
        if (agent_metrics_state.beat_sent_at !== null) {
            agent_metrics_state.pings.push(state.heard_at - agent_metrics_state.beat_sent_at);
            agent_metrics_state.beat_sent_at = null;
        }
        return;
    }
    if (message.type === 'bye') {
        // The host is dropping this link and says so — a machine taken out of the config, a
        // definition that changed. Waiting for the drop to arrive through whatever is in front
        // could take minutes; hanging up now takes none, and the next dial says what is what.
        agent_say(group, 'agent_link_told', {reason: String(message.reason || ''), then: 'dialling fresh'});
        state.link.destroy();
        return;
    }
    if (message.type !== 'call') {
        agent_say(group, 'agent_message_unknown', {type: String(message.type)});
        return;
    }
    call_run(options, state, state.link, message, group);
}

// The link's one clock: the beat and the stats go when their time comes. A tick that itself
// ran half a minute late means the machine slept; the slept-on link is closed and dialled fresh.
function tick(options, state, socket, group)
{
    const now = Date.now();
    const late = now - state.tick_at;
    state.tick_at = now;
    if (late >= SLEPT_MS) {
        agent_say(group, 'agent_woke', {slept: format_seconds(late), then: 'dialling fresh'});
        socket.destroy();
        return;
    }
    if (now >= state.beat_at) {
        state.beat_at = now + BEAT_EVERY_MS;
        try {
            link_send_message(socket, {type: 'beat'});
        }
        catch {
            // The link is gone; the close is what says so
        }
    }
    if (now >= state.stats_at) {
        state.stats_at = now + STATS_EVERY_MS;
        stats_send(options, socket, group);
    }
}

// A link that drops takes every stream through it with it; the sockets on this machine close
function streams_drop(state)
{
    for (const id of Object.keys(state.streams)) {
        state.streams[id].socket.destroy();
    }
    state.streams = {};
}

// One thing the host asked for, and what came of it — so the machine itself says what was done
// to it, not only the host.
//
// Work that takes seconds gets a group of its own under the link, and is bracketed: begin now,
// end when it is over. Work that is done before the next line is written gets one line. A
// group for a single call is a uid that never appears twice, which is no group at all.
function call_run(options, state, socket, message, group)
{
    const time0 = Date.now();
    // A look is a question, not work: the host asks what an install would do before it asks
    // for it to be done, and a question that changes nothing has nothing to say
    const params = ((message.params === undefined) || (message.params === null)) ? {} : message.params;
    // A docker command is loud only when the host names the service somebody is waiting on —
    // a run, a start, a pull. The rest are questions: an inspect, a port, the logs a pane
    // reads every two seconds, and every line those print would be a log of the log.
    const loud = (QUIET.includes(message.method) === false) && (params.look !== true) && ((message.method !== 'docker') || (typeof params.service === 'string'));
    const slow = SLOW.includes(message.method);
    const call = slow ? log_uid() : group;
    if (loud && slow) {
        agent_say(call, 'group_spawn', {parent: group});
        agent_say(call, 'agent_call_begin', Object.assign({method: message.method}, asked_words(message)));
    }
    // Every line a command prints goes out as it is printed, under the group of the call that
    // caused it — a blob at the end is not a log of what happened, it is a receipt
    function say(stream, text) {
        // What the command printed, as it printed it. The sender says which stream it is and
        // the group says which work — repeating the method on every line says nothing new.
        agent_say(call, (stream === 'stdout') ? 'agent_call_stdout' : 'agent_call_stderr', text, params.service);
    }
    const promise = method_run(options, state, message.method, message.params, loud ? say : undefined, call);
    promise.then(function (value) {
        if (loud) {
            // A command that failed is a value here, not an exception — so the answer decides
            // which line this is. `ok=true` beside a sender that already says ok is nothing.
            const failed = (value !== null) && (value !== undefined) && (value.ok === false);
            agent_say(call, sender_of(slow, failed), end_words(message, value, slow, failed, Date.now() - time0));
        }
        link_send_message(socket, {type: 'reply', id: message.id, ok: true, value});
    }, function (error) {
        const words = slow
            ? `${format_seconds(Date.now() - time0)} ${error.message}`
            : Object.assign({method: message.method}, asked_words(message), {reason: error.message, took: format_seconds(Date.now() - time0)});
        agent_say(call, slow ? 'agent_call_end_error' : 'agent_call_error', words);
        link_send_message(socket, {type: 'reply', id: message.id, ok: false, error: error.message});
    });
}

// The line that ends a piece of work says what came of it and how long it took, and nothing
// that the line which began it already said: the group is the same, so the method, the machine
// and the command are all one line up.
function end_words(message, value, slow, failed, ms)
{
    const time = format_seconds(ms);
    if (slow === false) {
        return Object.assign(
            {method: message.method},
            asked_words(message),
            answered_words(message, value),
            failed ? {reason: failed_reason(value)} : {},
            {took: time}
        );
    }
    const answered = log_words(answered_words(message, value));
    const said = [time, answered, failed ? failed_reason(value) : ''].filter(v => v !== '');
    return said.join(' ');
}

// A refusal says its reason in words; a command that failed said it on stderr
function failed_reason(value)
{
    return (typeof value.error === 'string') ? value.error : last_line(value.stderr);
}

function sender_of(slow, failed)
{
    if (slow) {
        return failed ? 'agent_call_end_error' : 'agent_call_end_ok';
    }
    return failed ? 'agent_call_error' : 'agent_call_ok';
}

// The part of the question worth reading back: what was run, where, and for which service
function asked_words(message)
{
    const params = ((message.params === undefined) || (message.params === null)) ? {} : message.params;
    if (message.method === 'docker') {
        return {argv: (params.argv === undefined) ? '' : params.argv.join(' ')};
    }
    if (message.method === 'dir_create') {
        return {path: params.path};
    }
    if (message.method === 'fs_rename') {
        return {from: params.from, to: params.to};
    }
    if (message.method === 'fs_delete') {
        return {path: params.path};
    }
    if (message.method === 'link_create') {
        return {path: params.path, target: params.target};
    }
    if ((message.method === 'file_part_finish') || (message.method === 'file_part_remove')) {
        return {dir: params.dir, name: params.name, id: params.id};
    }
    if (message.method === 'program_step') {
        return {cwd: params.cwd, line: params.line};
    }
    if (message.method === 'program_install') {
        return {cwd: params.cwd, line: params.install};
    }
    if (message.method === 'program_start') {
        return {service: params.name, slot: params.slot, cwd: params.cwd, argv: (params.argv === undefined) ? '' : params.argv.join(' ')};
    }
    if ((message.method === 'program_stop') || (message.method === 'program_probe')) {
        return {service: params.name, slot: params.slot};
    }
    if (message.method === 'program_remove') {
        return {cwd: params.cwd};
    }
    if (message.method === 'term_create') {
        // The variables' names, never their values
        const out = {name: params.name};
        if (typeof params.cwd === 'string') {
            out.cwd = params.cwd;
        }
        if ((params.env !== undefined) && (params.env !== null)) {
            out.env = Object.keys(params.env).join(' ');
        }
        return out;
    }
    if (message.method === 'volume') {
        // Never the key
        return {action: params.action, name: params.name};
    }
    return {};
}

// And the part of the answer worth reading back
function answered_words(message, value)
{
    const answer = ((value === undefined) || (value === null)) ? {} : value;
    if (message.method === 'program_start') {
        return {pid: answer.pid, started: answer.started};
    }
    if (message.method === 'program_install') {
        return {step: answer.step};
    }
    if (message.method === 'program_remove') {
        return {removed: answer.removed};
    }
    if (message.method === 'program_probe') {
        return {running: answer.running};
    }
    return {};
}

async function method_run(options, state, method, params, say, group)
{
    if (method === 'ping') {
        return {at: Date.now()};
    }
    if (method === 'stats') {
        return await agent_stats(options);
    }
    if (method === 'metrics') {
        return agent_metrics_read(params);
    }
    if (method === 'uptime') {
        return await uptime_read(params, group);
    }
    if (method === 'resources') {
        return await agent_resources(options);
    }
    if (method === 'docker') {
        const line = [options.docker].concat(params.argv);
        // A pull the host is showing to somebody: docker only draws its progress for a
        // terminal, so it is given one
        return await shell_stream((params.pty === true) ? shell_pty_argv(line) : line, {}, say);
    }
    if (method === 'dir_create') {
        return await agent_dir_create(params.path, params.root);
    }
    if (method === 'fs_list') {
        return await agent_fs_list(params.path, params.root);
    }
    if (method === 'proc_list') {
        return await agent_proc_list();
    }
    if (method === 'disk_list') {
        return await agent_disk_list();
    }
    if (method === 'disk_usage') {
        return await agent_disk_usage(params, options);
    }
    if (method === 'package_list') {
        return await agent_package_list(options);
    }
    if (method === 'port_list') {
        // Read as root where this machine has a root half, because that is the difference
        // between a port with a name beside it and a port with an empty column; asked here,
        // as the agent's own user, where it has none
        let rooted = true;
        const out = await agent_root_or(options, 'port_list', {}, undefined, function () {
            rooted = false;
            return agent_port_list();
        });
        // Read as root, the same command by hand needs sudo to name the same processes
        if (rooted && Array.isArray(out.commands)) {
            out.commands = out.commands.map(v => `sudo ${v}`);
        }
        return out;
    }
    if (method === 'fs_rename') {
        return await agent_fs_rename(params);
    }
    if (method === 'fs_stat') {
        return await agent_fs_stat(params);
    }
    if (method === 'fs_room') {
        return await agent_fs_room(params);
    }
    if (method === 'fs_delete') {
        return await agent_fs_delete(params);
    }
    if (method === 'file_part_stat') {
        return await agent_file_part_stat(params);
    }
    if (method === 'file_part_finish') {
        return await agent_file_part_finish(params);
    }
    if (method === 'file_part_remove') {
        return await agent_file_part_remove(params);
    }
    if (method === 'link_create') {
        return await agent_link_create(params);
    }
    if (method === 'screenshot') {
        return await agent_screenshot(options);
    }
    if (method === 'term_list') {
        return await agent_term_list();
    }
    if (method === 'term_end') {
        return await agent_term_end(params);
    }
    if (method === 'term_create') {
        return await agent_term_start(params.name, params.cols || 80, params.rows || 24, params.env, params.cwd);
    }
    if (method === 'term_signal') {
        return await agent_term_signal(params);
    }
    if (method === 'apt_upgrade') {
        // The root half of this machine does it where there is one; here, with sudo, where
        // there is not
        return await agent_root_or(options, 'apt_upgrade', {}, say, () => agent_apt(state, options, say));
    }
    if (method === 'apt_cancel') {
        return await agent_root_or(options, 'apt_cancel', {}, undefined, () => agent_apt.cancel(state));
    }
    if (method === 'ufw') {
        // The firewall is root's: the root half runs ufw where there is one, and here it is
        // sudo -n ufw, which answers only where a sudoers line lets it
        return await agent_root_or(options, 'ufw', {argv: params.argv}, undefined, function (why) {
            // A root half older than ufw is one update away, not missing: sudo here would only
            // ask for a password, and the page would say to install what is already there
            if (why.root_old === true) {
                throw new Error('the root half on this machine is from before the firewall; it updates itself within half a minute — read again then');
            }
            return agent_ufw(options, params);
        });
    }
    if (method === 'volume') {
        // Encrypted volumes are root's alone: no sudo here, since cryptsetup and mount behind
        // a sudoers line would be root by another name
        if ((typeof params.key === 'string') && (agent_volume_link_safe(options.url, state.link.remoteAddress) === false)) {
            return {ok: false, status: 403, code: 'key_not_safe', error: `a key does not travel over ${options.url}: plain http; dial serviceman over https, a tunnel or a socket file`};
        }
        const answer = await agent_root_or(options, 'volume', params, say, function (why) {
            if (why.root_old === true) {
                return {ok: false, status: 503, error: 'the root half on this machine is from before volumes; it updates itself within half a minute — ask again then'};
            }
            return {ok: false, status: 501, error: 'volumes need the root agent on this machine; its page says how to install it'};
        });
        agent_volumes_link(options);
        return agent_volume_terminals(answer);
    }
    if (method === 'shell_resize') {
        const found = state.streams[params.id];
        if ((found !== undefined) && (typeof found.socket.resize === 'function')) {
            found.socket.resize(params.cols, params.rows);
        }
        return {};
    }
    if (method === 'program_install') {
        return await agent_program_install(options, params, say);
    }
    if (method === 'program_remove') {
        return await agent_program_remove(params);
    }
    if (method === 'program_step') {
        return await agent_program_step(options, params, say);
    }
    if (method === 'secrets_put') {
        return agent_secrets_put(params);
    }
    if (method === 'program_docker_start') {
        return await agent_program_docker_start(options, params, say);
    }
    if (method === 'program_start') {
        return agent_program_start(state, params, group);
    }
    if (method === 'program_stop') {
        return await agent_program_stop(state, params, group);
    }
    if (method === 'doors_set') {
        return agent_doors_set(params.table);
    }
    if (method === 'forwards_set') {
        return await agent_forwards_set(params.forwards, group);
    }
    if (method === 'logline_set') {
        const settings = agent_logline_set(params);
        // Collection follows the new word at once; it does not wait for the answer to leave
        agent_logline(options);
        return settings;
    }
    if (method === 'update') {
        return agent_update(params, group);
    }
    if (method === 'program_logs') {
        return agent_program_logs(state, params);
    }
    if (method === 'program_probe') {
        return agent_program_probe(state, params);
    }
    throw new Error(`this agent knows nothing called ${JSON.stringify(String(method))}`);
}

function stats_send(options, socket, group)
{
    // The same beat carries the one thing the root half cannot notice by itself: that the file
    // it runs from has been replaced
    agent_root_current(options, group).catch(function (error) {
        agent_say(group, 'root_update_error', {reason: error.message});
    });
    const promise = agent_stats(options);
    promise.then(function (stats) {
        link_send_message(socket, {type: 'stats', stats});
    }, function (error) {
        agent_say(group, 'agent_stats_error', {reason: error.message});
    });
}

// The machine's uptime by day: the lines since the last count are counted first, so today
// reaches the moment it was asked
async function uptime_read(params, group)
{
    const days = parseInt(params.days, 10);
    if ((Number.isInteger(days) === false) || (days < 1) || (days > UPTIME_DAYS_MOST)) {
        throw new Error(`days is a whole number from 1 to ${UPTIME_DAYS_MOST}`);
    }
    await agent_uptime_count(group);
    return agent_uptime_of(days, Date.now());
}

module.exports = agent_serve;
