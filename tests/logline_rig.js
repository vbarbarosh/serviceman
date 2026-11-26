const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';

// serviceman with Logline on its machine `server`, linked by an agent of this repository, and a
// stand-in for ClickHouse on that machine's loopback, which serviceman reaches through the agent
// alone (SERVICEMAN_LOGLINE_CLICKHOUSE_PORT names its port). Every request ClickHouse is sent is
// kept, as {method, path, params, headers, sql, closed}, `closed` a promise of its connection
// going, and answered as `clickhouse(asked, res)` writes it.
//
//     options   {clickhouse, logline, services}: the config's logline, {endpoint, admin} unless
//               given; its services, logline on `server` and notes on `server` unless given
//     out       {app, port, asked, agent_stop, clickhouse_stop}: port the control door's
async function logline_rig(t, options)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logline-rig-'));
    const asked = [];
    const clickhouse = http.createServer(function (req, res) {
        const chunks = [];
        req.on('data', function (chunk) {
            chunks.push(chunk);
        });
        req.on('end', function () {
            const url = new URL(req.url, 'http://clickhouse');
            const item = {method: req.method, path: url.pathname, params: url.searchParams, headers: req.headers, sql: Buffer.concat(chunks).toString('utf8'), closed: new Promise(v => req.socket.once('close', v))};
            asked.push(item);
            options.clickhouse(item, res);
        });
    });
    await new Promise(v => clickhouse.listen(0, '127.0.0.1', v));
    const port_before = process.env.SERVICEMAN_LOGLINE_CLICKHOUSE_PORT;
    process.env.SERVICEMAN_LOGLINE_CLICKHOUSE_PORT = String(clickhouse.address().port);
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'server', token: TOKEN}],
        logline: (options.logline === undefined) ? {endpoint: 'http://127.0.0.1:9/lines', admin: 'logline'} : options.logline,
        services: (options.services === undefined) ? [
            {name: 'logline', type: 'external', remote: 'server', upstream: '127.0.0.1:9', publish: {host: 'logline.test'}},
            {name: 'notes', type: 'external', remote: 'server', upstream: '127.0.0.1:9', publish: {host: 'notes.test'}},
        ] : options.services,
    }, dir);
    const app = app_from_config(config);
    app.state_dir = path.join(dir, 'state');
    fs.mkdirSync(app.state_dir);
    const servers = await server_start(app);
    const port = servers.control.address().port;
    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${port}`, '--token', TOKEN], {
        stdio: 'ignore',
        env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(dir, 'agent'), SERVICEMAN_LOG_DIR: 'none'}),
    });
    t.after(function () {
        agent.kill('SIGKILL');
        for (const remote of app.remotes) {
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control, clickhouse]) {
            door.close();
            door.closeAllConnections();
        }
        if (port_before === undefined) {
            delete process.env.SERVICEMAN_LOGLINE_CLICKHOUSE_PORT;
        }
        else {
            process.env.SERVICEMAN_LOGLINE_CLICKHOUSE_PORT = port_before;
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const remote = app.remote_by_name.server;
    for (let i = 0; remote.state.phase !== 'online'; i++) {
        assert.ok(i < 400, 'the agent dials in');
        await timers.setTimeout(25);
    }
    return {
        app,
        port,
        asked,
        // The machine goes away: its agent stops, and serviceman sees the link go
        agent_stop: async function () {
            agent.kill('SIGKILL');
            for (let i = 0; remote.state.phase === 'online'; i++) {
                assert.ok(i < 400, 'the link goes');
                await timers.setTimeout(25);
            }
        },
        // Nothing listens on ClickHouse's port any more
        clickhouse_stop: async function () {
            clickhouse.closeAllConnections();
            await new Promise(v => clickhouse.close(v));
        },
    };
}

module.exports = logline_rig;
