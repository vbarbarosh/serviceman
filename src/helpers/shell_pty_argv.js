const argv_line = require('./argv_line');

// A command run through a terminal that is not there. Some programs — `docker pull` above all
// — only show their progress when they believe a person is watching: docker drops every
// message that carries a progress bar unless its output is a terminal, so through a pipe a
// four hundred megabyte download says `Downloading` once and nothing after it.
//
// `script` gives it the terminal it is looking for. `-q` says nothing of its own, `-e` gives
// back the exit status of the command instead of its own, `-f` flushes each write through, and
// `-c` is the command. What comes back is written for a screen: lines that end in a carriage
// return, and escapes that move the cursor about.
function shell_pty_argv(argv)
{
    return ['script', '-qefc', argv_line(argv), '/dev/null'];
}

module.exports = shell_pty_argv;
