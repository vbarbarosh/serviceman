const docker_shell = require('./docker_shell');
const format_seconds = require('../../../helpers/format_seconds');
const log_event = require('./log_event');
const reason_from_answer = require('../../../helpers/reason_from_answer');
const service_said = require('./service_said');
const shell_progress_docker_pull = require('./shell_progress_docker_pull');

// Fetches the image of a service onto the machine that will run it, if it is not there yet,
// and says whether it had to. It is the download that makes a first start take minutes, so it
// is a step of its own with a name — a page that says `starting` for four minutes says nothing.
//
// `loud` is for the pull somebody is waiting on: what docker prints goes to the page as it is
// printed, and the service says it is downloading. A pull done ahead of anybody asking is
// quiet, because there is no page and no one to tell.
async function image_pull(app, remote, service, loud)
{
    const here = await docker_shell(app, remote, ['image', 'inspect', service.image]);
    if (here.ok) {
        return false;
    }
    const time0 = Date.now();
    // The machine is named even when it is this one: a pull is the slowest thing serviceman
    // does, and which machine paid for it is half of what the line is for
    const where = remote.name;
    log_event(app, 'image_pull_begin', {service: service.name, image: service.image, remote: where});
    // The words are its own only when nothing bigger holds the page — a new version put in
    // place — and the download's progress takes them over from there
    const own = (loud === true) && (service.state.doing === null);
    if (own) {
        service.state.doing = `downloading ${service.image}`;
    }
    if (loud === true) {
        service_said(app, {service: service.name, text: `the image ${service.image} is not on this machine yet — downloading it`});
    }
    const pulled = (loud === true)
        ? await shell_progress_docker_pull(app, remote, service)
        : await docker_shell(app, remote, ['pull', service.image]);
    if (own) {
        service.state.doing = null;
    }
    if (pulled.ok) {
        log_event(app, 'image_pull_end_ok', {service: service.name, image: service.image, remote: where, took: format_seconds(Date.now() - time0)});
        return true;
    }
    log_event(app, 'image_pull_end_error', {service: service.name, image: service.image, remote: where, reason: reason_of(pulled), took: format_seconds(Date.now() - time0)});
    // Not an error here: `docker run` fetches it again itself and says why it could not, which
    // is the message the visitor should get
    return false;
}

// What docker said about it, on one line and without the progress bars
function reason_of(answer)
{
    const reason = reason_from_answer(answer);
    return (reason === null) ? `docker ended with ${answer.code}` : reason;
}

module.exports = image_pull;
