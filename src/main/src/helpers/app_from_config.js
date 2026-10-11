const app_routes_rebuild = require('./app_routes_rebuild');
const externals_attach = require('./externals_attach');
const load_test_runs_read = require('./load_test_runs_read');
const remote_state = require('./remote_state');
const state_dir_from_env = require('./state_dir_from_env');
const state_from_service = require('./state_from_service');

// The running picture of the config: every service gets a state object the handlers mutate
function app_from_config(config)
{
    const out = {
        config,
        services: [],
        service_by_name: {},
        remotes: [],
        remote_by_name: {},
        routes_exact: {},
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
        // Machines taken out of the config while they were away. A laptop that was asleep when
        // it was removed dials in with a token nothing holds any more, and it is owed the
        // reason: it was taken away, so it can stop and take itself off that machine.
        removed: [],
        started_at: Date.now(),
        // Where the service door ended up, once it is open
        listen_port: null,
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
