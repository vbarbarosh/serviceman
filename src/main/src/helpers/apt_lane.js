// The tag an upgrade's output carries on its way back. The agent puts it on every line it says
// about the run, and it is not the name of a service: a `#` name is a lane on the machine's
// page, the way `#ui` is a kind of machine.
const apt_lane = '#apt';

module.exports = apt_lane;
