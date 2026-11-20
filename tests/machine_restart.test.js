const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const http = require('http');
const link_read = require('../src/helpers/link_read');
const link_send_message = require('../src/helpers/link_send_message');
const machine_restart = require('../src/main/src/helpers/machine_restart');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

const TOKEN = '0123456789abcdef0123456789abcdef';
const TOKEN2 = 'fedcba9876543210fedcba9876543210';
const DAY_MS = 24*3600*1000;

// Asked, down, back on a new boot, looked at: each phase as the status shows it, and the log
test('a machine asked to restart is followed down and back, and looked at once it is', async function (t) {
    const running = await serviceman_start(t);
    const vps1 = await agent_fake(t, running, TOKEN, {can: ['machine_restart', 'root'], uptime_ms: 10*DAY_MS});
    const asked = await control(running, 'POST', '/api/v1/remotes/vps1/restart');
    assert.deepStrictEqual([asked.status, asked.body.restart.phase, asked.body.restart.by], [200, 'going', 'systemctl reboot']);
    assert.deepStrictEqual(vps1.asked.filter(v => v === 'machine_restart'), ['machine_restart'], 'asked once');
    vps1.socket.destroy();
    await wait_until(() => restart_of(running, 'vps1').phase === 'down');
    // Booted since it was asked: up for less time than has passed since
    const back = await agent_fake(t, running, TOKEN, {can: ['machine_restart', 'root', 'security'], uptime_ms: 10});
    await wait_until(() => restart_of(running, 'vps1').phase === 'done');
    const restart = restart_of(running, 'vps1');
    assert.ok(restart.back_at >= restart.down_at, 'back after down');
    assert.strictEqual(restart.error, null);
    assert.ok(back.asked.includes('security'), `a Security look asked it: ${back.asked.join(', ')}`);
    const words = ['machine_restart_asked', 'machine_restart_going', 'machine_restart_down', 'machine_restart_back'];
    assert.deepStrictEqual(words.filter(v => running.app.log_lines.some(vv => vv.includes(`[${v}] remote=vps1`))), words);
});

// A link that drops and comes back on the same boot is no restart: still to come
test('a link back on the same boot is not the restart, which is still to come', async function (t) {
    const running = await serviceman_start(t);
    const vps1 = await agent_fake(t, running, TOKEN, {can: ['machine_restart', 'root'], uptime_ms: 10*DAY_MS});
    await control(running, 'POST', '/api/v1/remotes/vps1/restart');
    vps1.socket.destroy();
    await wait_until(() => restart_of(running, 'vps1').phase === 'down');
    await agent_fake(t, running, TOKEN, {can: ['machine_restart', 'root'], uptime_ms: 10*DAY_MS + 60000});
    await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'online');
    assert.strictEqual(restart_of(running, 'vps1').phase, 'going');
});

