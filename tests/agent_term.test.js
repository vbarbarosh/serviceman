const agent_bundle = require('../src/agent/bundler/agent_bundle');
const agent_machine_shell = require('../src/agent/src/agent_machine_shell');
const agent_term_end = require('../src/agent/src/agent_term_end');
const agent_term_join = require('../src/agent/src/agent_term_join');
const agent_term_keeper_start = require('../src/agent/src/agent_term_keeper_start');
const agent_term_read = require('../src/agent/src/agent_term_read');
const agent_term_signal = require('../src/agent/src/agent_term_signal');
const agent_term_start = require('../src/agent/src/agent_term_start');
const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const pty_spawn = require('../src/web-terminal/src/pty_spawn');
const test = require('node:test');

const {Terminal} = require('@xterm/headless');

// The shell is left with a job in the background, which holds the terminal on, and exits: the
// terminal ends with the shell, as a window does, its last words passed on, and the job runs on
const LEAVE_A_JOB = 'sleep 60 & echo "job $!"; exit\n';

test('a kept terminal ends with its shell, though a job it left holds the terminal on', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('work', 80, 24, {}, dir);
    const found = agent_term_read('work');
    const socket = net.connect(`${found.base}.sock`);
    let heard = '';
    socket.on('data', v => heard += v.toString('utf8'));
    socket.on('error', function () {});
    socket.write(LEAVE_A_JOB);
    await until(() => (agent_term_read('work') === null), 10000, 'the end of the terminal');
    await until(() => /logout|exit/.test(heard), 2000, 'the shell\'s last words');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(found.base)), []);
    job_still_running(t, heard);
    socket.destroy();
});

test('a holder from before the fix, its shell gone, is ended with its files', async function (t) {
    agent_dir(t);
    const base = path.join(process.env.SERVICEMAN_AGENT_DIR, 'terminals', 'old');
    fs.mkdirSync(path.dirname(base), {recursive: true});
    // As the old holder after its shell's logout: the shell a zombie, a hang-up ignored, the
    // socket still open
    const holder = child_process.spawn('python3', ['-c', `
import json, os, signal, socket, sys, time
base = sys.argv[1]
signal.signal(signal.SIGTERM, signal.SIG_IGN)
pid = os.fork()
if pid == 0:
    os._exit(0)
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(base + '.sock')
with open(base + '.json', 'w') as f:
    json.dump({'pid': os.getpid(), 'shell_pid': pid, 'created_at': 0, 'clients': 0}, f)
time.sleep(60)
`, base], {stdio: 'ignore'});
    t.after(() => holder.kill('SIGKILL'));
    await until(() => (agent_term_read('old') !== null), 5000, 'the old holder');
    assert.deepStrictEqual(await agent_term_end({name: 'old'}), {ended: true});
    await until(() => (holder.exitCode !== null) || (holder.signalCode !== null), 5000, 'the end of the old holder');
    assert.strictEqual(agent_term_read('old'), null);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(base)), []);
});

// Every join set a running terminal to 80×24 until its page sent a resize, so each short join
// (a read, a line typed) drew the program again small and back, into its history too. A join
// that names no size now leaves the terminal at its own; one that names it, or a resize, sets it.
test('a join that names no size leaves a running terminal at its own size', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('sized', 120, 40, {}, dir);
    t.after(() => agent_term_end({name: 'sized'}));
    const first = join_reading(t, {name: 'sized'});
    first.join.write('stty size\n');
    await until(() => (sizes_said(first.heard).length === 1), 5000, 'the size it started at');
    assert.deepStrictEqual(sizes_said(first.heard), ['40 120']);
    const named = join_reading(t, {name: 'sized', cols: 100, rows: 30});
    named.join.write('stty size\n');
    await until(() => (sizes_said(named.heard).length === 2), 5000, 'the size a join named');
    assert.deepStrictEqual(sizes_said(named.heard), ['40 120', '30 100'], 'its history first, then the size it named');
    const plain = join_reading(t, {name: 'sized'});
    plain.join.write('stty size\n');
    await until(() => (sizes_said(plain.heard).length === 3), 5000, 'the size a join that names none finds');
    assert.deepStrictEqual(sizes_said(plain.heard), ['40 120', '30 100', '30 100'], 'kept as it was');
    plain.join.resize(90, 20);
    plain.join.write('stty size\n');
    await until(() => (sizes_said(plain.heard).length === 4), 5000, 'the size of a joiner\'s own resize');
    assert.strictEqual(sizes_said(plain.heard)[3], '20 90');
});

