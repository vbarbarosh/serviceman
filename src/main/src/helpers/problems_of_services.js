const http = require('http');

const TIMEOUT_MS = 5000;

// Every copy that is meant to be up, asked whether it answers, the way a visitor's request
// reaches it: through its machine's link, at its upstream. Any answer at all is an answer; only
// a connection that is refused, dropped or never made is a problem. A copy on a machine that is
// offline is left to that machine's own problem.
//
//     out   {problems, seen}: seen [[key, {state, text, detail}]], every copy asked, as
//           health_from_views reads it
async function problems_of_services(app)
{
    const all = [];
    for (const service of app.services) {
        for (const instance of service.state.instances) {
            if ((instance.phase !== 'running') || (instance.upstream === null) || (instance.upstream === undefined)) {
                continue;
            }
            const remote = (instance.remote === null) ? null : app.remote_by_name[instance.remote];
            if ((remote !== null) && ((remote === undefined) || (remote.state.phase !== 'online'))) {
                continue;
            }
            all.push(probe(service, instance));
        }
    }
    const answers = await Promise.all(all);
    return {problems: answers.filter(v => v.problem !== null).map(v => v.problem), seen: answers.map(v => v.seen)};
}

function probe(service, instance)
{
    const upstream = instance.upstream;
    const where = `${upstream.host}:${upstream.port}${(instance.remote === null) ? '' : ` on ${instance.remote}`}`;
    const key = `service:${service.name}:${instance.slot}`;
    const begin = Date.now();
    function answered() {
        return {problem: null, seen: [key, {state: 'ok', text: `in ${Date.now() - begin} ms`, detail: `${where} answers`}]};
    }
    return new Promise(function (resolve) {
        let request;
        try {
            request = http.request({host: upstream.host, port: upstream.port, method: 'HEAD', path: '/', agent: instance.agent, timeout: TIMEOUT_MS}, function (answer) {
                answer.resume();
                resolve(answered());
            });
        }
        catch {
            // No way to it at all: the link went between the look at the machine and now
            resolve({problem: null, seen: [key, {state: 'none', text: 'not asked', detail: 'its machine\'s link went'}]});
            return;
        }
        request.on('timeout', function () {
            request.destroy(Object.assign(new Error(`no answer in ${TIMEOUT_MS/1000}s`), {code: 'ETIMEDOUT'}));
        });
        request.on('error', function (error) {
            if ((typeof error.code === 'string') && error.code.startsWith('HPE_')) {
                // It answered, in something that is not HTTP: it is there
                resolve(answered());
                return;
            }
            const problem = {
                key: `service_silent:${service.name}:${instance.slot}`,
                kind: 'service',
                remote: instance.remote,
                service: service.name,
                subject: `${service.title || service.name} does not answer`,
                cause: `nothing answers at ${where}: ${error.message}`,
                fix: (service.type === 'external') ? `It is not serviceman's to start: see that it runs ${(instance.remote === null) ? 'here' : `on ${instance.remote}`}.` : 'Restart it from its page; its log says why it stopped answering.',
                since: null,
            };
            resolve({problem, seen: [key, {state: 'bad', text: 'no answer', detail: problem.cause}]});
        });
        request.end();
    });
}

module.exports = problems_of_services;
