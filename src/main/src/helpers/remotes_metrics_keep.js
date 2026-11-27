const log_event = require('./log_event');
const remote_can = require('./remote_can');
const remote_metrics_read = require('./remote_metrics_read');
const remote_uptime_read = require('./remote_uptime_read');

// The days of uptime the page shows
const UPTIME_DAYS = 30;

// Every machine online has its last ten minutes, its last hour and its uptime of 30 days read by
// serviceman itself and kept, as a page's read keeps them: one that goes away shows the minutes
// before it went and its days, in its head and in History, though no page had it open then. A
// machine still answering the last read is not asked again; an agent from before the ten minutes
// is asked for its hour alone, one from before charts or uptime for neither. The answer is done
// once every read asked now is in; none throws.
function remotes_metrics_keep(app)
{
    return Promise.all(app.remotes.map(v => metrics_keep(app, v)));
}

async function metrics_keep(app, remote)
{
    const state = remote.state;
    if ((state.phase !== 'online') || state.metrics_keeping) {
        return;
    }
    state.metrics_keeping = true;
    try {
        for (const range of ranges_of(remote)) {
            await remote_metrics_read(app, remote, range);
        }
        if (remote_can(remote, 'uptime')) {
            await remote_uptime_read(app, remote, UPTIME_DAYS);
        }
    }
    catch (error) {
        log_event(app, 'remote_metrics_keep_error', {remote: remote.name, reason: error.message});
    }
    finally {
        state.metrics_keeping = false;
    }
}

// The ranges its agent keeps of those it is asked for: the ten minutes and the hour, the hour
// alone before the ten minutes, none before charts
function ranges_of(remote)
{
    if (remote_can(remote, 'metrics') === false) {
        return [];
    }
    return remote_can(remote, 'metrics_live') ? ['10m', '1h'] : ['1h'];
}

module.exports = remotes_metrics_keep;
