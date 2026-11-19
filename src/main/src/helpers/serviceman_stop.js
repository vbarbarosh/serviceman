const log_event = require('./log_event');
const service_phase = require('./service_phase');

// serviceman stopping on a signal, Ctrl-C or one like it: it stops nothing it started. The
// programs on the machines run on, as the containers do, and a serviceman that starts again
// takes them back as their agents dial in, as old as they were; a service is stopped by its
// Stop, never by serviceman leaving. One line says which programs it leaves running.
//
//     {time0, left}   left: the names of the programs left running, sorted
function serviceman_stop(app, signal)
{
    const left = app.services.filter(v => (v.type === 'shell') && ['running', 'starting', 'lost'].includes(service_phase(v))).map(v => v.name).sort();
    log_event(app, 'serviceman_signal', `signal=${signal} programs_left=${left.length}:${JSON.stringify(left)}`);
    return {time0: Date.now(), left};
}

module.exports = serviceman_stop;
