const image_pull = require('./image_pull');
const log_event = require('./log_event');
const log_group_root = require('./log_group_root');
const remote_candidates = require('./remote_candidates');

// The first visit to a sleeping service pays for the pull of its image, and a fat image is
// minutes of somebody staring at the waiting page. So the image is fetched while nobody is
// asking: at the boot, and again whenever a machine dials in, on every machine the service may
// run on — a tag included, so a machine that joins later is filled too.
//
// Only what is missing is pulled. A blind `pull` of a `:latest` tag would quietly fetch a newer
// image, and the next start would run code nobody chose; the image already there is left alone.
//
// One at a time, because a machine has one uplink.
async function image_prepull(app, remote)
{
    for (const service of app.services) {
        if ((service.type !== 'docker') || (service.policy.prepull === false)) {
            continue;
        }
        for (const found of remote_candidates(app, service)) {
            if ((found.state.phase !== 'online') || ((remote !== undefined) && (found !== remote))) {
                continue;
            }
            await image_pull(app, found, service, false);
        }
    }
}

// Nothing waits for a pre-pull: it is work done ahead of a visitor, and a visitor that arrives
// first simply pays for the pull as before
function image_prepull_start(app, remote)
{
    log_group_root(app, function () {
        const promise = image_prepull(app, remote);
        promise.catch(function (error) {
            log_event(app, 'image_pull_error', {reason: error.message});
        });
    });
}

module.exports = image_prepull_start;
