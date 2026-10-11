const k6_lane = require('./k6_lane');
const k6_summary_mark = require('./k6_summary_mark');

const KEEP_LINES = 2000;

// `running (01m02.0s), 20/20 VUs, 1774 complete and 0 interrupted iterations`
const RE_PROGRESS = /^running \((?:([0-9]+)m)?([0-9.]+)s\), ([0-9]+)\/[0-9]+ VUs, ([0-9]+) complete/;

// One line k6 printed on its remote, kept for the page watching the run. The progress line it
// prints every second is also read: how far along it is, and how many answers so far.
function load_test_said(app, lane, text)
{
    const id = lane.slice(k6_lane.length);
    const run = app.load_test_runs.find(v => v.id === id);
    if (run === undefined) {
        return;
    }
    // The numbers are the run's, not its log's
    if (text.startsWith(k6_summary_mark)) {
        return;
    }
    run.lines.push(text);
    while (run.lines.length > KEEP_LINES) {
        run.lines.shift();
        run.lines_dropped++;
    }
    const match = RE_PROGRESS.exec(text.trim());
    if (match !== null) {
        run.live = {
            ms: Math.round((parseInt(match[1] || '0', 10)*60 + parseFloat(match[2]))*1000),
            vus: parseInt(match[3], 10),
            done: parseInt(match[4], 10),
        };
    }
}

module.exports = load_test_said;
