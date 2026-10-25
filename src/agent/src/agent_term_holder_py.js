// The process that keeps a terminal alive on the machine: it forks the shell under a pty,
// listens on a socket file, and outlives whoever started it — the page, serviceman, the agent.
// It keeps the last HISTORY bytes the shell printed and hands them to each one who joins, so
// the page's own terminal scrolls back through them; nothing is redrawn and there are no modes.
// The questions programs asked the terminal are left out of that replay (QUERIES): they were
// answered when they were asked.
//
// The socket carries the terminal as it is, bytes both ways, so `socat` joins it by hand. The
// size is not in the stream: it is written to the .size file and the holder is sent SIGWINCH.
// The .json beside it says who it is and how many are joined. Ending the shell ends the holder
// and takes its files with it.
//
//     python3 -c agent_term_holder_py <base> <cols> <rows> <argv...>
const agent_term_holder_py = `
import fcntl, json, os, pty, re, select, signal, socket, struct, sys, termios, time

HISTORY = 1 << 20
# What a program asks the terminal and the terminal answers: its kind (DA), a report of its
# state (DSR, DECRQM, DECRQSS, XTGETTCAP, XTVERSION, window size), its colours (OSC 4/10/11/12
# with ?). Asked again on a replay, a joined terminal would answer each of them into the
# shell's input, where they show as typed text.
QUERIES = re.compile(rb'\\x1b\\[[>=]?[0-9;]*c|\\x1b\\[\\??[0-9;]*n|\\x1b\\[[?>]?[0-9;]*\\$p|\\x1b\\[>[0-9;]*q|\\x1b\\[\\?u|\\x1b\\[1[4689]t|\\x1b\\[2[01]t|\\x1b\\][0-9]+(?:;[0-9]+)?;\\?(?:\\x07|\\x1b\\\\)|\\x1bP[$+]q[^\\x1b]*\\x1b\\\\')
base = sys.argv[1]
created_at = int(time.time() * 1000)

def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

def size_read(signum, frame):
    try:
        with open(base + '.size') as f:
            cols, rows = f.read().split()[:2]
        resize(int(cols), int(rows))
    except (OSError, ValueError, OverflowError, struct.error):
        pass

def meta_write():
    with open(base + '.json.part', 'w') as f:
        json.dump({'pid': os.getpid(), 'shell_pid': pid, 'created_at': created_at, 'clients': len(clients)}, f)
    os.replace(base + '.json.part', base + '.json')

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[4], sys.argv[4:])
signal.signal(signal.SIGHUP, signal.SIG_IGN)
signal.signal(signal.SIGTERM, lambda signum, frame: os.kill(pid, signal.SIGHUP))
resize(int(sys.argv[2]), int(sys.argv[3]))
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    os.unlink(base + '.sock')
except OSError:
    pass
server.bind(base + '.sock')
os.chmod(base + '.sock', 0o600)
server.listen(8)
signal.signal(signal.SIGWINCH, size_read)
history = bytearray()
clients = []
meta_write()
try:
    while True:
        try:
            ready, _, _ = select.select([server, fd] + clients, [], [])
        except InterruptedError:
            continue
        if server in ready:
            client, _ = server.accept()
            try:
                client.sendall(QUERIES.sub(b'', bytes(history)))
                clients.append(client)
            except OSError:
                client.close()
            meta_write()
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            history += data
            if len(history) > HISTORY:
                # Cut at a line, so the first thing replayed is not half an escape
                cut = history.find(b'\\n', len(history) - HISTORY)
                del history[:(cut + 1 if cut != -1 else len(history) - HISTORY)]
            for client in list(clients):
                try:
                    client.sendall(data)
                except OSError:
                    clients.remove(client)
                    client.close()
                    meta_write()
        for client in [v for v in clients if v in ready]:
            try:
                data = client.recv(65536)
            except OSError:
                data = b''
            if data:
                os.write(fd, data)
            else:
                clients.remove(client)
                client.close()
                meta_write()
finally:
    for path in [base + '.sock', base + '.json', base + '.size']:
        try:
            os.unlink(path)
        except OSError:
            pass
    try:
        os.waitpid(pid, 0)
    except OSError:
        pass
`;

module.exports = agent_term_holder_py;
