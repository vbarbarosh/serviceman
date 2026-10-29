const app_from_config = require('../src/main/src/helpers/app_from_config');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const net = require('net');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';
// What the proxy holds toward one end before it stops reading from the other
const HELD_PIECES = 16;

// serviceman with one machine, vps1, whose agent dials it through a proxy: a link of `down`
// bytes a second toward the agent and `up` back (1 MB/s each by default), that `stand()` makes
// carry nothing toward the agent, its way back working, the way a link stood on 2026-10-29.
// `pass_reset` decides whether a link serviceman resets is reset at the agent's end too, or left
// hanging there; `agent_env` is what the agent is started with besides.
// {app, control_port, links, agent_said}: each link the agent dialled, the last one now, as
// {carried, stand()}; what the agent printed.
async function link_proxy_rig(t, options)
{
    const down = (options.down === undefined) ? 1024*1024 : options.down;
    const up = (options.up === undefined) ? 1024*1024 : options.up;
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'vps1', token: TOKEN}], services: []}, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const control_port = servers.control.address().port;
    const links = [];
    const proxy = net.createServer(function (agent) {
        const host = net.connect(control_port, '127.0.0.1');
        const link = {carried: 0, stood: false, stand: function () {
            link.stood = true;
        }};
        links.push(link);
        const toward_agent = carry(host, agent, down, () => link.stood, function (n) {
            link.carried += n;
        });
        const toward_host = carry(agent, host, up, () => false, function () {});
        function end() {
            clearInterval(toward_agent);
            clearInterval(toward_host);
            host.destroy();
            if (options.pass_reset !== false) {
                agent.destroy();
            }
        }
        host.on('close', end);
        host.on('error', end);
        agent.on('error', end);
        agent.on('close', function () {
            clearInterval(toward_agent);
            clearInterval(toward_host);
            host.destroy();
        });
    });
    await new Promise(v => proxy.listen(0, '127.0.0.1', v));
    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${proxy.address().port}`, '--token', TOKEN], {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, (options.agent_env === undefined) ? {} : options.agent_env)});
    const out = {app, control_port, links, agent_said: ''};
    agent.stdout.on('data', function (chunk) {
        out.agent_said += chunk.toString('utf8');
    });
    agent.stderr.resume();
    const log = console.log;
    console.log = function () {};
    t.after(function () {
        console.log = log;
        agent.kill('SIGKILL');
        proxy.close();
        for (const remote of app.remotes) {
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== null) && (door !== undefined)) {
                door.close();
                door.closeAllConnections();
            }
        }
    });
    const deadline = Date.now() + 10000;
    while (app.remote_by_name.vps1.state.phase !== 'online') {
        if (Date.now() > deadline) {
            throw new Error('the agent never dialled in');
        }
        await timers.setTimeout(50);
    }
    return out;
}

// One way of the proxy: what `from` says goes to `to` at `rate` bytes a second, nothing while
// `stood()`; the clock that does it, for the caller to stop
function carry(from, to, rate, stood, carried)
{
    const queue = [];
    from.on('data', function (chunk) {
        queue.push(chunk);
        if (queue.length > HELD_PIECES) {
            from.pause();
        }
    });
    return setInterval(function () {
        let budget = stood() ? 0 : rate/100;
        while ((budget > 0) && (queue.length > 0)) {
            const chunk = queue[0];
            const n = Math.min(chunk.length, budget);
            to.write(chunk.subarray(0, n));
            carried(n);
            budget -= n;
            if (n === chunk.length) {
                queue.shift();
            }
            else {
                queue[0] = chunk.subarray(n);
            }
        }
        if (queue.length <= HELD_PIECES) {
            from.resume();
        }
    }, 10);
}

module.exports = link_proxy_rig;