// What `stty size` answered in a terminal's output, in order: "rows cols" each, on a line of its
// own once the escapes are taken out (the shell's title, its bracketed paste, systemd's marks
// around each command)
function sizes_said(heard)
{
    const text = heard.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    return [...text.matchAll(/(?:^|[\r\n])([0-9]+ [0-9]+)\r\n/g)].map(v => v[1]);
}

// A program that draws by moves (an inline one, as Claude Code's classic screen) draws a frame
// over itself, moving up by the rows it took at its width. Its bytes replayed into a terminal of
// another width land wrong: rows above the frame are drawn over. The keeper drew every byte at
// the size it was printed at, so a join is handed the screen as it stands.
test('a join is handed the screen as it stands, drawn by the machine\'s keeper', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('drawn', 80, 24, {}, dir);
    t.after(() => agent_term_end({name: 'drawn'}));
    const first = await frames_drawn(t, 'drawn');
    const later = join_reading(t, {name: 'drawn'});
    await until(() => later.heard.includes('frame 5'), 5000, 'the screen of a later join');
    const screen = await screen_of(later.heard, 160, 30);
    assert.ok(screen.includes('line 28') && screen.includes('line 29'), 'the rows above the frame are there');
    assert.strictEqual(screen.split('> frame').length - 1, 1, 'one frame, the last');
    assert.strictEqual(later.heard.includes('> frame 0'), false, 'the screen, not the bytes as printed');
    first.join.write('q');
});

test('a holder whose keeper is gone hands a join the history as printed, as before', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('alone', 80, 24, {}, dir);
    t.after(() => agent_term_end({name: 'alone'}));
    const first = await frames_drawn(t, 'alone');
    process.kill(keeper_pid(agent_term_keeper_start.socket_path()), 'SIGKILL');
    await until(() => (keeper_pid(agent_term_keeper_start.socket_path()) === null), 5000, 'the end of the keeper');
    fs.rmSync(agent_term_keeper_start.socket_path(), {force: true});
    const later = join_reading(t, {name: 'alone'});
    await until(() => later.heard.includes('frame 5'), 5000, 'the history of a later join');
    assert.ok(later.heard.includes('> frame 0'), 'the bytes as printed, every frame');
    first.join.write('q');
});

test('the agent\'s one file carries the keeper: a screen asked for is answered', async function (t) {
    const dir = agent_dir(t);
    const file = path.join(dir, 'agent.js');
    fs.writeFileSync(file, agent_bundle());
    const socket_path = path.join(dir, 'keeper.sock');
    const keeper = child_process.spawn(process.execPath, [file, '--term-keeper', socket_path], {stdio: 'ignore'});
    t.after(() => keeper.kill('SIGKILL'));
    await until(() => fs.existsSync(socket_path), 5000, 'the keeper\'s socket');
    const socket = net.connect({path: socket_path});
    t.after(() => socket.destroy());
    let answer = Buffer.alloc(0);
    socket.on('data', v => answer = Buffer.concat([answer, v]));
    socket.write(Buffer.concat([frame('H', JSON.stringify({name: 'x', cols: 20, rows: 4})), frame('D', 'one\r\ntwo\x1b[1A\rTWO'), frame('Q', '')]));
    await until(() => (answer.length >= 5) && (answer.length >= 5 + answer.readUInt32BE(1)), 5000, 'the screen');
    assert.strictEqual(String.fromCharCode(answer[0]), 'A');
    assert.strictEqual(await screen_of(answer.subarray(5).toString('utf8'), 20, 4), 'TWO\ntwo');
});

