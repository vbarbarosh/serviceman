const apt_lane = require('../../main/src/helpers/apt_lane');
const apt_said = require('../../main/src/helpers/apt_said');
const machine_link = require('./machine_link');

// This computer as the modules' host: the `app` serviceman's helpers keep their state in (its
// streams, its log lines) and the remote they ask, joined to the agent's code run in this
// process. Made the first time a module asks, so a page that only loads its files starts no
// agent.
let made = null;

function machine_host()
{
    if (made === null) {
        const app = {
            log_lines: [],
            file_log: null,
            log_stdout_time: true,
            // What the agent said about the work of a lane: an upgrade's lines go to the page
            // following it
            service_said: function (remote, service, text) {
                if (service === apt_lane) {
                    apt_said(app, remote, text);
                }
            },
        };
        made = {app, remote: machine_link(app)};
    }
    return made;
}

module.exports = machine_host;
