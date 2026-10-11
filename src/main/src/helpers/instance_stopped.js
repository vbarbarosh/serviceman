// One instance is no longer running: it holds no machine, no address, and no clock. Every
// path that finds one gone goes through here, so that none of them can forget a field — a
// stopped service whose page says `Up for 27s` is the kind of thing that comes of forgetting.
function instance_stopped(instance)
{
    instance.phase = 'stopped';
    instance.remote = null;
    instance.upstream = null;
    instance.started_at = null;
    instance.stopped_at = Date.now();
}

module.exports = instance_stopped;
