const EventEmitter = require('events');
const child_process = require('child_process');
const os = require('os');

// Node alone cannot open a pty. python3's pty module forks the program under a real one; fd 3
// carries the resizes, because the bytes on stdin are the person typing and nothing else. The
// same few lines serve serviceman's agent (src/agent/src/agent_machine_shell.js).
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
            resize(fd, int(lines[-2]), int(lines[-1]))
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

// A program under a pty, as the stream the Terminal module attaches a page to. destroy() takes
// the pty away: an unnamed shell goes with it, a tmux client lets go of a session that stays.
function pty_spawn(argv)
{
    const child = child_process.spawn('python3', ['-c', PTY_PY, '80', '24', ...argv], {
        cwd: os.homedir(),
        env: Object.assign({}, process.env, {TERM: 'xterm-256color'}),
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    const out = new EventEmitter();
    out.write = function (chunk) {
        child.stdin.write(chunk);
    };
    out.destroy = function () {
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
    child.stderr.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    child.on('error', function (error) {
        out.emit('error', error);
    });
    child.on('close', function () {
        out.emit('close');
    });
    child.stdin.on('error', function () {
        // The program went while input was on the way; close says the rest
    });
    return out;
}

module.exports = pty_spawn;
