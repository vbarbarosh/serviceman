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
