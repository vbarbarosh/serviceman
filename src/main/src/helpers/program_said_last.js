const service_said = require('./service_said');

// A program ended over there, and its agent sent its last lines with the word: they are said
// for its page, the ones not said yet. Why it ended is in them, and once it has ended nobody can
// ask its agent for them any more: a program that ended on its way up left none to read.
//
//     message   {type: 'program_end', service, slot, code, signal, said: ['…']}
function program_said_last(app, remote, message)
{
    const service = app.service_by_name[String(message.service)];
    if ((service === undefined) || (service.type !== 'shell') || (Array.isArray(message.said) === false)) {
        return;
    }
    const instance = service.state.instances.find(v => (v.slot === message.slot) && (v.remote === remote.name));
    if (instance === undefined) {
        return;
    }
    // The page's lines are its last start's: what the wait for its answer already read into
    // them is not said twice
    const said = service.state.said.slice();
    for (const line of message.said.filter(v => typeof v === 'string')) {
        if (said.includes(line) === false) {
            instance.tail_said = line;
            service_said(app, {service: service.name, text: line});
        }
    }
}

module.exports = program_said_last;
