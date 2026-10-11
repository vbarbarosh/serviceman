const from_this_machine = require('./helpers/from_this_machine');

const SHORT = 'serviceman could not get an answer from it — the log on this host says why';

// A visitor is told that it did not work, and nothing else: no addresses, no ports, no docker
// words, no remote names. Whoever runs this host is told the real reason, because that is where
// something can be done about it.
//
// Who that is, is the same question the control page asks. On a machine, it is whoever is on
// the machine. In a container, every request arrives through docker and so looks like a
// stranger — which is why the control page is `exposed` there, and why the reason follows it:
// one decision about who is trusted, not two.
function error_detail(app, req, text)
{
    if (from_this_machine(req) || app.config.control.exposed) {
        return text;
    }
    return SHORT;
}

module.exports = error_detail;
