const apt_run = require('./apt_run');
const log_event = require('./log_event');

// Installs what is waiting on several machines at once, each its own apt, as Install them does
// for one. The machine serviceman itself runs on waits until the others end, alone: an upgrade
// of Docker there restarts serviceman in the middle of it, and the runs of the others would go
// with it. The answer is the end of every run.
async function apt_all_run(app, remotes, held)
{
    const batch = {remotes: remotes.map(v => v.name), held: (held === null) ? null : held.name, started_at: Date.now(), ended_at: null};
    app.apt_all = batch;
    log_event(app, 'apt_all_begin', {remotes: batch.remotes, held: batch.held || undefined});
    if (held !== null) {
        held.state.apt = {phase: 'waiting', lines: [], started_at: null, ended_at: null, error: null, containers: null};
    }
    await Promise.all(remotes.filter(v => v !== held).map(v => apt_run(app, v)));
    if (held !== null) {
        await held_run(app, held);
    }
    batch.ended_at = Date.now();
    const phases = batch.remotes.map(v => app.remote_by_name[v]).filter(v => v !== undefined).map(v => v.state.apt.phase);
    log_event(app, 'apt_all_end', {ok: phases.filter(v => v === 'ok').length, failed: phases.filter(v => v !== 'ok').length});
}

// Its turn, unless it was started by hand from its own page meanwhile, cancelled, removed, or
// went away
async function held_run(app, held)
{
    const remote = app.remote_by_name[held.name];
    if ((remote !== held) || (held.state.apt.phase !== 'waiting')) {
        return;
    }
    if (held.state.phase !== 'online') {
        Object.assign(held.state.apt, {phase: 'error', ended_at: Date.now(), error: `${held.name} was not connected when its turn came`});
        return;
    }
    await apt_run(app, held);
}

module.exports = apt_all_run;
