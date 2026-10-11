const log_line = require('./log_line');
const log_scope = require('./log_scope');
const log_spawn = require('./log_spawn');

const NO_GROUP = 'serviceman';

// One event, written under the group the work belongs to. The group is carried by the work
// itself, so nothing has to pass it on; the first event of a group also writes the line that
// says whose child it is.
function log_event(app, subject, words)
{
    const group = log_scope.getStore();
    if (group === undefined) {
        log_line(app, NO_GROUP, subject, words);
        return;
    }
    log_spawn(app, group);
    log_line(app, group.uid, subject, words);
}

module.exports = log_event;
