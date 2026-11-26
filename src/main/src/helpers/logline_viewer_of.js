// Where the control page serves Logline's viewer (handle_logline_viewer)
const BASE = '/logline/viewer/';

// Where the page opens Logline's viewer: the config's `ui` when it names one, the viewer the
// control page serves when it does not, null while Logline is not set. `logline` is the config's.
function logline_viewer_of(logline)
{
    if ((logline === null) || (logline === undefined)) {
        return null;
    }
    return ((logline.ui === null) || (logline.ui === undefined)) ? BASE : logline.ui;
}

logline_viewer_of.BASE = BASE;

module.exports = logline_viewer_of;
