const agent_xterm_headless = require('./agent_xterm_headless');
const agent_xterm_serialize = require('./agent_xterm_serialize');
const fs = require('fs');
const net = require('net');

// The lines kept above a terminal's screen, and handed to one who joins with it
const SCROLLBACK = 1000;

// How long the keeper stays with no terminal to keep before it ends, and how often it looks
// whether its socket is still there: a folder of terminals removed takes the keeper with it
const IDLE_MS = 60000;
const LOOK_MS = 5000;

// The keeper of the screens of the terminals kept on this machine: one process beside their
// holders, which outlives the agent as they do. Each holder sends it every byte its shell prints
// and every size it takes, in order, and it draws them into a terminal with no screen of its
// own, so it has each one's screen as it stands. A join asks the holder, the holder asks the
// keeper, and is handed that screen and the lines above it, where the bytes as printed, drawn
// at other sizes and cut mid-drawing, would come out garbled. A holder that loses it goes on
// without it, and its joins are handed the history as before.
//
// A frame is a kind, its payload's length (4 bytes, big-endian) and its payload: H a hello,
// {name, cols, rows} as json, first; D bytes as printed; S a size, cols and rows (2 bytes
// each); Q the screen asked for, answered with A and the bytes that draw it.
//
//     node <agent> --term-keeper <socket>
async function agent_term_keeper(socket_path)
{
    let holders = 0;
    let idle = null;
    // Two started at once: the second finds the first answering, and leaves
    if (await answers(socket_path)) {
        return;
    }
    try {
        fs.unlinkSync(socket_path);
    }
    catch {
        // There was none
    }
    const server = net.createServer(function (socket) {
        holders++;
        clearTimeout(idle);
        holder_serve(socket, function () {
            holders--;
            idle_check();
        });
    });
    server.listen(socket_path, function () {
        fs.chmodSync(socket_path, 0o600);
        idle_check();
        setInterval(function () {
            if (fs.existsSync(socket_path) === false) {
                process.exit(0);
            }
        }, LOOK_MS).unref();
    });
    function idle_check() {
        clearTimeout(idle);
        if (holders > 0) {
            return;
        }
        idle = setTimeout(function () {
            server.close();
            try {
                fs.unlinkSync(socket_path);
            }
            catch {
                // Gone already
            }
            process.exit(0);
        }, IDLE_MS);
    }
}

// One holder's frames, taken in the order they came: a screen asked for after some bytes is the
// screen with those bytes drawn
function holder_serve(socket, done)
{
    let pending = Buffer.alloc(0);
    let screen = null;
    let queue = Promise.resolve();
    socket.on('data', function (chunk) {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 5) {
            const length = pending.readUInt32BE(1);
            if (pending.length < 5 + length) {
                break;
            }
            const kind = String.fromCharCode(pending[0]);
            const payload = pending.subarray(5, 5 + length);
            pending = pending.subarray(5 + length);
            queue = queue.then(() => frame_take(kind, payload));
        }
    });
    socket.on('error', function () {
        // The holder went: its end comes as close
    });
    socket.on('close', function () {
        queue = queue.then(function () {
            if (screen !== null) {
                screen.terminal.dispose();
            }
            done();
        });
    });
    async function frame_take(kind, payload) {
        if (kind === 'H') {
            const hello = JSON.parse(payload.toString('utf8'));
            screen = screen_make(hello.cols, hello.rows);
            return;
        }
        if (screen === null) {
            return;
        }
        if (kind === 'D') {
            await new Promise(v => screen.terminal.write(payload, v));
        }
        else if (kind === 'S') {
            screen.terminal.resize(payload.readUInt16BE(0), payload.readUInt16BE(2));
        }
        else if (kind === 'Q') {
            const text = Buffer.from(screen.serialize.serialize({scrollback: SCROLLBACK}), 'utf8');
            const head = Buffer.alloc(5);
            head.write('A', 0);
            head.writeUInt32BE(text.length, 1);
            socket.write(Buffer.concat([head, text]));
        }
    }
}

function answers(socket_path)
{
    return new Promise(function (resolve) {
        const socket = net.connect({path: socket_path});
        socket.once('connect', function () {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
    });
}

function screen_make(cols, rows)
{
    const terminal = new agent_xterm_headless.Terminal({cols, rows, scrollback: SCROLLBACK, allowProposedApi: true});
    const serialize = new agent_xterm_serialize.SerializeAddon();
    terminal.loadAddon(serialize);
    return {terminal, serialize};
}

module.exports = agent_term_keeper;
