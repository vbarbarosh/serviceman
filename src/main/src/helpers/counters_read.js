const counters_path = require('./counters_path');
const fs = require('fs');
const log_event = require('./log_event');

// What the last serviceman counted, by service name. No file, or one that does not read, is a
// start from zero and not a reason to refuse to start.
function counters_read(app)
{
    try {
        const json = JSON.parse(fs.readFileSync(counters_path(app), 'utf8'));
        return (((json.services === undefined) || (json.services === null)) ? {} : json.services);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            log_event(app, 'counters_read_error', {file: counters_path(app), reason: error.message, then: 'counting from zero'});
        }
        return {};
    }
}

module.exports = counters_read;
