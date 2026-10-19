const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');
const tunnel_agent = require('../src/main/src/helpers/tunnel_agent');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';

// Every agent this file spawns keeps its state here — never beside its own file in src/
process.env.SERVICEMAN_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'));

test('a request through the link reaches a server on the machine of the remote', async function () {
    const far = await far_server();
    const link = await link_open();
    const agent = tunnel_agent(link.remote);
    try {
        const answer = await fetch_through(agent, far.port, '/hello');
        assert.strictEqual(answer.status, 200);
        assert.strictEqual(answer.body, 'far says /hello');

        const posted = await fetch_through(agent, far.port, '/echo', 'the words of the client');
        assert.strictEqual(posted.body, 'the words of the client');

        const again = await fetch_through(agent, far.port, '/hello');
        assert.strictEqual(again.body, 'far says /hello');
        assert.strictEqual(far.connections(), 1, 'the pool keeps one socket for all three');
    }
    finally {
        agent.destroy();
        await link.close();
        far.close();
    }
});

test('a big body travels both ways whole, even when the reader is slow', async function () {
    const far = await far_server();
    const link = await link_open();
    const agent = tunnel_agent(link.remote);
    const sent = crypto.randomBytes(5*1024*1024);
    try {
        const answer = await fetch_through(agent, far.port, '/mirror', sent, {slow: true});
        assert.strictEqual(answer.buffer.length, sent.length);
        assert.strictEqual(hash(answer.buffer), hash(sent));
    }
    finally {
        agent.destroy();
        await link.close();
        far.close();
    }
});

test('twenty streams at once keep their own bytes apart', async function () {
    const far = await far_server();
    const link = await link_open();
    const agent = tunnel_agent(link.remote);
    try {
        const jobs = [];
        for (let i = 0; i < 20; i++) {
            jobs.push(fetch_through(agent, far.port, `/echo`, `the body of request ${i}`));
        }
        const answers = await Promise.all(jobs);
        for (let i = 0; i < answers.length; i++) {
            assert.strictEqual(answers[i].body, `the body of request ${i}`);
        }
    }
    finally {
        agent.destroy();
        await link.close();
        far.close();
    }
});

test('a port nobody listens on comes back refused, and so does an offline remote', async function () {
    const closed_port = await free_port();
    const link = await link_open();
    const agent = tunnel_agent(link.remote);
    try {
        const error = await fetch_error(agent, closed_port, '/');
        assert.strictEqual(error.code, 'ECONNREFUSED');

        link.remote.state.phase = 'offline';
        assert.throws(() => tunnel_agent(link.remote).createConnection({port: closed_port}), /remote vps1 is offline/);
    }
    finally {
        agent.destroy();
        await link.close();
    }
});

test('a link that drops ends every request in flight', async function () {
    const far = await far_server();
    const link = await link_open();
    const agent = tunnel_agent(link.remote);
    try {
        const answer = fetch_error(agent, far.port, '/forever');
        await wait_until(() => far.holding() > 0);
        assert.strictEqual(Object.keys(link.remote.state.streams).length, 1);

        link.remote.state.socket.destroy();
        const error = await answer;
        assert.strictEqual(error.code, 'ECONNRESET');
        assert.match(error.message, /the link to remote vps1 dropped/);
        assert.deepStrictEqual(link.remote.state.streams, {});
    }
    finally {
        agent.destroy();
        await link.close();
        far.close();
    }
});

// A serviceman with one remote, and the agent of that remote dialled in
async function link_open()
{
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [],
    }, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const argv = [AGENT, '--url', `http://127.0.0.1:${servers.control.address().port}`, '--token', TOKEN];
    const child = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.resume();
    child.stderr.resume();
    const remote = app.remote_by_name.vps1;
    await wait_until(() => remote.state.phase === 'online');
    return {
        app,
        remote,
        close: async function () {
            child.kill('SIGKILL');
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
            servers.server.close();
            servers.control.close();
            servers.server.closeAllConnections();
            servers.control.closeAllConnections();
        },
    };
}

// The little server that stands for everything running on the other machine
function far_server()
{
    let connections = 0;
    let holding = 0;
    const server = http.createServer(function (req, res) {
        if (req.url === '/hello') {
            res.end(`far says ${req.url}`);
            return;
        }
        if (req.url === '/forever') {
            holding++;
            return;
        }
        const chunks = [];
        req.on('data', function (chunk) {
            chunks.push(chunk);
        });
        req.on('end', function () {
            res.end(Buffer.concat(chunks));
        });
    });
    server.on('connection', function () {
        connections++;
    });
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            resolve({
                port: server.address().port,
                connections: () => connections,
                holding: () => holding,
                close: function () {
                    server.close();
                    server.closeAllConnections();
                },
            });
        });
    });
}

function fetch_through(agent, port, path, body, options)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({host: '127.0.0.1', port, path, agent, method: (body === undefined) ? 'GET' : 'POST'}, function (res) {
            const chunks = [];
            res.on('data', function (chunk) {
                chunks.push(chunk);
            });
            res.on('end', function () {
                const buffer = Buffer.concat(chunks);
                resolve({status: res.statusCode, body: buffer.toString('utf8'), buffer});
            });
            if ((options !== undefined) && options.slow) {
                res.pause();
                setTimeout(function () {
                    res.resume();
                }, 300);
            }
        });
        req.on('error', reject);
        req.end(body);
    });
}

async function fetch_error(agent, port, path)
{
    try {
        await fetch_through(agent, port, path);
    }
    catch (error) {
        return error;
    }
    throw new Error('the request went through, and it should not have');
}

function hash(buffer)
{
    return crypto.createHash('sha1').update(buffer).digest('hex');
}

function free_port()
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            server.close(function () {
                resolve(port);
            });
        });
    });
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + ((timeout_ms === undefined) ? 10000 : timeout_ms);
    for (;;) {
        if (ready()) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(25);
    }
}
