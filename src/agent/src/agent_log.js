const fs = require('fs');
const path = require('path');

// The agent says everything on stdout, and writes it to a file as well when it is told where.
// The installer says `SERVICEMAN_LOG_DIR=<prefix>/logs`, so a machine kept up by systemd keeps
// yesterday's lines too. One file a day, named for the day, in logs/agent/, beside servermon's
// logs/servermon/: logs/agent/20261018.txt.
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
    const dir = path.join(file_log.dir, 'agent');
    const now = new Date();
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    if (day !== file_log.day) {
        if (file_log.stream !== null) {
            file_log.stream.end();
        }
        try {
            fs.mkdirSync(dir, {recursive: true});
            if (file_log.day === null) {
                days_moved(file_log.dir, dir);
            }
            file_log.stream = fs.createWriteStream(path.join(dir, `${day}.txt`), {flags: 'a'});
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

// The days an agent before 1.20 wrote straight into logs/, as 20261018.log, moved into
// logs/agent/ under their new name. A day already there is left where it was.
function days_moved(from, to)
{
    for (const name of fs.readdirSync(from)) {
        const m = name.match(/^(\d{8})\.log$/);
        if (m && (fs.existsSync(path.join(to, `${m[1]}.txt`)) === false)) {
            fs.renameSync(path.join(from, name), path.join(to, `${m[1]}.txt`));
        }
    }
}

module.exports = agent_log;
