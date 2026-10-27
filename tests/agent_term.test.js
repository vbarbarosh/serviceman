const agent_machine_shell = require('../src/agent/src/agent_machine_shell');
const agent_term_end = require('../src/agent/src/agent_term_end');
const agent_term_read = require('../src/agent/src/agent_term_read');
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
    t.after(function () {
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch {
            // It went already
        }
    });
    process.kill(pid, 0);
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
