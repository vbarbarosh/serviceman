const fs = require('fs');
const path = require('path');

// One line into the daily file; a day change opens the next file. A file that cannot be
// written stops the file log, it never stops serviceman.
function log_write(app, line)
{
    const log = app.file_log;
    if ((log === undefined) || (log === null) || log.dead) {
        return;
    }
    const now = new Date();
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    if (day !== log.day) {
        if (log.stream !== null) {
            log.stream.end();
        }
        try {
            fs.mkdirSync(log.dir, {recursive: true});
            log.stream = fs.createWriteStream(path.join(log.dir, `${day}.log`), {flags: 'a'});
        }
        catch (error) {
            log.dead = true;
            console.error(`serviceman: the log folder cannot be used — ${error.message}`);
            return;
        }
        log.stream.on('error', function (error) {
            log.dead = true;
            console.error(`serviceman: the log file cannot be written — ${error.message}`);
        });
        log.day = day;
    }
    log.stream.write(`${line}\n`);
}

module.exports = log_write;
