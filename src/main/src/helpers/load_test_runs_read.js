const fs = require('fs');
const load_test_runs_path = require('./load_test_runs_path');

// The runs kept from before this serviceman started. One that was still going when the last
// one stopped never finished, and says so.
function load_test_runs_read(app)
{
    let text;
    try {
        text = fs.readFileSync(load_test_runs_path(app), 'utf8');
    }
    catch {
        return [];
    }
    const json = JSON.parse(text);
    if (Array.isArray(json.runs) === false) {
        return [];
    }
    for (const run of json.runs) {
        if (run.ended_at === null) {
            run.phase = 'error';
            run.error = 'serviceman stopped while it ran';
            run.ended_at = run.started_at;
        }
    }
    return json.runs;
}

module.exports = load_test_runs_read;