// A page left open on a laptop asleep is joined and reads nothing. The holder waited to write
// to it, and meanwhile passed nothing on, took nothing typed and answered no join: the build in
// that terminal stood still. It waits for no reader: the dark one falls further behind than the
// history and is let go, sent no more, and joined again is handed the history, as anyone who
// joins.
test('a kept terminal goes on while one joined to it reads nothing: the rest get every line, type and join', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('work', 80, 24, {}, dir);
    const found = agent_term_read('work');
    t.after(() => kill_quietly(found.shell_pid));
    const dark = reader_join(t, found);
    dark.socket.pause();
    const healthy = reader_join(t, found);
    await until(() => (agent_term_read('work').clients === 2), 5000, 'the two joins');
    // 30 000 lines, 2 MB: more than a socket holds for its reader, and more than the history
    healthy.socket.write('stty -echo; echo begin-$((40+2)); seq -f "line %.0f of the build, with some more of it to read: 0123456789" 1 30000; echo end-$((40+2))\n');
    await until(() => healthy.heard.includes('end-42\r\n'), 4000, 'the end of the loop');
    const lines = healthy.heard.slice(healthy.heard.indexOf('begin-42\r\n') + 10, healthy.heard.indexOf('end-42\r\n')).split('\r\n');
    assert.strictEqual(lines.length, 30001, 'every line for the reader that reads');
    assert.strictEqual(lines.findIndex((v, i) => (i < 30000) && (v.startsWith(`line ${i + 1} of the build`) === false)), -1, 'its lines in order');
    await until(() => (agent_term_read('work').clients === 1), 5000, 'the dark reader let go');

    // What the reader that reads types gets through, and a third join is answered
    healthy.socket.write('echo typed-$((40+2))\n');
    await until(() => healthy.heard.includes('typed-42\r\n'), 5000, 'the answer to what was typed');
    const third = reader_join(t, found);
    await until(() => third.heard.includes('typed-42\r\n'), 5000, 'the history for a third join');

    // The dark one has not read that it was let go: a key it presses is not lost. Then it
    // reads again, to the end of its socket. Joined again it has the screen as it stands and
    // the 1000 lines above it, whole and in order, up to the last thing printed
    dark.socket.write('echo late-$((40+2))\n');
    await until(() => healthy.heard.includes('late-42\r\n'), 5000, 'what the reader let go typed');
    dark.socket.resume();
    await until(() => dark.closed, 5000, 'the end of the socket of the reader let go');
    assert.strictEqual(dark.heard.includes('end-42\r\n'), false);
    const again = reader_join(t, found);
    await until(() => again.heard.includes('late-42'), 5000, 'the screen for the reader let go');
    const built = again.heard.split(/\r?\n/).map(v => v.match(/line ([0-9]+) of the build/)).filter(v => v !== null).map(v => parseInt(v[1], 10));
    assert.ok(built.length > 900, `the lines above the screen: ${built.length}`);
    assert.deepStrictEqual(built, built.map((v, i) => built[0] + i), 'whole lines, in order');
    assert.strictEqual(built[built.length - 1], 30000, 'up to the last one printed');
});

// More typed than a pty takes, into a program that reads nothing: the holder waited to write
// it, and nothing was passed on, so a program that went on printing stood still too. What the
// pty has not taken waits, one read of it in the holder and the rest in the socket it was
// typed into, the terminal goes on, and the program gets every byte of it when it reads.
test('a kept terminal goes on while its program takes nothing of what is typed, and nothing typed is lost', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('work', 80, 24, {}, dir);
    const found = agent_term_read('work');
    t.after(() => kill_quietly(found.shell_pid));
    const typing = reader_join(t, found);
    const stop = path.join(dir, 'stop');
    const saved = path.join(dir, 'saved.txt');
    typing.socket.write(`stty -echo; while [ ! -e ${stop} ]; do echo tick-$((n+=1)); sleep 0.02; done; cat > ${saved}; echo saved-$((40+2))\n`);
    await until(() => typing.heard.includes('tick-3\r\n'), 5000, 'the first ticks');
    // 280 KB of lines: a pty holds a hundred of them
    const typed = Array.from({length: 7000}, (v, i) => `typed line ${i + 1} and not read yet\n`).join('');
    typing.socket.write(`${typed}\x04`);
    const tick = parseInt(typing.heard.slice(typing.heard.lastIndexOf('tick-') + 5), 10);
    await until(() => typing.heard.includes(`tick-${tick + 20}\r\n`), 4000, 'the ticks after what was typed');
    const joined = reader_join(t, found);
    await until(() => joined.heard.includes(`tick-${tick + 20}\r\n`), 5000, 'the history for one who joins meanwhile');
    fs.writeFileSync(stop, '');
    await until(() => typing.heard.includes('saved-42\r\n'), 5000, 'the program reading what was typed');
    assert.strictEqual(fs.readFileSync(saved, 'utf8'), typed);
});

