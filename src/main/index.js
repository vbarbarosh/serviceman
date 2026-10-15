#!/usr/bin/env node

const app_from_config = require('./src/helpers/app_from_config');
const cli = require('@vbarbarosh/node-helpers/src/cli');
const config = require('../../config');
const counters_apply = require('./src/helpers/counters_apply');
const counters_read = require('./src/helpers/counters_read');
const counters_write = require('./src/helpers/counters_write');
const doors_tell = require('./src/helpers/doors_tell');
const file_log_from_env = require('./src/helpers/file_log_from_env');
const forward_totals_apply = require('./src/helpers/forward_totals_apply');
const forward_totals_read = require('./src/helpers/forward_totals_read');
const forward_totals_write = require('./src/helpers/forward_totals_write');
const forwards_sample = require('./src/helpers/forwards_sample');
const forwards_tell = require('./src/helpers/forwards_tell');
const image_prepull_start = require('./src/helpers/image_prepull_start');
const log_close = require('./src/helpers/log_close');
const log_event = require('./src/helpers/log_event');
const log_stdout_time_from_env = require('./src/helpers/log_stdout_time_from_env');
const log_trunk = require('./src/helpers/log_trunk');
const log_within = require('./src/helpers/log_within');
const logline_sweep = require('./src/helpers/logline_sweep');
const path = require('path');
const profile_from_db = require('./src/helpers/profile_from_db');
const reap_idle = require('./src/helpers/reap_idle');
const remote_tags = require('./src/helpers/remote_tags');
const remotes_measure = require('./src/helpers/remotes_measure');
const remotes_update = require('./src/helpers/remotes_update');
const server_start = require('./src/helpers/server_start');
const service_ensure_running = require('./src/helpers/service_ensure_running');
const service_phase = require('./src/helpers/service_phase');
const service_probe = require('./src/helpers/service_probe');
const service_stop = require('./src/helpers/service_stop');
const service_waits_for_remote = require('./src/helpers/service_waits_for_remote');

const UPDATE_INTERVAL_MS = 60000;
// How often the quiet ones are looked at. A machine that is talking costs nothing here, so
// this can be often enough to matter without being a poll.
const MEASURE_INTERVAL_MS = 10000;
const REAP_INTERVAL_MS = 5000;
// How often the counters go to disk, when they moved; a crash loses at most this much of them
const COUNTERS_INTERVAL_MS = 5000;
// The forwards' speeds are sampled every second; what they carried goes to disk less often,
// since bytes move all the time a forward is busy
const FORWARDS_SAMPLE_INTERVAL_MS = 1000;
const FORWARD_TOTALS_INTERVAL_MS = 30000;
// How soon a machine hears about Logline again after the telling failed — Logline away, a
// token that could not be issued — and a token that could not be taken back is tried again
const LOGLINE_INTERVAL_MS = 60000;

const USAGE = `serviceman [serviceman.json] [--check]

Serves services by hostname, starts them on the first request, stops them when idle.

  serviceman.json    the config to run (default: $SERVICEMAN_CONFIG or ./serviceman.json)
  --check         read the config, report what is wrong, exit
`;

// SIGUSR2 is the one nodemon sends before it starts the next copy, so a watched serviceman
// stops the way an asked one does instead of being killed where it stands
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

cli(main, v => console.error(`serviceman: ${v.message}`));