// What is refused, and why: an unknown or away machine, an old agent, no root half, and a
// second machine while the first is not back
test('a restart is refused where it cannot be done, and one machine at a time', async function (t) {
    const running = await serviceman_start(t);
    const nobody = await control(running, 'POST', '/api/v1/remotes/ghost/restart');
    assert.deepStrictEqual([nobody.status, nobody.body.error], [404, 'no remote named "ghost"']);
    const away = await control(running, 'POST', '/api/v1/remotes/vps1/restart');
    assert.deepStrictEqual([away.status, away.body.error], [409, 'vps1 is not connected']);
    const old = await agent_fake(t, running, TOKEN, {can: ['root'], uptime_ms: DAY_MS});
    const too_old = await control(running, 'POST', '/api/v1/remotes/vps1/restart');
    assert.deepStrictEqual([too_old.status, too_old.body.error], [400, 'the agent on vps1 is from before restarting machines; it is asked to update, and can once it has']);
    old.socket.destroy();
    await wait_until(() => running.app.remote_by_name.vps1.state.phase !== 'online');
    await agent_fake(t, running, TOKEN, {can: ['machine_restart'], uptime_ms: DAY_MS});
    const rootless = await control(running, 'POST', '/api/v1/remotes/vps1/restart');
    assert.strictEqual(rootless.status, 400);
    assert.match(rootless.body.error, /^vps1 has no root agent/);
    await agent_fake(t, running, TOKEN2, {can: ['machine_restart', 'root'], uptime_ms: DAY_MS});
    const first = await control(running, 'POST', '/api/v1/remotes/vps2/restart');
    assert.strictEqual(first.status, 200);
    const again = await control(running, 'POST', '/api/v1/remotes/vps2/restart');
    assert.deepStrictEqual([again.status, again.body.error], [409, 'vps2 is restarting already']);
    const facts = await control(running, 'GET', '/api/v1/remotes/vps1/restart');
    assert.deepStrictEqual([facts.status, facts.body.refused], [200, 'vps1 has no root agent, and only it restarts a machine: its page says how to install it, or its Shell restarts it by hand, sudo reboot']);
});

// The agent's refusal is the answer, and the restart ends there; a machine that does not go
// down, or does not come back, is said so once its time is up
test('a refusal, a machine that stays up and one that does not come back each end in an error', async function (t) {
    const before = [machine_restart.go_down_ms, machine_restart.come_back_ms];
    t.after(function () {
        [machine_restart.go_down_ms, machine_restart.come_back_ms] = before;
    });
    machine_restart.go_down_ms = 200;
    machine_restart.come_back_ms = 200;
    const running = await serviceman_start(t);
    await agent_fake(t, running, TOKEN, {can: ['machine_restart', 'root'], uptime_ms: DAY_MS, refuse: 'this machine has neither systemctl nor shutdown to restart it with'});
    const refused = await control(running, 'POST', '/api/v1/remotes/vps1/restart');
    assert.deepStrictEqual([refused.status, refused.body.error], [502, 'remote vps1: this machine has neither systemctl nor shutdown to restart it with']);
    assert.strictEqual(restart_of(running, 'vps1').phase, 'error');
    const vps2 = await agent_fake(t, running, TOKEN2, {can: ['machine_restart', 'root'], uptime_ms: DAY_MS});
    await control(running, 'POST', '/api/v1/remotes/vps2/restart');
    await wait_until(() => restart_of(running, 'vps2').phase === 'error');
    assert.match(restart_of(running, 'vps2').error, /^vps2 is still up on the same boot/);
    await control(running, 'POST', '/api/v1/remotes/vps2/restart');
    vps2.socket.destroy();
    await wait_until(() => restart_of(running, 'vps2').phase === 'error');
    assert.match(restart_of(running, 'vps2').error, /^vps2 went down to restart and has not dialled in/);
});

// The window's facts: its last restart put together across midnight, its kept terminals, and a
// part that cannot be read said as such, the rest still there
test('the window is told the last restart, the kept terminals, and why a part is missing', async function (t) {
    const running = await serviceman_start(t);
    const midnight = Date.UTC(2026, 10, 20);
    const days = [
        {day: '2026-11-18', down: [{from: midnight - 2*DAY_MS + 1000, to: midnight - 2*DAY_MS + 30000, why: 'reboot'}]},
        {day: '2026-11-19', down: [{from: midnight - 20000, to: midnight, why: 'reboot'}, {from: midnight - 9*3600000, to: midnight - 8*3600000, why: 'silent'}]},
        {day: '2026-11-20', down: [{from: midnight, to: midnight + 25000, why: 'reboot'}]},
    ];
    await agent_fake(t, running, TOKEN, {can: ['machine_restart', 'root', 'uptime', 'term_list'], uptime_ms: DAY_MS, answers: {uptime: {tz: 'UTC', until: midnight + 3600000, days}, term_list: {items: [{name: 'a'}, {name: 'b'}]}}});
    const facts = await control(running, 'GET', '/api/v1/remotes/vps1/restart');
    assert.strictEqual(facts.status, 200);
    assert.deepStrictEqual([facts.body.refused, facts.body.last, facts.body.terminals, facts.body.serviceman_here], [null, {at: midnight + 25000, down_ms: 45000}, 2, false]);
    assert.strictEqual(facts.body.containers, null);
    assert.strictEqual(typeof facts.body.errors.containers, 'string');
});

