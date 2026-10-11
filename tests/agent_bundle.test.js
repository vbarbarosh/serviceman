const agent_version = require('../src/agent/version.json');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const TOKEN = '0123456789abcdef0123456789abcdef';

test('the agent is served as one file, and that file is an agent that dials in', async function () {
    const running = await serviceman_start();
    const remote = running.app.remote_by_name.vps1;
    let child = null;
    try {
        const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/agent.js'});
        assert.strictEqual(answer.status, 200);
        assert.match(answer.headers['content-type'], /text\/javascript/);
        assert.match(answer.body, /^#!\/usr\/bin\/env node\n/);
        assert.ok(answer.body.includes(`// serviceman-agent ${agent_version.version} — one file, no dependencies`));

        // Written and run far from the repo: nothing of node_modules is within its reach
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-'));
        const file = path.join(dir, 'serviceman-agent.js');
        fs.writeFileSync(file, answer.body);
        child = child_process.spawn(process.execPath, [file, '--url', `http://127.0.0.1:${running.control_port}`, '--token', TOKEN], {cwd: dir, stdio: ['ignore', 'pipe', 'pipe']});
        const said = [];
        child.stdout.on('data', v => said.push(v.toString('utf8')));
        child.stderr.on('data', v => said.push(v.toString('utf8')));

        await wait_until(() => remote.state.phase === 'online', 15000);
        assert.strictEqual(remote.state.resources.cpu.count > 0, true);
        assert.strictEqual(remote.state.agent_version, agent_version.version);
        await wait_until(() => remote.state.throughput_bps !== null);
        // Every line the agent writes has the shape every serviceman line has, and the first
        // one says what this agent is
        const lines = said.join('').split('\n').filter(v => v !== '');
        assert.match(lines[0], /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\]\[c[a-z0-9]{11}\]\[group_spawn\]$/, 'a group says when it began, parent or no parent');
        assert.match(lines[1], /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\]\[c[a-z0-9]{11}\]\[agent_begin\] agent=\d+\.\d+\.\d+ built=\S+ node=v/);
        assert.ok(lines[1].includes(`agent=${agent_version.version} `), 'the agent says its own version');
        for (const line of lines) {
            assert.match(line, /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\]\[c[a-z0-9]{11}\]\[[a-z_]+\]/, line);
        }
        assert.ok(lines.some(v => /\[agent_connect_end_ok\] remote=vps1$/.test(v)), said.join(''));
    }
    finally {
        if (child !== null) {
            child.kill('SIGKILL');
        }
        await running.close();
    }
});

async function serviceman_start()
{
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [],
    }, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    return {
        app,
        control_port: servers.control.address().port,
        close: async function () {
            for (const remote of app.remotes) {
                if (remote.state.socket !== null) {
                    remote.state.socket.destroy();
                }
            }
            servers.server.close();
            servers.control.close();
            servers.server.closeAllConnections();
            servers.control.closeAllConnections();
        },
    };
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
