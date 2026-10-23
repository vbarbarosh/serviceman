const format_seconds = require('../../../helpers/format_seconds');
const log_event = require('./log_event');
const log_words = require('../../../helpers/log_words');
const program_env = require('./program_env');
const remote_call = require('./remote_call');
const secrets_deliver = require('./secrets_deliver');

// A line the config gave for one moment of a program's life, run in the program's folder on
// the machine that carries it. What it says goes to the log; a line that fails is the caller's
// to make sense of, because a failed install is not a failed goodbye.
async function program_step(app, remote, service, step, env)
{
    const line = service.lifecycle[step];
    if (line === null) {
        return {ok: true, ran: false, stdout: '', stderr: ''};
    }
    const time0 = Date.now();
    log_event(app, 'program_step_begin', {service: service.name, step, cwd: service.cwd, remote: remote.name});
    const secrets = await secrets_deliver(app, remote, service);
    const answer = await run(app, remote, service, step, line, env, secrets);
    const took = format_seconds(Date.now() - time0);
    if (answer.ok === false) {
        log_event(app, 'program_step_end_error', `${took} ${log_words({service: service.name, step, reason: answer.stderr})}`);
        return Object.assign({ran: true}, answer);
    }
    log_event(app, 'program_step_end_ok', `${took} ${log_words({service: service.name, step})}`);
    return Object.assign({ran: true}, answer);
}

function run(app, remote, service, step, line, env, secrets)
{
    const words = Object.assign(program_env(service), env);
    return remote_call(app, remote, 'program_step', {service: service.name, cwd: service.cwd, line, env: words, image: service.image, user: service.user, secrets});
}

module.exports = program_step;
