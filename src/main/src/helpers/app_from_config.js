const app_routes_rebuild = require('./app_routes_rebuild');
const externals_attach = require('./externals_attach');
const load_test_runs_read = require('./load_test_runs_read');
const own_container_id = require('./own_container_id');
const remote_state = require('./remote_state');
const state_dir_from_env = require('./state_dir_from_env');
const state_from_service = require('./state_from_service');

// The running picture of the config: every service gets a state object the handlers mutate.
// The tables by name are looked up with names a request brings, so they have no prototype: a
// service or a machine called `constructor` is one that is not there, not Object's own.
function app_from_config(config)
{
    const out = {
        config,
        services: [],
        service_by_name: Object.create(null),
        remotes: [],
        remote_by_name: Object.create(null),
        routes_exact: Object.create(null),
        routes_wildcard: [],
        log_lines: [],
        // The group every other group hangs off; main.js makes it when the process starts
        log_group: null,
        // Whether stdout carries the time; a runtime that stamps its own lines does not need it
        log_stdout_time: true,
        // Where serviceman writes down what it is running, for the next serviceman to read
        state_dir: state_dir_from_env(process.env, config.base_dir),
        // The doors this host answers on, once they are open. A request that comes in through
        // a machine's link is handed to the services one.
        servers: null,
        // One change to the config file at a time, whoever is writing it
        config_lock: Promise.resolve(),
        // The connections agents' tokens hold open now (control_token_live)
        control_token_live: new Set(),
        // Machines taken out of the config while they were away. A laptop that was asleep when
        // it was removed dials in with a token nothing holds any more, and it is owed the
        // reason: it was taken away, so it can stop and take itself off that machine.
        removed: [],
        started_at: Date.now(),
        // What is wrong now, by key, as the last check found it (problems_check), and the check
        // in progress: a second one asked meanwhile waits for it instead
        problems: new Map(),
        problems_check: null,
        // What the last check asked and heard, the good with the bad, by key (health_from_views)
        health_seen: {checked_at: null, items: new Map()},
        // The Security page's last look at each machine, by name, the looks going on now
        // (security_check), and the mend a click started on each (POST /api/v1/security/mend)
        security: {seen: new Map(), running: new Map(), mending: new Map()},
        // Where the service door ended up, once it is open
        listen_port: null,
        // What went through each forward, by label: since this serviceman started, and the
        // totals of the last one added
        forward_counts: {},
        // What forward_totals_write last put on disk, so an unchanged one is not written again
        forward_totals_text: null,
        // The forwards serviceman itself listens for, by label, and one change to them at a time
        // (forwards_here)
        forwards_here: {},
        forwards_here_lock: Promise.resolve(),
        // The last upgrade of several machines at once, from the Remotes list (apt_all_run), and
        // the container this serviceman runs in: the machine that runs it goes last
        apt_all: null,
        own_container: own_container_id(),
    };
    for (const item of config.services) {
        out.services.push(Object.assign({}, item, {state: state_from_service(item)}));
    }
    for (const item of config.remotes) {
        const remote = Object.assign({}, item, {state: remote_state()});
        out.remotes.push(remote);
        out.remote_by_name[remote.name] = remote;
    }
    // The load tests run so far, the last few of each
    out.load_test_runs = load_test_runs_read(out);
    externals_attach(out, out.services);
    app_routes_rebuild(out);
    return out;
}

module.exports = app_from_config;