// A reader behind when the shell ends: the holder waited for it before it took its files away,
// so a terminal whose shell was gone stayed in the list. It ends at once now, and the reader is
// still given what it had not taken, the shell's last words too.
test('a kept terminal ends with its shell while a reader is behind, and that reader still gets the rest', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('work', 80, 24, {}, dir);
    const found = agent_term_read('work');
    t.after(() => kill_quietly(found.shell_pid));
    const behind = reader_join(t, found);
    await until(() => (agent_term_read('work').clients === 1), 5000, 'the join');
    behind.socket.pause();
    // 0.7 MB: more than a socket holds for its reader, less than the history
    behind.socket.write('stty -echo; echo begin-$((40+2)); seq 1 100000; echo end-$((40+2)); exit\n');
    await until(() => (agent_term_read('work') === null), 5000, 'the end of the terminal');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(found.base)), []);
    behind.socket.resume();
    await until(() => behind.closed, 5000, 'the close for the reader');
    const lines = behind.heard.slice(behind.heard.indexOf('begin-42\r\n') + 10, behind.heard.indexOf('end-42\r\n')).split('\r\n');
    assert.strictEqual(lines.length, 100001, 'every line');
    assert.strictEqual(lines.findIndex((v, i) => (i < 100000) && (v !== String(i + 1))), -1, 'the lines in order');
    assert.match(behind.heard.slice(behind.heard.indexOf('end-42\r\n')), /logout|exit/, 'the shell\'s last words');
});

test('a machine shell and a web terminal close with their shell, though a job it left holds the pty on', async function (t) {
    const shells = {
        machine: agent_machine_shell({cols: 80, rows: 24}),
        web: pty_spawn(['bash', '--norc', '--noprofile', '-i']),
    };
    for (const [name, shell] of Object.entries(shells)) {
        let heard = '';
        let closed = false;
        shell.on('data', v => heard += v.toString('utf8'));
        shell.on('close', () => closed = true);
        shell.write(LEAVE_A_JOB);
        await until(() => closed, 10000, `the close of the ${name} shell`);
        job_still_running(t, heard);
    }
});

// A pane that reads slower than the program prints holds the terminal back (terminal_attach).
// Held, it hands over no more and its program waits to print; let go, it goes on where it
// stopped. A web terminal had no way to be held: the first pane that fell behind ended it.
test('a machine shell and a web terminal held back print no more, their program waits, and they go on in order', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'held-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const shells = {
        machine: agent_machine_shell({cols: 80, rows: 24}),
        web: pty_spawn(['bash', '--norc', '--noprofile', '-i']),
    };
    for (const [name, shell] of Object.entries(shells)) {
        t.after(() => shell.destroy());
        const done = path.join(dir, name);
        let heard = '';
        let held = null;
        shell.on('data', function (chunk) {
            heard += chunk.toString('latin1');
            if ((held === null) && heard.includes('begin-42\r\n')) {
                shell.pause();
                held = heard.length;
            }
        });
        // 2 MB of lines, which a pty passes on in a moment when nobody holds it
        shell.write(`stty -echo; echo begin-$((40+2)); seq 1 300000; touch ${done}; echo end-$((40+2))\n`);
        await until(() => (held !== null), 10000, `the first lines of the ${name} shell`);
        await new Promise(v => setTimeout(v, 500));
        assert.strictEqual(heard.length, held, `the ${name} shell hands over no more while it is held`);
        assert.strictEqual(fs.existsSync(done), false, `the program of the ${name} shell waits to print`);
        shell.resume();
        await until(() => heard.includes('end-42\r\n'), 10000, `the rest of the ${name} shell`);
        const lines = heard.slice(heard.indexOf('begin-42\r\n') + 10, heard.indexOf('end-42\r\n')).split('\r\n');
        assert.strictEqual(lines.length, 300001, `every line of the ${name} shell`);
        assert.strictEqual(lines.findIndex((v, i) => (i < 300000) && (v !== String(i + 1))), -1, `the lines of the ${name} shell in order`);
    }
});

