const forward_join = require('./forward_join');
const forward_totals_path = require('./forward_totals_path');
const fs = require('fs');
const path = require('path');

// Connections in all and bytes each way of every forward in the config, written whole and only
// when they changed; a forward taken out of the config leaves the file at the next write
function forward_totals_write(app)
{
    const forwards = {};
    for (const forward of app.config.forwards) {
        const counts = forward_join.counts(app, forward.label);
        forwards[forward.label] = {total: counts.total, bytes_sent: counts.bytes_sent, bytes_back: counts.bytes_back};
    }
    const text = `${JSON.stringify({forwards}, null, 4)}\n`;
    if (text === app.forward_totals_text) {
        return false;
    }
    const file = forward_totals_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
    app.forward_totals_text = text;
    return true;
}

module.exports = forward_totals_write;
