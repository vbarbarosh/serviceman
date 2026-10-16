const agent_docker_socket = require('./agent_docker_socket');
const agent_logline_path = require('./agent_logline_path');
const agent_logline_read = require('./agent_logline_read');
const agent_say = require('./agent_say');
const fs = require('fs');
const log_uid = require('../../helpers/log_uid');
const logline_collect = require('./logline_collect');
const logline_files = require('./logline_files');
const logline_ship = require('./logline_ship');
const logline_spool = require('./logline_spool');
const time_utc_nanos = require('./time_utc_nanos');

// How much of the disk the spool may take while Logline cannot be reached: a gigabyte, or a
// tenth of the disk it is on, whichever is less. At that the machine stops reading, and docker
// holds its lines until there is room.
const CAP_BYTES = 1024*1024*1024;
const CAP_SHARE = 0.1;

// Collection on this machine, as its settings say it should be: running from the floor when
// logs are "all", stopped when they are not. Asked when the agent starts — so a machine whose
// serviceman is away collects all the same — and every time serviceman says something new.
// What is in the spool stays through an off, and goes when collection is on again.
const state = {collect: null, files: null, dirs: null, ship: null, spool: null, floor: null, stats: null, group: null, queue: Promise.resolve(), host: null, early: [], decided: false, flush_asked: false};

// The agent's own lines are the machine's too: every one goes into the spool while collection
// runs, as `[group][sender] details` with its time beside, labelled service=serviceman-agent.
// What it says before collection has started — agent_begin after a restart, the first dial —
// waits here, and goes in once it has; a machine switched off lets it go.
const EARLY_LINES = 1000;
const OWN_SERVICE = 'serviceman-agent';

agent_say.sink_set(function (time, tail) {
    if (state.collect !== null) {
        own_keep(time, tail);
        return;
    }
    if ((state.decided === false) && (state.early.length < EARLY_LINES)) {
        state.early.push({time, tail});
    }
});

function agent_logline(options)
{
    state.queue = state.queue.then(() => apply(options)).catch(function (error) {
        agent_say(state.group || log_uid(), 'logline_collect_error', {reason: error.message});
    });
    return state.queue;
}

async function apply(options)
{
    state.host = options.machine;
    const settings = agent_logline_read();
    if ((settings.logs !== 'all') || (settings.floor === null)) {
        stop('switched off');
        state.decided = true;
        state.early = [];
        return;
    }
    const floor = time_utc_nanos(settings.floor);
    if ((state.collect !== null) && (state.floor === floor)) {
        // The same collection; a new endpoint or token is read by the next send, and a new
        // list of folders is watched from now
        if (JSON.stringify(settings.dirs) !== state.dirs) {
            files_start(options, settings);
        }
        state.ship.retry();
        return;
    }
    stop('switched on again');
    const dir = agent_logline_path('spool');
    if (state.spool === null) {
        state.spool = logline_spool(dir, {
            cap_bytes: cap_bytes(dir),
            on_data: function () {
                if (state.ship !== null) {
                    state.ship.wake();
                }
            },
        });
        state.stats = stats_read(dir);
    }
    state.group = log_uid();
    const socket = await agent_docker_socket(options);
    state.floor = floor;
    state.collect = logline_collect({socket, spool: state.spool, floor, host: options.machine, say});
    files_start(options, settings);
    for (const item of state.early) {
        own_keep(item.time, item.tail);
    }
    state.early = [];
    state.decided = true;
    state.ship = logline_ship({spool: state.spool, dir, settings: agent_logline_read, stats: state.stats, say});
    say('logline_collect_begin', {floor: settings.floor, docker: socket, cap: state.spool.stats().cap_bytes, endpoint: settings.endpoint, dirs: settings.dirs.map(v => v.path)});
}

// One of the agent's own lines, into the spool. A burst of them is synced once, right after:
// they cannot be read again from anywhere the way a container's can.
function own_keep(time, tail)
{
    state.spool.append({src: 'agent', at: time, time, labels: {host: state.host, service: OWN_SERVICE}, line: tail});
    if (state.flush_asked === false) {
        state.flush_asked = true;
        setImmediate(function () {
            state.flush_asked = false;
            if (state.spool !== null) {
                state.spool.flush();
            }
        });
    }
}

// The folders the settings name, watched afresh
function files_start(options, settings)
{
    if (state.files !== null) {
        state.files.stop();
    }
    state.dirs = JSON.stringify(settings.dirs);
    state.files = logline_files({spool: state.spool, host: options.machine, dirs: settings.dirs, floor: state.floor, say});
}

// A line in the group of this collection
function say(sender, words)
{
    agent_say(state.group, sender, words);
}

function stop(reason)
{
    if (state.collect === null) {
        return;
    }
    state.collect.stop();
    state.files.stop();
    state.ship.stop();
    state.collect = null;
    state.files = null;
    state.dirs = null;
    state.ship = null;
    state.floor = null;
    agent_say(state.group, 'logline_collect_end', {reason});
}

// For the host's Logs tab: whether it collects, and every number its sending moves
agent_logline.status = function () {
    const stats = state.stats;
    const spool = ((state.spool === null) ? null : state.spool.stats());
    return {
        collecting: state.collect !== null,
        containers: ((state.collect === null) ? 0 : state.collect.containers()),
        files: ((state.files === null) ? 0 : state.files.files()),
        // Folders it could not read, and why: a path that is not there, a folder it may not open
        dir_errors: ((state.files === null) ? {} : state.files.errors()),
        sent: {lines: ((stats === null) ? 0 : stats.sent_lines), batches: ((stats === null) ? 0 : stats.sent_batches), bytes: ((stats === null) ? 0 : stats.sent_bytes)},
        waiting: {lines: ((spool === null) ? 0 : spool.waiting_lines), bytes: ((spool === null) ? 0 : spool.waiting_bytes), oldest: ((spool === null) ? null : spool.oldest_at)},
        // What may wait at most: past it, collecting stops until there is room again
        cap_bytes: ((spool === null) ? null : spool.cap_bytes),
        last_sent_at: ((stats === null) ? null : stats.last_sent_at),
        last_answer: ((stats === null) ? null : stats.last_answer),
    };
};

function cap_bytes(dir)
{
    if (process.env.SERVICEMAN_LOGLINE_CAP) {
        return parseInt(process.env.SERVICEMAN_LOGLINE_CAP, 10);
    }
    try {
        const disk = fs.statfsSync(dir);
        return Math.min(CAP_BYTES, Math.floor(disk.bsize*disk.blocks*CAP_SHARE));
    }
    catch {
        return CAP_BYTES;
    }
}

// What was sent before this process, so the numbers on the page go on from there
function stats_read(dir)
{
    const out = {sent_lines: 0, sent_batches: 0, sent_bytes: 0, last_sent_at: null, last_answer: null, failing: null};
    try {
        Object.assign(out, JSON.parse(fs.readFileSync(`${dir}/stats.json`, 'utf8')));
    }
    catch {
        // No stats yet, or unreadable ones: the numbers start from zero
    }
    return out;
}

module.exports = agent_logline;
