const format_seconds = require('../../../helpers/format_seconds');
const log_event = require('./log_event');
const service_phase = require('./service_phase');
const service_stop = require('./service_stop');

// How often a stop that waits says what it still waits on
const TICK_MS = 500;

// serviceman stopping on a signal, Ctrl-C or one like it: a line at once with what it stops,
// then one every half a second with what it still waits on, so the terminal never sits still
// while it ends. Programs stop with it; containers are left running. A program that outlives
// it (a kill, a crash, a second signal) is taken back at the next start instead of being fought
// for its port.
//
//     {time0, stopping, promise}   promise: the reasons of the programs that would not stop
function serviceman_stop(app, signal)
{
    const programs = programs_of(app);
    const out = {time0: Date.now(), stopping: programs.map(v => v.name), promise: null};
    log_event(app, 'serviceman_signal', `signal=${signal} stopping=${names_counted(out.stopping)}`);
    const stops = programs.map(function (service) {
        return service_stop(app, service, 'serviceman stops').then(function () {
            return null;
        }, function (error) {
            return `${service.name}: ${error.message}`;
        }).then(function (failed) {
            out.stopping = out.stopping.filter(v => v !== service.name);
            return failed;
        });
    });
    const timer = setInterval(function () {
        log_event(app, 'serviceman_tick', `${format_seconds(Date.now() - out.time0)} stopping=${names_counted(out.stopping)}`);
    }, TICK_MS);
    out.promise = Promise.all(stops).then(function (failed) {
        clearInterval(timer);
        return failed.filter(v => v !== null);
    });
    return out;
}

// The programs to stop. One that waits to be started again is stopped too: its timer could
// start it while the others stop, and it would outlive serviceman.
function programs_of(app)
{
    return app.services.filter(function (service) {
        if (service.type !== 'shell') {
            return false;
        }
        return (service_phase(service) !== 'stopped') || service.state.instances.some(v => v.restart_timer !== null);
    });
}

// A list in a line, counted and sorted: 2:["board","notes"]
function names_counted(names)
{
    return `${names.length}:${JSON.stringify(names.slice().sort())}`;
}

module.exports = serviceman_stop;
