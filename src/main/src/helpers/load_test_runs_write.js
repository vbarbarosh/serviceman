const fs = require('fs');
const load_test_log_path = require('./load_test_log_path');
const load_test_runs_path = require('./load_test_runs_path');
const path = require('path');

// How many runs of one test are kept
const KEEP_RUNS = 20;

// The runs written whole, the last few of each test, with their lines left out: a finished run
// is its numbers, and its log is a file of its own, which goes with it
function load_test_runs_write(app)
{
    const counts = {};
    const kept = [];
    for (const run of app.load_test_runs.slice().reverse()) {
        counts[run.test] = (counts[run.test] || 0) + 1;
        if (counts[run.test] <= KEEP_RUNS) {
            kept.unshift(run);
        }
        else {
            fs.rmSync(load_test_log_path(app, run.id), {force: true});
        }
    }
    app.load_test_runs = kept;
    const runs = kept.map(v => Object.assign({}, v, {lines: []}));
    const file = load_test_runs_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, `${JSON.stringify({runs}, null, 4)}\n`);
    fs.renameSync(temp, file);
}

module.exports = load_test_runs_write;
