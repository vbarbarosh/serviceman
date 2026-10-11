const from_this_machine = require('./helpers/from_this_machine');

// The control page reads and writes the config, opens shells inside containers and holds the
// remote tokens, and it asks nobody for a password. So it answers the machine it runs on and
// nothing else — over the service port, which a whole network may reach, a stranger asking
// for the control hostname hears what anyone asking for an unknown name hears.
// `control.exposed` opens it on purpose, for whoever puts their own wall in front.
function control_allowed(app, req)
{
    return app.config.control.exposed || from_this_machine(req);
}

module.exports = control_allowed;
