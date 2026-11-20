// The process that keeps a terminal alive on the machine: it forks the shell under a pty,
// listens on a socket file, and outlives whoever started it — the page, serviceman, the agent.
// It keeps the last HISTORY bytes the shell printed. Every byte and every size goes to the
// machine's keeper too (agent_term_keeper, the socket SERVICEMAN_TERM_KEEPER names), which keeps
// the screen as it stands: one who joins is handed that screen and the lines above it, then the
// live bytes. Without a keeper, or one that does not answer in time, a join is handed the
// history as printed, so the page's own terminal scrolls back through it; the questions programs
// asked the terminal are left out of that replay (QUERIES): they were answered when they were
// asked.
//
// It waits for no one. A reader that takes slower than the shell prints has a backlog of its
// own here, and one further behind than the history is let go: it is sent no more, its socket
// says so, and joined again it is handed the history, as anyone who joins. So a reader that
// stopped reading (a page left open on a laptop asleep) holds up neither the program nor the
// other readers. What is typed waits the same way for a program that is not reading.
//
// The socket carries the terminal as it is, bytes both ways, so `socat` joins it by hand. The
// size is not in the stream: it is written to the .size file and the holder is sent SIGWINCH,
// and takes it once what the shell printed at the old size is passed on. The .json beside it says who it is and how many are joined. Ending the shell ends the holder
// and takes its files with it, as closing a window does: what the shell left running in the
// background may hold the terminal on, and is left to run without it.
//
//     python3 -c agent_term_holder_py <base> <cols> <rows> <argv...>
const agent_term_holder_py = `
import fcntl, json, os, pty, re, select, signal, socket, struct, sys, termios, time

HISTORY = 1 << 20
# The keeper of the machine's screens, and how long a join waits for its screen
KEEPER = os.environ.pop('SERVICEMAN_TERM_KEEPER', '')
KEEPER_WAIT = 2
# How long a reader that was behind when the shell ended may take nothing before it is left
PARTING = 5
# What a program asks the terminal and the terminal answers: its kind (DA), a report of its
# state (DSR, DECRQM, DECRQSS, XTGETTCAP, XTVERSION, window size), its colours (OSC 4/10/11/12
# with ?). Asked again on a replay, a joined terminal would answer each of them into the
# shell's input, where they show as typed text.
QUERIES = re.compile(rb'\\x1b\\[[>=]?[0-9;]*c|\\x1b\\[\\??[0-9;]*n|\\x1b\\[[?>]?[0-9;]*\\$p|\\x1b\\[>[0-9;]*q|\\x1b\\[\\?u|\\x1b\\[1[4689]t|\\x1b\\[2[01]t|\\x1b\\][0-9]+(?:;[0-9]+)?;\\?(?:\\x07|\\x1b\\\\)|\\x1bP[$+]q[^\\x1b]*\\x1b\\\\')
base = sys.argv[1]
created_at = int(time.time() * 1000)

def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    size[0], size[1] = cols, rows
    keeper_send(b'S', struct.pack('>HH', cols, rows))

# SIGWINCH says the .size file changed: the loop takes it, after what the shell printed at the
# old size, so the keeper draws each byte at the size it was printed at
def size_asked(signum, frame):
    asked[0] = True

def size_read():
    asked[0] = False
    while select.select([fd], [], [], 0)[0]:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        pass_on(data)
    try:
        with open(base + '.size') as f:
            cols, rows = f.read().split()[:2]
        resize(int(cols), int(rows))
    except (OSError, ValueError, OverflowError, struct.error):
        pass

def meta_write():
    with open(base + '.json.part', 'w') as f:
        json.dump({'pid': os.getpid(), 'shell_pid': pid, 'created_at': created_at, 'clients': len([v for v in clients.values() if v is not None])}, f)
    os.replace(base + '.json.part', base + '.json')

def pass_on(data):
    global history
    keeper_send(b'D', data)
    history += data
    if len(history) > HISTORY:
        # Cut at a line, so the first thing replayed is not half an escape
        cut = history.find(b'\\n', len(history) - HISTORY)
        del history[:(cut + 1 if cut != -1 else len(history) - HISTORY)]
    for client in list(clients):
        client_send(client, data)

# No reader is waited for. What its socket does not take at once waits in its backlog and goes
# out as the socket takes it, in order; with more than the history waiting the reader is let go.
def client_send(client, data):
    waiting = clients[client]
    if waiting is None:
        return
    waiting += data
    try:
        del waiting[:client.send(waiting)]
    except BlockingIOError:
        pass
    except OSError:
        client_drop(client)
        return
    if len(waiting) > HISTORY:
        client_let_go(client)

# A reader let go is sent no more, and its socket ends there: joined again it is handed the
# history, as anyone who joins. What it types is still taken until it closes the socket, so a
# Ctrl-C pressed before it has read that far is not lost.
def client_let_go(client):
    clients[client] = None
    try:
        client.shutdown(socket.SHUT_WR)
    except OSError:
        pass
    meta_write()

def client_drop(client):
    del clients[client]
    client.close()
    meta_write()

# The pty is not waited for either: what a program that is not reading has not taken stays in
# typed, and goes in as the pty takes it. A pty that is gone takes nothing: reading it ends
# the loop.
def typed_write():
    try:
        del typed[:os.write(fd, typed)]
    except BlockingIOError:
        pass
    except OSError:
        typed.clear()

# What the shell printed last (its "logout") is still on its way when it ends: it is passed on,
# and nothing more is waited for
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
        pass_on(data)

# The keeper's socket while it takes what is sent, and what it has not taken yet. A frame is a
# kind, H hello, D bytes, S size or Q the screen asked for, its length (4 bytes) and its payload;
# the keeper answers a Q with an A frame. One that takes too little is let go, and joined again.
keeper = [None]
keeper_out = bytearray()

def keeper_connect():
    if (KEEPER == '') or (keeper[0] is not None):
        return
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        s.settimeout(1)
        s.connect(KEEPER)
    except OSError:
        s.close()
        return
    s.setblocking(False)
    keeper[0] = s
    keeper_out.clear()
    keeper_send(b'H', json.dumps({'name': os.path.basename(base), 'cols': size[0], 'rows': size[1]}).encode())
    # Joined late (the keeper was down), it starts from the history: the best there is
    if history:
        keeper_send(b'D', bytes(history))

def keeper_send(kind, payload):
    if keeper[0] is None:
        return
    keeper_out.extend(kind + struct.pack('>I', len(payload)) + payload)
    keeper_flush()
    if len(keeper_out) > 2 * HISTORY:
        keeper_drop()

def keeper_flush():
    if (keeper[0] is None) or (not keeper_out):
        return
    try:
        del keeper_out[:keeper[0].send(keeper_out)]
    except BlockingIOError:
        pass
    except OSError:
        keeper_drop()

def keeper_drop():
    if keeper[0] is not None:
        keeper[0].close()
    keeper[0] = None
    keeper_out.clear()

# The screen as it stands and the lines above it, drawn by the keeper. Everything passed on so
# far went to it first, so it is the screen at this very byte. None with no keeper, or one that
# does not answer in time: the join is handed the history then.
def keeper_screen():
    keeper_connect()
    if keeper[0] is None:
        return None
    keeper_send(b'Q', b'')
    deadline = time.time() + KEEPER_WAIT
    answer = bytearray()
    try:
        while (keeper[0] is not None) and keeper_out:
            if deadline <= time.time():
                raise TimeoutError()
            select.select([], [keeper[0]], [], deadline - time.time())
            keeper_flush()
        while keeper[0] is not None:
            if len(answer) >= 5:
                length = struct.unpack('>I', bytes(answer[1:5]))[0]
                if len(answer) >= 5 + length:
                    return bytes(answer[5:5 + length]) if answer[0:1] == b'A' else None
            if deadline <= time.time():
                raise TimeoutError()
            if not select.select([keeper[0]], [], [], deadline - time.time())[0]:
                continue
            data = keeper[0].recv(65536)
            if not data:
                keeper_drop()
                return None
            answer += data
    except (TimeoutError, OSError):
        keeper_drop()
    return None

history = bytearray()
size = [int(sys.argv[2]), int(sys.argv[3])]
asked = [False]
# Who is joined, each with what its socket has not taken yet; None once it was let go
clients = {}
typed = bytearray()
# The shell's end wakes the loop below: SIGCHLD writes a byte into this pipe
wake_r, wake_w = os.pipe()
os.set_blocking(wake_w, False)
signal.set_wakeup_fd(wake_w)
signal.signal(signal.SIGCHLD, lambda signum, frame: None)
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[4], sys.argv[4:])
os.set_blocking(fd, False)
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
signal.signal(signal.SIGWINCH, size_asked)
keeper_connect()
meta_write()
try:
    while True:
        try:
            # What readers type is read once the pty has taken what was typed before: until
            # then it waits in their sockets, so no more than one read of it waits here
            ready, free, _ = select.select([server, fd, wake_r] + ([] if typed else list(clients)) + ([] if keeper[0] is None else [keeper[0]]), ([fd] if typed else []) + [v for v in clients if clients[v]] + ([keeper[0]] if keeper_out else []), [])
        except InterruptedError:
            continue
        if asked[0]:
            size_read()
        if (keeper[0] is not None) and (keeper[0] in ready):
            # The keeper says nothing unasked: what it sends now is its end
            try:
                if not keeper[0].recv(65536):
                    keeper_drop()
            except BlockingIOError:
                pass
            except OSError:
                keeper_drop()
        if (keeper[0] is not None) and (keeper[0] in free):
            keeper_flush()
        if wake_r in ready:
            os.read(wake_r, 256)
            if os.waitpid(pid, os.WNOHANG)[0] == pid:
                last_words()
                break
        if server in ready:
            client, _ = server.accept()
            client.setblocking(False)
            clients[client] = bytearray()
            screen = keeper_screen()
            client_send(client, QUERIES.sub(b'', bytes(history)) if screen is None else screen)
            meta_write()
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except BlockingIOError:
                continue
            except OSError:
                break
            if not data:
                break
            pass_on(data)
        for client in [v for v in clients if v in ready]:
            if typed:
                break
            try:
                data = client.recv(65536)
            except BlockingIOError:
                continue
            except OSError:
                data = b''
            if data:
                typed += data
                typed_write()
            else:
                client_drop(client)
        if fd in free:
            typed_write()
        for client in [v for v in clients if v in free]:
            client_send(client, b'')
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
# The terminal is over and its files are gone. A reader that was behind is given what it has
# not taken yet for as long as it takes some of it, and the shell's pid may be someone else's
# by now: a SIGTERM hangs up no one
signal.signal(signal.SIGTERM, signal.SIG_DFL)
behind = [v for v in clients if clients[v]]
while behind:
    free = select.select([], behind, [], PARTING)[1]
    if not free:
        break
    for client in free:
        try:
            del clients[client][:client.send(clients[client])]
        except BlockingIOError:
            pass
        except OSError:
            clients[client].clear()
    behind = [v for v in behind if clients[v]]
`;

module.exports = agent_term_holder_py;
