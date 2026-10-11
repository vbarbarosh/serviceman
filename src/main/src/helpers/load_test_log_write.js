const fs = require('fs');
const load_test_log_path = require('./load_test_log_path');
const path = require('path');

// A finished run's output, written down for its Log; the page asks for it only when opened
function load_test_log_write(app, run)
{
    const file = load_test_log_path(app, run.id);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const head = (run.lines_dropped > 0) ? [`… ${run.lines_dropped} earlier lines were not kept`] : [];
    fs.writeFileSync(file, `${head.concat(run.lines).join('\n')}\n`);
}

module.exports = load_test_log_write;
