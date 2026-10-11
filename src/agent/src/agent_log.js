const fs = require('fs');
const path = require('path');

// The agent says everything on stdout, and writes it to a file as well when it is told where.
// The installer says `SERVICEMAN_LOG_DIR=<prefix>/logs`, so a machine kept up by systemd keeps
// yesterday's lines too. One file a day, named for the day, the same as the host's.
//
// A folder that cannot be written stops the file log. It never stops the agent.
const file_log = {
    dir: process.env.SERVICEMAN_LOG_DIR || '',
    day: null,
    stream: null,
    dead: false,
};

function agent_log(line)
{
    if ((file_log.dir === '') || (file_log.dir === 'none') || file_log.dead) {
        return;
    }
    const now = new Date();
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    if (day !== file_log.day) {
        if (file_log.stream !== null) {
            file_log.stream.end();
        }
        try {
            fs.mkdirSync(file_log.dir, {recursive: true});
            file_log.stream = fs.createWriteStream(path.join(file_log.dir, `${day}.log`), {flags: 'a'});
        }
        catch (error) {
            file_log.dead = true;
            console.error(`serviceman-agent: the log folder cannot be used — ${error.message}`);
            return;
        }
        file_log.stream.on('error', function (error) {
            file_log.dead = true;
            console.error(`serviceman-agent: the log file cannot be written — ${error.message}`);
        });
        file_log.day = day;
    }
    file_log.stream.write(`${line}\n`);
}

module.exports = agent_log;