function restart_of(running, name)
{
    return running.app.remote_by_name[name].state.restart;
}

// A serviceman of two machines, vps1 and vps2, neither dialled in yet; closed with the test
async function serviceman_start(t)
{
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}], services: []}, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    t.after(function () {
        for (const item of app.remotes) {
            if (item.state.socket !== null) {
                item.state.socket.destroy();
            }
            if (item.state.restart_timer !== null) {
                clearTimeout(item.state.restart_timer);
            }
        }
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== null) && (door !== undefined)) {
                door.close();
                door.closeAllConnections();
            }
        }
    });
    return {app, control_port: servers.control.address().port};
}

// A machine's agent played by hand: it dials in with the token, says hello as an agent that can
// be asked what `said.can` names, booted `said.uptime_ms` ago, and answers machine_restart as
// the root half does (or refuses it with `said.refuse`), anything else with a refusal. Resolves
// once serviceman has it online, with what it was asked so far.
function agent_fake(t, running, token, said)
{
    const fake = {asked: [], socket: null};
    return new Promise(function (resolve, reject) {
        const request = http.request({host: '127.0.0.1', port: running.control_port, path: '/api/v1/remote', headers: {connection: 'Upgrade', upgrade: 'serviceman', authorization: `Bearer ${token}`}});
        request.on('upgrade', function (answer, socket) {
            fake.socket = socket;
            t.after(() => socket.destroy());
            link_read(socket, function (kind, body) {
                const message = (kind === 'm') ? JSON.parse(body.toString('utf8')) : {};
                if (message.type !== 'call') {
                    return;
                }
                fake.asked.push(message.method);
                if ((said.answers !== undefined) && (said.answers[message.method] !== undefined)) {
                    link_send_message(socket, {type: 'reply', id: message.id, ok: true, value: said.answers[message.method]});
                    return;
                }
                if ((message.method === 'machine_restart') && (said.refuse === undefined)) {
                    link_send_message(socket, {type: 'reply', id: message.id, ok: true, value: {restarting: true, by: 'systemctl reboot', uptime_ms: said.uptime_ms}});
                    return;
                }
                link_send_message(socket, {type: 'reply', id: message.id, ok: false, error: (message.method === 'machine_restart') ? said.refuse : `no ${message.method} here`});
            });
            socket.on('error', function () {});
            link_send_message(socket, {
                type: 'hello',
                agent: '1.40.1',
                resources: {hostname: 'vps', platform: 'linux', arch: 'x64', node: process.version, docker: null, can: said.can, addresses: [], cpu: {count: 1, model: 'cpu'}, mem: {total: 1024*1024*1024}, disk: {path: '/', total: 1024*1024*1024, free: 1024*1024}},
                stats: {mem_free: 1024*1024, disk_free: 1024*1024, uptime_ms: said.uptime_ms, load: 0},
            });
            const name = (token === TOKEN) ? 'vps1' : 'vps2';
            wait_until(() => (running.app.remote_by_name[name].state.phase === 'online')).then(() => resolve(fake), reject);
        });
        request.on('error', reject);
        request.end();
    });
}

async function control(running, method, pathname)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: pathname, method});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

async function wait_until(ready)
{
    const deadline = Date.now() + 10000;
    while (ready() === false) {
        if (Date.now() > deadline) {
            throw new Error('not in time');
        }
        await new Promise(v => setTimeout(v, 20));
    }
}