test('a signal to the session reaches the jobs the shell left in the background', async function (t) {
    const dir = agent_dir(t);
    await agent_term_start('work', 80, 24, {}, dir);
    const found = agent_term_read('work');
    const socket = net.connect(`${found.base}.sock`);
    t.after(() => socket.destroy());
    let heard = '';
    socket.on('data', v => heard += v.toString('utf8'));
    socket.on('error', function () {});
    socket.write('sleep 600 & echo "job $!"\n');
    await until(() => /job \d+/.test(heard), 5000, 'the job');
    const job = job_still_running(t, heard);
    const answer = await agent_term_signal({name: 'work', signal: 'SIGKILL', to: 'session'});
    assert.strictEqual(answer.to, 'session');
    assert.ok(answer.pgids.includes(found.shell_pid), `the shell's group in ${answer.pgids}`);
    assert.ok(answer.pgids.includes(job), `the job's group in ${answer.pgids}`);
    await until(() => process_gone(job), 5000, 'the end of the job');
    await until(() => (agent_term_read('work') === null), 10000, 'the end of the terminal');
});

test('a signal to the session reaches a job its shell left, the shell gone and its holder old', async function (t) {
    agent_dir(t);
    const base = path.join(process.env.SERVICEMAN_AGENT_DIR, 'terminals', 'old');
    fs.mkdirSync(path.dirname(base), {recursive: true});
    // As the old holder after its shell's logout: the shell a zombie, leading a session where
    // a job of its own group runs on
    const holder = child_process.spawn('python3', ['-c', `
import json, os, socket, sys, time
base = sys.argv[1]
pid = os.fork()
if pid == 0:
    os.setsid()
    job = os.fork()
    if job == 0:
        os.setpgid(0, 0)
        os.execvp('sleep', ['sleep', '600'])
    with open(base + '.job', 'w') as f:
        f.write(str(job))
    os._exit(0)
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(base + '.sock')
with open(base + '.json', 'w') as f:
    json.dump({'pid': os.getpid(), 'shell_pid': pid, 'created_at': 0, 'clients': 0}, f)
time.sleep(60)
`, base], {stdio: 'ignore'});
    t.after(() => holder.kill('SIGKILL'));
    await until(() => (agent_term_read('old') !== null) && fs.existsSync(`${base}.job`), 5000, 'the old holder and its job');
    const job = parseInt(fs.readFileSync(`${base}.job`, 'utf8'), 10);
    t.after(() => kill_quietly(job));
    assert.strictEqual(process_gone(job), false);
    const answer = await agent_term_signal({name: 'old', signal: 'SIGKILL', to: 'session'});
    assert.ok(answer.pgids.includes(job), `the job's group in ${answer.pgids}`);
    await until(() => process_gone(job), 5000, 'the end of the job');
    assert.strictEqual(holder.exitCode, null, 'the holder is no part of the session');
});

test('a signal to the session of a shell whose pid is someone else\'s now reaches no one', async function (t) {
    agent_dir(t);
    const base = path.join(process.env.SERVICEMAN_AGENT_DIR, 'terminals', 'stale');
    fs.mkdirSync(path.dirname(base), {recursive: true});
    // A session led by a process the holder never started, under the pid its note names
    const stranger = child_process.spawn('sleep', ['60'], {detached: true, stdio: 'ignore'});
    t.after(() => kill_quietly(stranger.pid));
    const holder = child_process.spawn('python3', ['-c', `
import json, os, socket, sys, time
base = sys.argv[1]
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(base + '.sock')
with open(base + '.json', 'w') as f:
    json.dump({'pid': os.getpid(), 'shell_pid': int(sys.argv[2]), 'created_at': 0, 'clients': 0}, f)
time.sleep(60)
`, base, String(stranger.pid)], {stdio: 'ignore'});
    t.after(() => holder.kill('SIGKILL'));
    await until(() => (agent_term_read('stale') !== null), 5000, 'the holder');
    const answer = await agent_term_signal({name: 'stale', signal: 'SIGKILL', to: 'session'});
    assert.deepStrictEqual(answer.pgids, []);
    assert.strictEqual(process_gone(stranger.pid), false);
});

test('a signal goes to the shell, the foreground or the session, and nowhere else', async function () {
    await assert.rejects(agent_term_signal({name: 'work', signal: 'SIGHUP', to: 'everyone'}), /shell, foreground or session/);
});

