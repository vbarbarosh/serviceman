const assert = require('assert');
const child_process = require('child_process');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const LINES = path.join(__dirname, '..', 'logline', 'lines', 'index.js');
const MAIN = path.join(__dirname, '..', 'src', 'main', 'index.js');

// stdout under a pipe may lose its reader. The line written after that comes back as an error
// on the stream, a moment later: the writer listens for it, and tries no line there again.
test('a line is written to stdout or stderr until that stream refuses one, and never after', function () {
    const ran = child_process.spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'std_line_said.js')], {encoding: 'utf8'});
    assert.deepStrictEqual([ran.status, JSON.parse(ran.stdout)], [0, [['stdout', 'one'], ['stderr', 'two'], ['stderr', 'four']]]);
});

// The real process, its stdout a pipe whose reader goes: the next line of the log, which any
// request writes, ended it with `Unhandled 'error' event … write EPIPE`
test('serviceman goes on answering when whoever read its stdout is gone', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-stdout-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.mkdirSync(path.join(dir, 'state'));
    fs.writeFileSync(config_path, JSON.stringify({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [], services: []}));
    const env = Object.assign({}, process.env, {SERVICEMAN_STATE_DIR: path.join(dir, 'state'), SERVICEMAN_LOG_DIR: 'none'});
    const child = child_process.spawn(process.execPath, [MAIN, config_path], {stdio: ['ignore', 'pipe', 'ignore'], env});
    t.after(function () {
        child.kill('SIGKILL');
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const port = Number((await stdout_wait(child, /\[serviceman_listen\] address=127\.0\.0\.1:(\d+)/))[1]);
    child.stdout.destroy();
    // A name nobody has: a 404, and a line in the log
    for (let i = 0; i < 3; i++) {
        const asked = await fetch_host({port, host: 'nobody.example.com', path: '/'});
        assert.strictEqual(asked.status, 404, `the request ${i + 1}`);
        await timers.setTimeout(200);
    }
    assert.strictEqual(child.exitCode, null);
});

// The agent says a line each time its dial fails, a second apart
test('the agent goes on when whoever read its stdout is gone', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-stdout-'));
    const env = Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_LOG_DIR: 'none'});
    const child = child_process.spawn(process.execPath, [AGENT, '--url', 'http://127.0.0.1:9', '--token', 'fedcba9876543210fedcba9876543210'], {stdio: ['ignore', 'pipe', 'ignore'], env});
    t.after(function () {
        child.kill('SIGKILL');
        fs.rmSync(dir, {recursive: true, force: true});
    });
    await stdout_wait(child, /\n/);
    child.stdout.destroy();
    await timers.setTimeout(2500);
    assert.strictEqual(child.exitCode, null);
});

// Logline's lines server keeps the same rule in a copy of its own. A batch with no token is
// refused, and the refusal is a line of its log.
test('Logline\'s lines server goes on answering when whoever read its stdout is gone', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-stdout-'));
    const port = await port_free();
    const env = Object.assign({}, process.env, {PORT: String(port), BIND: '127.0.0.1', CLICKHOUSE: 'http://127.0.0.1:9', DATA: dir, ADMIN_TOKEN: '', ADMIN_IPS: ''});
    const child = child_process.spawn(process.execPath, [LINES], {stdio: ['ignore', 'pipe', 'ignore'], env});
    t.after(function () {
        child.kill('SIGKILL');
        fs.rmSync(dir, {recursive: true, force: true});
    });
    await stdout_wait(child, /\[lines_begin\]/);
    child.stdout.destroy();
    for (let i = 0; i < 3; i++) {
        const asked = await fetch_host({port, host: '127.0.0.1', path: '/lines', method: 'POST', token: null});
        assert.strictEqual(asked.status, 401, `the request ${i + 1}`);
        await timers.setTimeout(200);
    }
    assert.strictEqual(child.exitCode, null);
});

// A port nothing listens on, for a program that is told its port and cannot be asked for it
function port_free()
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

// What the pattern found in what the child said so far; an error when the child ends first
function stdout_wait(child, pattern)
{
    return new Promise(function (resolve, reject) {
        let text = '';
        child.stdout.on('data', function (chunk) {
            text += chunk.toString('utf8');
            const found = pattern.exec(text);
            if (found !== null) {
                resolve(found);
            }
        });
        child.on('exit', function (code) {
            reject(new Error(`the process ended with ${code} before it said ${pattern}`));
        });
    });
}
