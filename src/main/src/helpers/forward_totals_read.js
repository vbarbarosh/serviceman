const forward_totals_path = require('./forward_totals_path');
const fs = require('fs');
const log_event = require('./log_event');

// What the last serviceman kept of each forward, by label. No file, or one that does not read,
// is a start from zero and not a reason to refuse to start.
function forward_totals_read(app)
{
    try {
        const json = JSON.parse(fs.readFileSync(forward_totals_path(app), 'utf8'));
        return ((json.forwards === undefined) || (json.forwards === null)) ? {} : json.forwards;
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            log_event(app, 'forward_totals_read_error', {file: forward_totals_path(app), reason: error.message, then: 'counting from zero'});
        }
        return {};
    }
}

module.exports = forward_totals_read;
