const docker_pull_progress = require('./docker_pull_progress');
const docker_shell = require('./docker_shell');
const log_event = require('./log_event');

// `docker pull` for a service, run where that service runs, with the download turned into
// something a person can read: one sentence with a percentage, kept fresh while it downloads.
//
// The lines docker prints reach `service_said` from both ends — this host runs the command
// itself, a machine with an agent sends its output down the link — so the reading of them is
// hung on the service, not on this call. What arrives while `state.pull` is set is counted;
// what it recognises never reaches the page as text, because four hundred layer lines are not
// a status, they are a wall.
async function shell_progress_docker_pull(app, remote, service)
{
    service.state.pull = docker_pull_progress(service.image);
    service.state.progress = null;
    service.state.progress_text = null;
    try {
        const out = await docker_shell(app, remote, ['pull', service.image], service.name, true);
        if ((out.ok === false) && no_pty(out)) {
            // The machine has no `script`. The pull still works; it just cannot say how far
            // it is, because docker keeps that for a terminal.
            log_event(app, 'docker_pull_no_pty', {service: service.name, remote: remote.name, then: 'the download runs without a progress meter'});
            return await docker_shell(app, remote, ['pull', service.image], service.name);
        }
        return out;
    }
    finally {
        service.state.pull = null;
        service.state.progress = null;
        service.state.progress_text = null;
    }
}

// `script` is util-linux, and a machine may not have it. Nothing else about a failed pull
// looks like this, so the fallback is not tried for a pull that failed on its own merits.
function no_pty(answer)
{
    return /script: not found|script: command not found|ENOENT/.test(`${answer.stderr} ${answer.stdout}`);
}

module.exports = shell_progress_docker_pull;
