const format_seconds = require('../../../helpers/format_seconds');
const last_line = require('../../../helpers/last_line');
const log_event = require('./log_event');
const log_words = require('../../../helpers/log_words');
const program_mark = require('./program_mark');
const remote_call = require('./remote_call');
const secrets_deliver = require('./secrets_deliver');

// Ten minutes: a first install fetches a repo and everything under it, and that is a slow
// thing on a small machine
const INSTALL_TIMEOUT_MS = 600000;

// The folder of a program, put in place before it is run. The mark inside it holds the line
// that installed it, so the line runs once — and when it changes, the folder is brought up to
// date instead: the update line if there is one, the install line if there is not.
async function program_install(app, remote, service, force)
{
    if (service.lifecycle.install === null) {
        return;
    }
    const mark = program_mark(service.lifecycle.install);
    // What would run, before anything runs: a line that takes minutes says so when it starts,
    // and a folder that is already the program says nothing at all
    const look = await ask(app, remote, service, mark, true, undefined, force);
    if (look.step === null) {
        return;
    }
    const secrets = await secrets_deliver(app, remote, service);
    const words = {service: service.name, step: look.step, cwd: service.cwd, remote: remote.name};
    log_event(app, 'program_step_begin', words);
    const time0 = Date.now();
    const answer = await ask(app, remote, service, mark, false, secrets, force);
    if (answer.ok === false) {
        log_event(app, 'program_step_end_error', `${format_seconds(Date.now() - time0)} ${log_words(Object.assign({}, words, {reason: last_line(answer.stderr)}))}`);
        throw new Error(`${service.name}: the ${answer.step} line failed — ${answer.stderr}`);
    }
    log_event(app, 'program_step_end_ok', `${format_seconds(Date.now() - time0)} ${log_words(words)}`);
}

function ask(app, remote, service, mark, look, secrets, force)
{
    const life = service.lifecycle;
    return remote_call(app, remote, 'program_install', {
        service: service.name,
        cwd: service.cwd,
        install: life.install,
        update: life.update,
        mark,
        env: service.env,
        look,
        made: service.cwd_made,
        image: service.image,
        user: service.user,
        secrets,
        force,
    }, INSTALL_TIMEOUT_MS);
}

module.exports = program_install;
