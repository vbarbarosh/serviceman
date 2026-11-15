// The header a load test's own requests carry, with the key of its run (load_test_run)
const LOAD_TEST_HEADER = 'x-serviceman-load-test';
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

// May this request be answered at a name under .localhost? Such a name is this computer's own:
// a browser sends it to this computer's loopback and nowhere else, so one that came from any
// other place was typed by hand, to reach what only this computer was meant to reach.
//
// On a machine, this computer is its loopback. In serviceman's image it is docker's published
// port, when bin/run published it on the machine's loopback; the container's own loopback is
// the tailnet there (doors_from_env). A socket file is this computer too: whoever opened it
// could open that file. A request a machine's link brought is from that machine's door, the
// public. A load test's own requests come from its machine with the key of their run.
function localhost_name_allowed(app, req)
{
    const key = req.headers[LOAD_TEST_HEADER];
    if ((typeof key === 'string') && app.load_test_keys.has(key)) {
        return true;
    }
    if (req.socket.tunnel_from !== undefined) {
        return false;
    }
    if (req.socket.remoteAddress === undefined) {
        return true;
    }
    if (app.doors.tailnet_on_loopback) {
        return app.doors.published_on_loopback && (LOOPBACK.includes(String(req.socket.localAddress)) === false);
    }
    return LOOPBACK.includes(String(req.socket.remoteAddress));
}

localhost_name_allowed.header = LOAD_TEST_HEADER;

module.exports = localhost_name_allowed;
