// The last lines are the ones that say why it stopped, so the file is closed and flushed
// before the process leaves
function log_close(app)
{
    return new Promise(function (resolve) {
        const log = app.file_log;
        if ((log === undefined) || (log === null) || (log.stream === null)) {
            resolve();
            return;
        }
        log.stream.end(resolve);
    });
}

module.exports = log_close;