// SERVICEMAN_AGENT_DIR, a new folder for this test only, put back after it
function agent_dir(t)
{
    const before = process.env.SERVICEMAN_AGENT_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-term-'));
    process.env.SERVICEMAN_AGENT_DIR = dir;
    t.after(function () {
        if (before === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = before;
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    return dir;
}

// A terminal running frames_by_moves: three frames drawn at 80 columns, then three at 160, the
// size a join of its own asked for; that join, joined still
async function frames_drawn(t, name)
{
    const first = join_reading(t, {name});
    first.join.write(`node ${path.join(__dirname, 'fixtures', 'frames_by_moves.js')}\n`);
    await until(() => first.heard.includes('line 29'), 5000, 'the program\'s lines');
    for (let i = 0; i < 6; i++) {
        if (i === 3) {
            first.join.resize(160, 30);
            await new Promise(v => setTimeout(v, 300));
        }
        first.join.write(' ');
        await until(() => first.heard.includes(`frame ${i}`), 5000, `frame ${i}`);
    }
    return first;
}

// What a terminal of this size shows, the lines above its screen too, once these bytes are drawn
function screen_of(bytes, cols, rows)
{
    return new Promise(function (resolve) {
        const terminal = new Terminal({cols, rows, scrollback: 1000, allowProposedApi: true});
        terminal.write(bytes, function () {
            const buffer = terminal.buffer.active;
            const lines = [];
            for (let i = 0; i < buffer.length; i++) {
                lines.push(buffer.getLine(i).translateToString(true));
            }
            terminal.dispose();
            resolve(lines.join('\n').replace(/\n+$/, ''));
        });
    });
}

// A frame to the keeper: its kind, its payload's length, its payload
function frame(kind, payload)
{
    const body = Buffer.from(payload, 'utf8');
    const head = Buffer.alloc(5);
    head.write(kind, 0);
    head.writeUInt32BE(body.length, 1);
    return Buffer.concat([head, body]);
}

// The pid of the keeper at this socket, or null when none runs
function keeper_pid(socket_path)
{
    for (const entry of fs.readdirSync('/proc')) {
        if (/^[0-9]+$/.test(entry) === false) {
            continue;
        }
        let cmdline;
        try {
            cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0');
        }
        catch {
            continue;
        }
        if (cmdline.includes('--term-keeper') && cmdline.includes(socket_path) && (process_gone(parseInt(entry, 10)) === false)) {
            return parseInt(entry, 10);
        }
    }
    return null;
}

// One joined to a kept terminal as a tunnelled stream is (agent_term_join), left after the test:
// what it heard
function join_reading(t, target)
{
    const out = {join: agent_term_join(target), heard: ''};
    t.after(() => out.join.destroy());
    out.join.on('data', v => out.heard += v.toString('utf8'));
    out.join.on('error', function () {});
    return out;
}

// One joined to a kept terminal by its socket, left after the test: what it heard, and whether
// its socket was closed
function reader_join(t, found)
{
    const out = {socket: net.connect(`${found.base}.sock`), heard: '', closed: false};
    t.after(() => out.socket.destroy());
    out.socket.on('data', v => out.heard += v.toString('latin1'));
    out.socket.on('close', () => out.closed = true);
    out.socket.on('error', function () {});
    return out;
}

// The job a shell said it left ("job <pid>") is running, and is stopped after the test
function job_still_running(t, heard)
{
    const match = heard.match(/job (\d+)/);
    assert.notStrictEqual(match, null, `no job in ${JSON.stringify(heard)}`);
    const pid = parseInt(match[1], 10);
    t.after(() => kill_quietly(pid));
    process.kill(pid, 0);
    return pid;
}

// True when `pid` has ended: gone, or a zombie nobody has waited for yet
function process_gone(pid)
{
    let text;
    try {
        text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    }
    catch {
        return true;
    }
    return (text.slice(text.lastIndexOf(')') + 2, text.lastIndexOf(')') + 3) === 'Z');
}

function kill_quietly(pid)
{
    try {
        process.kill(pid, 'SIGKILL');
    }
    catch {
        // It went already
    }
}

function until(check, limit_ms, what)
{
    return new Promise(function (resolve, reject) {
        const began = Date.now();
        (function look() {
            if (check()) {
                resolve();
                return;
            }
            if ((Date.now() - began) > limit_ms) {
                reject(new Error(`${what} did not come within ${limit_ms}ms`));
                return;
            }
            setTimeout(look, 50);
        })();
    });
}