async function main()
{
    const argv = process.argv.slice(2);
    if (argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    const db_path = path.resolve(db_path_from_argv(argv));
    const profile = await profile_from_db(db_path, config);
    if (argv.includes('--check')) {
        console.log(`${db_path}: ${profile.services.length} services, the config reads fine`);
        return;
    }
    const app = app_from_config(profile);
    app.file_log = file_log_from_env(process.env, profile.base_dir);
    app.log_stdout_time = log_stdout_time_from_env(process.env);
    // Everything the process ever writes happens inside this group: the boot itself, and
    // every group made later, which says this one as its parent
    await log_trunk(app, async function () {
        const servers = await server_start(app);
        log_event(app, 'serviceman_begin', {config: db_path, services: profile.services.length, remotes: profile.remotes.length});
        announce(app, servers);
        // What the last serviceman counted, before the probe finds what it left running
        const saved = counters_read(app);
        for (const service of app.services) {
            counters_apply(service, saved[service.name]);
        }
        forward_totals_apply(app, forward_totals_read(app));
        await probe_all(app);
        start_always(app);
        image_prepull_start(app);
        // The timers are made here, so what a policy causes is a child of the process and
        // not of the request that happened to be in flight when the clock struck
        setInterval(function () {
            reap_idle(app);
        }, REAP_INTERVAL_MS);
        setInterval(function () {
            remotes_measure(app);
        }, MEASURE_INTERVAL_MS);
        setInterval(function () {
            counters_save(app);
        }, COUNTERS_INTERVAL_MS);
        setInterval(function () {
            forwards_sample(app, Date.now());
        }, FORWARDS_SAMPLE_INTERVAL_MS);
        setInterval(function () {
            forward_totals_save(app);
        }, FORWARD_TOTALS_INTERVAL_MS);
        // A machine that has been connected for a week hears about a newer agent too
        setInterval(function () {
            remotes_update(app);
        }, UPDATE_INTERVAL_MS);
        setInterval(function () {
            logline_sweep(app).catch(function (error) {
                log_event(app, 'logline_sweep_error', {reason: error.message});
            });
            // Where a service runs moves as it starts and stops; the doors follow within the minute
            doors_tell(app);
            // A forward that could not listen is tried again
            forwards_tell(app);
        }, LOGLINE_INTERVAL_MS);
        watch_signals(app);
    });
}

function db_path_from_argv(argv)
{
    for (const item of argv) {
        if (item.startsWith('--') === false) {
            return item;
        }
    }
    return process.env.SERVICEMAN_CONFIG || 'serviceman.json';
}

function announce(app, servers)
{
    log_event(app, 'serviceman_listen', {
        address: `${app.config.listen.host}:${servers.server.address().port}`,
        socket: app.config.listen.socket,
    });
    for (const service of app.services) {
        log_event(app, 'serviceman_route', {
            host: service.hosts,
            service: service.name,
            type: service.type,
            remotes: service.remotes,
            policy: policy_text(service),
        });
    }
    log_event(app, 'serviceman_control', {
        host: app.config.control.host,
        address: ((servers.control === null) ? null : `${app.config.control.bind}:${servers.control.address().port}`),
        socket: ((servers.socket === null) ? null : app.config.control.socket),
    });

    for (const remote of app.remotes) {
        log_event(app, 'serviceman_remote', {remote: remote.name, door: '/api/v1/remote, with its token'});
    }
    announce_tags(app);
    announce_reach(app);
    if (app.file_log !== null) {
        log_event(app, 'serviceman_log', {dir: app.file_log.dir});
    }
}

// A service may ask for a kind of machine that nothing answers yet — a machine that declares
// the tag has not connected, or never will because the tag is a typo. Both look the same to
// serviceman, and both are worth one line at the start.
function announce_tags(app)
{
    const said = [];
    for (const service of app.services) {
        for (const name of service.remotes.filter(v => v.startsWith('#'))) {
            const tag = name.slice(1);
            if (said.includes(tag) || app.remotes.some(v => remote_tags(v).includes(tag))) {
                continue;
            }
            said.push(tag);
            log_event(app, 'serviceman_tag_nowhere', {tag, service: service.name});
        }
    }
}

// The control page reads the config, edits it, opens shells inside containers and holds the
// remote tokens, and it asks for no password. What can reach it is said out loud, at the start.
function announce_reach(app)
{
    if (app.config.control.exposed) {
        log_event(app, 'serviceman_exposed', {control: 'anyone who reaches it', password: 'none', wall: 'yours to put in front'});
        return;
    }
    if (open_to_all(app.config.control.bind) || open_to_all(app.config.listen.host)) {
        log_event(app, 'serviceman_closed', {control: 'this machine only'});
    }
}

function open_to_all(host)
{
    return ['127.0.0.1', 'localhost', '::1'].includes(host) === false;
}

async function probe_all(app)
{
    for (const service of app.services) {
        await service_probe(app, service);
    }
}

function start_always(app)
{
    for (const service of app.services) {
        if (service.policy.start !== 'always') {
            continue;
        }
        if (service_waits_for_remote(app, service)) {
            // It starts when its remote dials in, not before
            continue;
        }
        if (service_phase(service) === 'running') {
            continue;
        }
        const promise = service_ensure_running(app, service);
        promise.catch(function () {
            // instance_start wrote why it failed; this catch only keeps the rejection quiet
        });
    }
}

function policy_text(service)
{
    if (service.redirect !== null) {
        const idle = ((service.policy.stop_after_idle_ms === null) ? 'stays up' : `sleeps ${Math.round(service.policy.stop_after_idle_ms/1000)}s after the last one`);
        return `wakes it, then sends the visitor to ${service.redirect} — ${idle}`;
    }
    if ((service.type === 'shell') && (service.port === null)) {
        return `always on, restart ${service.policy.restart}`;
    }
    if (service.policy.start === 'always') {
        return 'always on';
    }
    const pool = ((service.policy.instances.max === 1) ? '' : `, up to ${service.policy.instances.max} instances`);
    if (service.policy.stop_after_idle_ms === null) {
        return `on demand, stays up${pool}`;
    }
    return `on demand, sleeps after ${Math.round(service.policy.stop_after_idle_ms/1000)}s idle${pool}`;
}

function watch_signals(app)
{
    let leaving = false;
    function bye(signal) {
        if (leaving) {
            // The second signal is an order, not a request: this end stops where it stands
            process.exit(1);
            return;
        }
        leaving = true;
        // The end of the process belongs to the group the start of it is in
        log_within(app.log_group, function () {
            const promise = stop_programs(app);
            promise.then(function () {
                counters_save(app);
                forward_totals_save(app);
                log_event(app, 'serviceman_end_ok', {signal, containers: 'left running'});
                leave(app);
            }, function (error) {
                counters_save(app);
                forward_totals_save(app);
                log_event(app, 'serviceman_end_error', {signal, reason: error.message});
                leave(app);
            });
        });
    }
    for (const signal of SIGNALS) {
        process.on(signal, function () {
            bye(signal);
        });
    }
}

// A disk that is full or read-only costs the counters, not the process
function counters_save(app)
{
    try {
        counters_write(app);
    }
    catch (error) {
        log_event(app, 'counters_write_error', {reason: error.message});
    }
}

// The same for what the forwards carried
function forward_totals_save(app)
{
    try {
        forward_totals_write(app);
    }
    catch (error) {
        log_event(app, 'forward_totals_write_error', {reason: error.message});
    }
}

// The last thing this process does: what was written is on disk before it goes
async function leave(app)
{
    await log_close(app);
    process.exit(0);
}

// Programs stop with serviceman. One that outlives it — a kill, a crash, a second signal —
// is taken back at the next start instead of being fought for its port
async function stop_programs(app)
{
    const stops = [];
    for (const service of app.services) {
        if ((service.type !== 'shell') || (service_phase(service) === 'stopped')) {
            continue;
        }
        stops.push(service_stop(app, service, 'serviceman stops'));
    }
    await Promise.all(stops).catch(function () {});
}
