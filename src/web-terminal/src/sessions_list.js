const child_process = require('child_process');
const tmux_argv = require('./tmux_argv');

// The kept sessions, as tmux has them: [{name, attached, created_at}]. No tmux server means no
// session has been started yet, or the last one ended. Fields are split by spaces: tmux prints a
// tab as `_`, and a session name here has no space.
function sessions_list()
{
    const argv = tmux_argv(['list-sessions', '-F', '#{session_name} #{session_attached} #{session_created}']);
    return new Promise(function (resolve) {
        child_process.execFile(argv[0], argv.slice(1), function (error, stdout) {
            if (error) {
                resolve([]);
                return;
            }
            const sessions = [];
            for (const line of stdout.split('\n')) {
                const [name, attached, created] = line.split(' ');
                if (/^\d+$/.test(created)) {
                    sessions.push({name, attached: Number(attached), created_at: new Date(Number(created)*1000).toISOString()});
                }
            }
            resolve(sessions);
        });
    });
}

module.exports = sessions_list;
