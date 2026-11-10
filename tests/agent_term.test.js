const agent_machine_shell = require('../src/agent/src/agent_machine_shell');
const agent_term_end = require('../src/agent/src/agent_term_end');
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
    // reads again, to the end of its socket. Joined again it has the last megabyte, from the
    // start of a line to the last thing printed
    dark.socket.write('echo late-$((40+2))\n');
    await until(() => healthy.heard.includes('late-42\r\n'), 5000, 'what the reader let go typed');
    dark.socket.resume();
    await until(() => dark.closed, 5000, 'the end of the socket of the reader let go');
    assert.strictEqual(dark.heard.includes('end-42\r\n'), false);
    const again = reader_join(t, found);
    await until(() => again.heard.includes('late-42\r\n'), 5000, 'the history for the reader let go');
    const replayed = again.heard.slice(0, again.heard.indexOf('end-42\r\n')).split('\r\n');
    const first = 30001 - (replayed.length - 1);
    assert.ok((again.heard.length <= (1 << 20)) && (again.heard.length > (1 << 20) - 1024), `a megabyte of history: ${again.heard.length}`);
    assert.strictEqual(replayed.findIndex((v, i) => (i < replayed.length - 1) && (v.startsWith(`line ${first + i} of the build`) === false)), -1, 'whole lines, in order');
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
