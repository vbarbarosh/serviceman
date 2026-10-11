const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');

// A host that takes the link and hangs up at once, while the agent is still putting its hello
// together. The close comes before the agent has sent a word; it must still hear it and dial
// again, not wait on a dead link for good.
test('an agent whose link drops before its hello dials again', async function () {
    let knocks = 0;
    const server = http.createServer();
    server.on('upgrade', function (req, socket) {
        knocks++;
        socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: serviceman\r\nconnection: Upgrade\r\nserviceman-remote: drop\r\n\r\n');
        setTimeout(function () {
            socket.destroy();
        }, 20);
    });
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-drop-'));
    const argv = [AGENT, '--url', `http://127.0.0.1:${server.address().port}`, '--token', 'dropdropdropdropdropdropdropdrop', '--machine', 'drop'];
    const agent = child_process.spawn(process.execPath, argv, {stdio: 'ignore', env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: dir})});
    try {
        const until = Date.now() + 8000;
        while ((knocks < 3) && (Date.now() < until)) {
            await timers.setTimeout(100);
        }
        assert.ok(knocks >= 3, `the agent knocked ${knocks} time(s) and then waited`);
    }
    finally {
        agent.kill('SIGKILL');
        server.close();
    }
});
