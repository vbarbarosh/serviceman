const docker_shell = require('./docker_shell');
const log_event = require('./log_event');

// Stops a run: its container is taken away, and the run ends with whatever it had
async function load_test_stop(app, run)
{
    run.phase = 'stopping';
    log_event(app, 'load_test_stop', {test: run.test, run: run.id});
    const remote = app.remote_by_name[run.remote];
    if ((remote === undefined) || (remote.state.phase !== 'online')) {
        return;
    }
    await docker_shell(app, remote, ['rm', '--force', `serviceman-k6-${run.id}`]);
}

module.exports = load_test_stop;
