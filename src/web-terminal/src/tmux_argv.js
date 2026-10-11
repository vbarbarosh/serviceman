const path = require('path');

const TMUX_CONF = path.resolve(__dirname, '../tmux.conf');

// tmux on a server of this app's own, apart from any tmux the machine's user runs. The config
// is read once, when the first session starts that server.
function tmux_argv(args)
{
    return ['tmux', '-L', 'web-terminal', '-f', TMUX_CONF, ...args];
}

module.exports = tmux_argv;
