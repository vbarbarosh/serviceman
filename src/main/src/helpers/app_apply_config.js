const agent_reset = require('./agent_reset');
const app_routes_rebuild = require('./app_routes_rebuild');
const counters_apply = require('./counters_apply');
const counters_from_service = require('./counters_from_service');
const doors_tell = require('./doors_tell');
const externals_attach = require('./externals_attach');
const forwards_tell = require('./forwards_tell');
const link_send_message = require('../../../helpers/link_send_message');
const log_event = require('./log_event');
const logline_revoke = require('./logline_revoke');
const logline_sweep = require('./logline_sweep');
const remote_state = require('./remote_state');
const service_ensure_running = require('./service_ensure_running');
const service_phase = require('./service_phase');
const service_probe = require('./service_probe');
const service_uninstall = require('./service_uninstall');
const service_waits_for_remote = require('./service_waits_for_remote');
const state_from_service = require('./state_from_service');

// Long enough for the word to leave, and no longer: an agent that heard it is already gone
const BYE_MS = 150;

// What a remote's entry may change without its link: blanked on both sides before they are
// compared
const LINK_KEPT = {logs: null, log_dirs: null, inbound: null};

// A new config lands on the running app: untouched services keep their state, the rest
// start fresh and are reconciled with their containers at the next start
async function app_apply_config(app, config)
{
    const out = {restart_needed: false, notes: []};
    function note(text) {
        out.notes.push(text);
        log_event(app, 'config_change', {change: text});
    }
    const running = app.config;
    if (JSON.stringify([config.listen, config.control]) !== JSON.stringify([running.listen, running.control])) {
        out.restart_needed = true;
        note('listen or control changed — that part waits for a serviceman restart');
    }
    const fresh = [];
    const next_services = [];
    for (const item of config.services) {
        const old = app.service_by_name[item.name];
        const old_item = running.services.find(v => v.name === item.name);
        if ((old !== undefined) && (JSON.stringify(old_item) === JSON.stringify(item))) {
            next_services.push(old);
            continue;
        }
        const service = Object.assign({}, item, {state: state_from_service(item)});
        // A changed definition is the same service: what it served so far stays counted
        if (old !== undefined) {
            counters_apply(service, counters_from_service(old));
        }
        next_services.push(service);
        fresh.push(service);
        note((old === undefined) ? `${service.name}: new service` : `${service.name}: the definition changed`);
    }
    for (const service of app.services) {
        if (next_services.includes(service)) {
            continue;
        }
        for (const instance of service.state.instances) {
            agent_reset(app, service, instance);
        }
        if (config.services.some(v => v.name === service.name) === false) {
            const done = await service_uninstall(app, service);
            note(`${service.name}: removed from the config — ${((done === null) || (done === '')) ? 'anything running keeps running' : done}`);
        }
    }
    const replaced = remotes_apply(app, config, note);
    app.config = Object.assign({}, config, {
        listen: running.listen,
        control: running.control,
        path: running.path,
    });
    app.services = next_services;
    // A machine whose definition changed is a new object with a new link; an instance on it
    // held a pool dialling the old one, which is offline for good
    for (const service of app.services) {
        for (const instance of service.state.instances) {
            if ((instance.remote !== null) && replaced.includes(instance.remote)) {
                agent_reset(app, service, instance);
            }
        }
    }
    externals_attach(app, fresh);
    app_routes_rebuild(app);
    // What the machines were told about Logline, and what their doors route by, may be out of
    // date now
    logline_sweep(app).catch(function (error) {
        log_event(app, 'logline_sweep_error', {reason: error.message});
    });
    doors_tell(app);
    forwards_tell(app);
    for (const service of fresh) {
        await service_probe(app, service);
    }
    for (const service of fresh) {
        if ((service.policy.start !== 'always') || (service_phase(service) === 'running')) {
            continue;
        }
        if (service_waits_for_remote(app, service)) {
            // It starts when its remote dials in, not before
            continue;
        }
        const promise = service_ensure_running(app, service);
        promise.catch(function () {
            // instance_start wrote why it failed; this catch only keeps the rejection quiet
        });
    }
    return out;
}

// A remote that is untouched keeps the link its agent already dialled in on; a token or a
// name that changed drops the link, and the agent dials in again with what the config now says.
// Answers with the names of the machines that were made anew.
function remotes_apply(app, config, note)
{
    const next = [];
    const out = [];
    const removed = [];
    for (const item of config.remotes) {
        const old = app.remote_by_name[item.name];
        const old_item = app.config.remotes.find(v => v.name === item.name);
        if ((old !== undefined) && (JSON.stringify(old_item) === JSON.stringify(item))) {
            next.push(old);
            continue;
        }
        // Whether its logs go to Logline is told to the agent over the link it is on, and the
        // names its door answers are read on this end at every request; nothing about the
        // machine changed, so it does not have to dial in again
        if ((old !== undefined) && (JSON.stringify(Object.assign({}, old_item, LINK_KEPT)) === JSON.stringify(Object.assign({}, item, LINK_KEPT)))) {
            if (JSON.stringify([old_item.logs, old_item.log_dirs]) !== JSON.stringify([item.logs, item.log_dirs])) {
                note(`remote ${item.name}: logs ${item.logs}${(item.log_dirs.length === 0) ? '' : `, and ${(item.log_dirs.length === 1) ? 'a folder' : `${item.log_dirs.length} folders`}`}`);
            }
            if (JSON.stringify(old_item.inbound) !== JSON.stringify(item.inbound)) {
                note(`remote ${item.name}: the names its door answers changed`);
            }
            old.logs = item.logs;
            old.log_dirs = item.log_dirs;
            old.inbound = item.inbound;
            next.push(old);
            continue;
        }
        next.push(Object.assign({}, item, {state: remote_state()}));
        note((old === undefined) ? `remote ${item.name}: new remote, waiting for its agent to dial in` : `remote ${item.name}: the definition changed, its agent must dial in again`);
        link_drop(app, old, 'the definition changed');
        out.push(item.name);
    }
    for (const remote of app.remotes) {
        if (next.includes(remote)) {
            continue;
        }
        link_drop(app, remote, 'taken out of the config');
        if (config.remotes.some(v => v.name === remote.name) === false) {
            note(`remote ${remote.name}: removed from the config`);
            removed.push(remote.name);
        }
    }
    app.remotes = next;
    app.remote_by_name = {};
    for (const remote of next) {
        app.remote_by_name[remote.name] = remote;
    }
    // A machine that is gone from the config must not go on writing to the log
    for (const name of removed) {
        logline_revoke(app, name).catch(function (error) {
            log_event(app, 'logline_revoke_error', {remote: name, reason: error.message});
        });
    }
    return out;
}

// The agent is told before the link goes, so it hangs up and dials again at once rather than
// finding out when whatever stands between the two lets the drop through — through a proxy
// that can be minutes. The drop itself follows once the word has had time to leave.
function link_drop(app, remote, reason)
{
    if ((remote === undefined) || (remote.state.socket === null)) {
        return;
    }
    const socket = remote.state.socket;
    log_event(app, 'remote_dropped', {remote: remote.name, reason, then: 'its agent dials in again'});
    try {
        link_send_message(socket, {type: 'bye', reason});
    }
    catch {
        // The link is already going; the destroy below is what matters
    }
    setTimeout(function () {
        socket.destroy();
    }, BYE_MS);
}

module.exports = app_apply_config;
