const counters_from_service = require('./counters_from_service');
const counters_path = require('./counters_path');
const fs = require('fs');
const path = require('path');

// The counters of every service, written whole and only when they changed since the last
// write. A service taken out of the config is not in it any more, and neither are its numbers.
function counters_write(app)
{
    const services = {};
    for (const service of app.services) {
        services[service.name] = counters_from_service(service);
    }
    const text = `${JSON.stringify({services}, null, 4)}\n`;
    if (text === app.counters_text) {
        return false;
    }
    const file = counters_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
    app.counters_text = text;
    return true;
}

module.exports = counters_write;
