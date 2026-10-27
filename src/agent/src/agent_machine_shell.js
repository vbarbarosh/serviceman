const EventEmitter = require('events');
const agent_term_join = require('./agent_term_join');
const child_process = require('child_process');
const os = require('os');

// Node alone cannot open a pty, and a terminal without one is not a terminal — no prompt
// colors, no vim, no ctrl-c. Every machine this runs on has python3, whose pty module forks
// the shell under a real one. Fd 3 carries the resizes, because the bytes on stdin are the
// person typing and nothing else.
const PTY_PY = `
import fcntl, os, pty, select, signal, struct, sys, termios

def resize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

# What the program printed last (a shell's "logout") is still on its way when it ends: it is
# passed on, and what it left running in the background, holding the pty, is not waited for
def last_words():
    for _ in range(64):
        if not select.select([fd], [], [], 0)[0]:
            break
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)

# The resizes are for this loop alone: a job the program leaves in the background, holding
# fd 3 on, would keep the pipe open, and the terminal with it, after the program and this end
os.set_inheritable(3, False)
# The program's end wakes the loop below: SIGCHLD writes a byte into this pipe
wake_r, wake_w = os.pipe()
os.set_blocking(wake_w, False)
signal.set_wakeup_fd(wake_w)
signal.signal(signal.SIGCHLD, lambda signum, frame: None)
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[3], sys.argv[3:])
resize(fd, int(sys.argv[1]), int(sys.argv[2]))
while True:
    try:
        ready, _, _ = select.select([0, fd, 3, wake_r], [], [])
    except InterruptedError:
        continue
    except OSError:
        break
    if wake_r in ready:
        os.read(wake_r, 256)
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            last_words()
            break
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            break
        os.write(fd, data)
    if 3 in ready:
        lines = os.read(3, 256).decode('utf8', 'replace').split()
        if len(lines) >= 2:
            try:
                resize(fd, int(lines[-2]), int(lines[-1]))
            except (ValueError, OverflowError, struct.error):
                pass
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
os.close(fd)
`;

// A terminal on this machine, as the user the agent runs as. It answers like the socket a
// tunnelled stream usually is, so the tunnel carries it without knowing the difference.
// `term` names a terminal kept running here (agent_term_join): closing this one leaves it
// running. Without it, the shell ends when the terminal closes.
function agent_machine_shell(target)
{
    if (typeof target.term === 'string') {
        return agent_term_join({name: target.term, cols: target.cols, rows: target.rows});
    }
    const shell = process.env.SHELL || '/bin/bash';
    const argv = [shell, '-l'];
    const child = child_process.spawn('python3', ['-c', PTY_PY, String(target.cols || 80), String(target.rows || 24), ...argv], {
        cwd: os.homedir(),
        env: Object.assign({}, process.env, {TERM: 'xterm-256color'}),
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    const out = new EventEmitter();
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function (chunk, done) {
        child.stdin.write(chunk, done);
    };
    out.end = function () {
        child.stdin.end();
    };
    out.pause = function () {
        child.stdout.pause();
    };
    out.resume = function () {
        child.stdout.resume();
    };
    out.destroy = function () {
        out.destroyed = true;
        child.kill('SIGKILL');
    };
    out.resize = function (cols, rows) {
        if ((child.stdio[3] !== null) && (child.stdio[3].destroyed === false)) {
            child.stdio[3].write(`${cols} ${rows}\n`);
        }
    };
    child.stdout.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    // What python itself says — a missing python3 says nothing here, spawn errors below do,
    // but a traceback belongs on the screen of whoever opened the shell
    child.stderr.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    child.stdout.on('end', function () {
        out.emit('end');
    });
    child.on('error', function (error) {
        out.emit('error', error);
    });
    child.on('close', function () {
        out.destroyed = true;
        out.emit('close');
    });
    child.stdin.on('error', function () {
        // The shell went while input was on the way; close says the rest
    });
    return out;
}

module.exports = agent_machine_shell;
